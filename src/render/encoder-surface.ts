import type { RenderTarget, WebGPURenderer } from "three/webgpu";

/** Three r184 exposes the resolved color texture through its WebGPU backend.
 * Copy its sRGB bytes to a canvas on the same device before the next render.
 * VideoFrame snapshots that canvas. Browsers may make their own internal copy. */
export function createEncoderSurface(renderer: WebGPURenderer) {
  const canvas = document.createElement("canvas");
  const backend = renderer.backend as unknown as {
    device: GPUDevice;
    get(texture: RenderTarget["texture"]): { texture?: GPUTexture };
  };
  let context: GPUCanvasContext | null = null;
  let unavailable = false;
  return {
    frame(target: RenderTarget, init: VideoFrameInit): VideoFrame | null {
      if (unavailable) return null;
      try {
        const source = backend.get(target.texture).texture;
        if (!source || !["rgba8unorm", "rgba8unorm-srgb"].includes(source.format)
          || !(source.usage & GPUTextureUsage.COPY_SRC)) return null;
        if (!context) {
          context = canvas.getContext("webgpu");
          if (!context) { unavailable = true; return null; }
          context.configure({
            device: backend.device, format: "rgba8unorm", alphaMode: "opaque",
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          });
        }
        if (canvas.width !== target.width) canvas.width = target.width;
        if (canvas.height !== target.height) canvas.height = target.height;
        const command = backend.device.createCommandEncoder();
        command.copyTextureToTexture({ texture: source }, { texture: context.getCurrentTexture() },
          [target.width, target.height, 1]);
        backend.device.queue.submit([command.finish()]);
        return new VideoFrame(canvas, init);
      } catch {
        // A browser can support WebGPU rendering without accepting this canvas as a frame.
        unavailable = true;
        context?.unconfigure();
        context = null;
        return null;
      }
    },
    dispose() { context?.unconfigure(); },
  };
}
