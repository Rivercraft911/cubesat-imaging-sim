import * as THREE from "three/webgpu";
import Color4 from "three/src/renderers/common/Color4.js";
import type { CameraConfig, CameraId, SensorProfile } from "../sim";
import type { CaptureCamera, CaptureOptions } from "./types";
import type { makeStitch } from "./stitch";
import { createEncoderSurface } from "./encoder-surface";
import { unpackRgba8 } from "./readback";

type WithTime = (pts: number | undefined, draw: () => void, study?: CaptureOptions["study"]) => void;
interface CaptureInput {
  renderer: THREE.WebGPURenderer;
  quadScene: THREE.Scene;
  quadCamera: THREE.Camera;
  quad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  stitch: ReturnType<typeof makeStitch>;
  frontTarget: THREE.RenderTarget;
  rearTarget: THREE.RenderTarget;
  config(id: CameraId): CameraConfig;
  sensorInfo(camera: CameraConfig): SensorProfile;
  configureStitch(): void;
  withTime: WithTime;
  sources: {
    panorama(): void;
    native(id: CameraId, crop?: THREE.Vector4): void;
  };
  changed(): void;
}
/** Serial offscreen export owns its target and readback buffers. Source drawing
 * is synchronous so temporary simulation time is restored before readback awaits. */
