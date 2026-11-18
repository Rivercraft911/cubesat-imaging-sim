import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three/webgpu";
import { createCapturePipeline } from "./capture-pipeline";

afterEach(() => vi.unstubAllGlobals());

it("restores Space tone mapping and target after failure, then accepts the next capture", async () => {
  const originalTarget = new THREE.RenderTarget(1, 1);
  let target: THREE.RenderTarget | null = originalTarget;
  let fail = true;
  const putImageData = vi.fn();
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ putImageData }),
    }),
  });
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  const renderer = {
    toneMapping: THREE.AgXToneMapping,
    backend: { device: { limits: { maxTextureDimension2D: 8192 } } },
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.RenderTarget | null) => {
      target = next;
    },
    getClearColor: (color: THREE.Color) => color.set(0x123456),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
    clear: vi.fn(),
    render: () => {
      expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
      if (fail) {
        fail = false;
        throw new Error("GPU submission failed");
      }
    },
    readRenderTargetPixelsAsync: async () => new Uint8Array(512),
  };
  const input: Partial<Parameters<typeof createCapturePipeline>[0]> = {
    renderer: renderer as unknown as THREE.WebGPURenderer,
    quadScene: new THREE.Scene(),
    quadCamera: new THREE.Camera(),
    withTime: (_pts, draw) => draw(),
    config: () => ({}) as never,
    sensorInfo: () => ({ width: 64, height: 2 }) as never,
    sources: { native: () => {}, panorama: () => {} },
    changed: vi.fn(),
  };
  const capture = createCapturePipeline(
    input as Parameters<typeof createCapturePipeline>[0],
  );
  await expect(capture.canvas("main")).rejects.toThrow("GPU submission failed");
  expect(renderer.toneMapping).toBe(THREE.AgXToneMapping);
  expect(target).toBe(originalTarget);
  expect(capture.busy).toBe(false);
  const frame = await capture.canvas("main");
  expect([frame.width, frame.height]).toEqual([64, 2]);
  expect(putImageData).toHaveBeenCalledOnce();
  expect(renderer.toneMapping).toBe(THREE.AgXToneMapping);
  expect(target).toBe(originalTarget);
  capture.dispose();
  originalTarget.dispose();
});

it("rejects invalid dimensions before drawing sources or allocating a decoded stitch", async () => {
  vi.stubGlobal("document", { createElement: () => ({}) });
  const native = vi.fn(), configureStitch = vi.fn();
  const renderer = {
    backend: { device: { limits: { maxTextureDimension2D: 8192 } } },
    getRenderTarget: vi.fn(), setRenderTarget: vi.fn(),
    getClearColor: vi.fn(), getClearAlpha: vi.fn(), setClearColor: vi.fn(),
  };
  const input = {
    renderer, withTime: (_pts: unknown, draw: () => void) => draw(),
    config: vi.fn(), sensorInfo: () => ({ width: 64, height: 2 }),
    sources: { native }, configureStitch, changed: vi.fn(),
  };
  const capture = createCapturePipeline(input as unknown as Parameters<typeof createCapturePipeline>[0]);
  const frame = {} as HTMLCanvasElement;
  for (const size of [0, 2.5, 8193]) {
    await expect(capture.canvas("main", size, 2)).rejects.toThrow(RangeError);
    await expect(capture.stitchDecodedFrames(frame, frame, 2, size)).rejects.toThrow(RangeError);
  }
  expect(native).not.toHaveBeenCalled();
  expect(configureStitch).not.toHaveBeenCalled();
  capture.dispose();
});
