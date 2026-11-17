import { expect, it, vi } from "vitest";
import type { WebGPURenderer } from "three/webgpu";
import { installGpuDiagnostics } from "./gpu-diagnostics";

it("returns native shaders when the browser lacks compilation diagnostics", () => {
  const shader = {};
  const original = vi.fn((_descriptor: GPUShaderModuleDescriptor) => shader);
  const device = Object.assign(new EventTarget(), { createShaderModule: original });
  const uninstall = installGpuDiagnostics({ backend: { device } } as unknown as WebGPURenderer);
  const descriptor = { code: "@compute @workgroup_size(1) fn main() {}" };
  expect(device.createShaderModule(descriptor)).toBe(shader);
  expect(original).toHaveBeenCalledWith(descriptor);
  uninstall();
  expect(device.createShaderModule).toBe(original);
});

it("reports an uncaptured allocation failure to the recovery screen", () => {
  class TestOutOfMemory extends Error {}
  vi.stubGlobal("GPUOutOfMemoryError", TestOutOfMemory);
  const device = Object.assign(new EventTarget(), { createShaderModule: vi.fn() });
  const recover = vi.fn();
  const uninstall = installGpuDiagnostics({ backend: { device } } as unknown as WebGPURenderer, recover);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const event = Object.assign(new Event("uncapturederror"), { error: new TestOutOfMemory("allocation failed") });
    device.dispatchEvent(event);
    expect(recover).toHaveBeenCalledWith("The GPU ran out of memory. allocation failed");
    uninstall();
    device.dispatchEvent(event);
    expect(recover).toHaveBeenCalledOnce();
  } finally {
    error.mockRestore();
    vi.unstubAllGlobals();
  }
});
