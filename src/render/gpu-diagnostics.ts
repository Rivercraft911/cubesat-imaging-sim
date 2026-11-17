import type { WebGPURenderer } from "three/webgpu";

/** Keep driver diagnostics attached to the real application shader sources. */
export function installGpuDiagnostics(renderer: WebGPURenderer, onOutOfMemory?: (message: string) => void) {
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const seen = new Set<string>();
  const report = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    console.error(message);
  };
  const onError = (event: GPUUncapturedErrorEvent) => {
    if (typeof GPUOutOfMemoryError !== "undefined" && event.error instanceof GPUOutOfMemoryError) {
      const message = `The GPU ran out of memory. ${event.error.message}`.trim();
      report(message);
      onOutOfMemory?.(message);
    } else {
      report(`[WebGPU] ${event.error.message}`);
    }
  };
  device.addEventListener("uncapturederror", onError);
  const original = device.createShaderModule;
  device.createShaderModule = function (descriptor: GPUShaderModuleDescriptor) {
    const module = original.call(device, descriptor);
    void module
      .getCompilationInfo?.()
      .then((info) => {
        if (!info.messages.some((message) => message.type === "error")) return;
        const lines = descriptor.code.split("\n");
        for (const message of info.messages) {
          if (message.type !== "error") continue;
          const start = Math.max(0, message.lineNum - 3);
          const excerpt = lines
            .slice(start, message.lineNum + 2)
            .map((line, index) => `${start + index + 1}: ${line}`)
            .join("\n");
          report(
            `[WGSL ${descriptor.label ?? "shader"}] ${message.lineNum}:${message.linePos} ${message.message}\n${excerpt}`,
          );
        }
      })
      .catch((error: unknown) => report(`[WGSL diagnostics] ${String(error)}`));
    return module;
  };
  return () => {
    device.createShaderModule = original;
    device.removeEventListener("uncapturederror", onError);
  };
}