export function createCapturePipeline({
  renderer,
  quadScene,
  quadCamera,
  quad,
  stitch,
  frontTarget,
  rearTarget,
  config,
  sensorInfo,
  configureStitch,
  withTime,
  sources,
  changed,
}: CaptureInput) {
  const captureTarget = new THREE.RenderTarget(1, 1, { depthBuffer: false });
  captureTarget.texture.colorSpace = THREE.SRGBColorSpace;
  const outputCanvas = document.createElement("canvas");
  const encoderSurface = createEncoderSurface(renderer);
  const decodedCanvas = document.createElement("canvas");
  let disposed = false;
  let workQueue: Promise<unknown> = Promise.resolve();
  let busy = false;
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = workQueue.then(async () => {
      busy = true;
      try {
        if (disposed) throw new Error("Renderer has been disposed");
        return await operation();
      } finally {
        busy = false;
        changed();
      }
    });
    workQueue = task.catch(() => {});
    return task;
  }
  async function readTarget(
    target: THREE.RenderTarget,
    output: HTMLCanvasElement,
  ) {
    const bytes = await renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      target.width,
      target.height,
    );
    if (output.width !== target.width) output.width = target.width;
    if (output.height !== target.height) output.height = target.height;
    const data = unpackRgba8(bytes, target.width, target.height);
    output
      .getContext("2d")!
      .putImageData(new ImageData(data, target.width, target.height), 0, 0);
    return output;
  }
  async function withRendererState<T>(operation: () => Promise<T>) {
    const toneMapping = renderer.toneMapping;
    const target = renderer.getRenderTarget();
    const clear = new Color4();
    renderer.getClearColor(clear);
    const alpha = renderer.getClearAlpha();
    renderer.toneMapping = THREE.NoToneMapping;
    try {
      return await operation();
    } finally {
      renderer.setRenderTarget(target);
      renderer.setClearColor(clear, alpha);
      renderer.toneMapping = toneMapping;
    }
  }
  function drawCapture(
    id: CaptureCamera,
    w?: number,
    h?: number,
    pts?: number,
    study?: CaptureOptions["study"],
  ) {
    withTime(pts, () => {
      const sensor = id === "panorama" ? null : sensorInfo(config(id));
      const nativeW = sensor?.width ?? 4096,
        nativeH = sensor?.height ?? 2048;
      let aspect = nativeW / nativeH;
      let crop: THREE.Vector4 | undefined;
      if (
        id !== "main" &&
        id !== "panorama" &&
        sensor &&
        w !== undefined &&
        h !== undefined &&
        Math.abs(w / h - 1) < 0.01
      ) {
        const side = Math.min(
          sensor.width,
          sensor.height,
          config(id).lens.imageCircleMm / (sensor.pixelPitchUm / 1000),
        );
        crop = new THREE.Vector4(
          (sensor.width - side) / 2,
          (sensor.height - side) / 2,
          side,
          side,
        );
        aspect = 1;
      }
      if (id === "panorama") sources.panorama();
      else sources.native(id, crop);
      const width = w ?? nativeW,
        height = h ?? nativeH;
      const limit = (renderer.backend as unknown as { device: GPUDevice })
        .device.limits.maxTextureDimension2D;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > limit ||
        height > limit
      )
        throw new RangeError(
          `Capture dimensions must be integers from 1 to ${limit}.`,
        );
      captureTarget.setSize(width, height);
      let vw = width,
        vh = height;
      if (vw / vh > aspect) vw = vh * aspect;
      else vh = vw / aspect;
      captureTarget.viewport.set((width - vw) / 2, (height - vh) / 2, vw, vh);
      renderer.setRenderTarget(captureTarget);
      renderer.setClearColor(0, 1);
      renderer.clear();
      renderer.render(quadScene, quadCamera);
    }, study);
  }
  function captureCanvas(id: CaptureCamera, w?: number, h?: number, pts?: number, study?: CaptureOptions["study"]) {
    return withRendererState(async () => {
      drawCapture(id, w, h, pts, study);
      return readTarget(captureTarget, outputCanvas);
    });
  }
  return {
    get busy() {
      return busy;
    },
    canvas(id: CaptureCamera, w?: number, h?: number, pts?: number) {
      return enqueue(() => captureCanvas(id, w, h, pts));
    },
    encoderFrame(id: CaptureCamera, w: number, h: number, captureUs: number, init: VideoFrameInit, study?: CaptureOptions["study"]) {
      return enqueue(() => withRendererState(async () => {
        drawCapture(id, w, h, captureUs, study);
        return encoderSurface.frame(captureTarget, init)
          ?? new VideoFrame(await readTarget(captureTarget, outputCanvas), init);
      }));
    },
    capture(id: CaptureCamera, options: CaptureOptions) {
      return enqueue(async () => {
        const output = await captureCanvas(id, options.width, options.height, undefined, options.study);
        return new Promise<Blob>((resolve, reject) =>
          output.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(new Error("Could not encode image")),
            options.type ?? "image/png",
          ),
        );
      });
    },
    stitchDecodedFrames(
      front: CanvasImageSource,
      rear: CanvasImageSource,
      w: number,
      h: number,
    ) {
      return enqueue(() =>
        withRendererState(async () => {
          const a = new THREE.Texture(front),
            b = new THREE.Texture(rear);
          for (const t of [a, b]) {
            t.colorSpace = THREE.SRGBColorSpace;
            t.needsUpdate = true;
            t.minFilter = THREE.LinearFilter;
            t.generateMipmaps = false;
          }
          try {
            configureStitch();
            for (const [source, id, key] of [
              [front, "wideA", "cropA"],
              [rear, "wideB", "cropB"],
            ] as const) {
              const object = source as {
                width?: number;
                height?: number;
                displayWidth?: number;
                displayHeight?: number;
                videoWidth?: number;
                videoHeight?: number;
              };
              const fw =
                  object.displayWidth ?? object.videoWidth ?? object.width ?? w,
                fh =
                  object.displayHeight ??
                  object.videoHeight ??
                  object.height ??
                  h;
              const c = config(id),
                s = sensorInfo(c);
              if (Math.abs(fw / fh - 1) < 0.01) {
                const side = Math.min(
                  s.width,
                  s.height,
                  c.lens.imageCircleMm / (s.pixelPitchUm / 1000),
                );
                stitch.u[key].value.set(
                  (s.width - side) / (2 * s.width),
                  (s.height - side) / (2 * s.height),
                  side / s.width,
                  side / s.height,
                );
              } else if (fw / fh > s.width / s.height) {
                const scale = fw / fh / (s.width / s.height);
                stitch.u[key].value.set((1 - scale) / 2, 0, scale, 1);
              } else {
                const scale = s.width / s.height / (fw / fh);
                stitch.u[key].value.set(0, (1 - scale) / 2, 1, scale);
              }
            }
            stitch.a.value = a;
            stitch.b.value = b;
            quad.material = stitch.material;
            captureTarget.setSize(w, h);
            captureTarget.viewport.set(0, 0, w, h);
            renderer.setRenderTarget(captureTarget);
            renderer.render(quadScene, quadCamera);
            return await readTarget(captureTarget, decodedCanvas);
          } finally {
            a.dispose();
            b.dispose();
            stitch.a.value = frontTarget.texture;
            stitch.b.value = rearTarget.texture;
          }
        }),
      );
    },
    dispose(afterIdle?: () => void) {
      disposed = true;
      void workQueue.then(() => {
        encoderSurface.dispose();
        captureTarget.dispose();
        afterIdle?.();
      });
    },
  };
}
