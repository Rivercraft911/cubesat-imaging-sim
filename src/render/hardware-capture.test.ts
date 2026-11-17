import * as THREE from "three/webgpu";
import { expect, it, vi } from "vitest";
import { createDefaultScenario, sampleState } from "../sim";
import { createHardwareCapture } from "./hardware-capture";

it("renders only the requested hardware cube and reuses it across lens edits", () => {
  const draw = vi.spyOn(THREE.CubeCamera.prototype, "update").mockImplementation(() => {});
  const renderer = {
    getRenderTarget: () => null, setRenderTarget: vi.fn(),
    getClearColor: vi.fn(), setClearColor: vi.fn(), getClearAlpha: () => 1,
  } as unknown as THREE.WebGPURenderer;
  const scene = new THREE.Scene();
  scene.environment = new THREE.Texture();
  const capture = createHardwareCapture(renderer, scene);
  try {
    const scenario = createDefaultScenario();
    const sample = sampleState(scenario, 0);
    const wideA = scenario.cameras.find(c => c.id === "wideA")!;
    const wideB = scenario.cameras.find(c => c.id === "wideB")!;
    const main = scenario.cameras.find(c => c.id === "main")!;
    capture.update(wideA, sample, 0);
    expect(draw).toHaveBeenCalledTimes(1);
    capture.update({ ...wideA, lens: { ...wideA.lens, focalLengthMm: 2 } }, sample, 0);
    expect(draw).toHaveBeenCalledTimes(1);
    capture.update(wideB, sample, 0);
    capture.update(main, sample, 0);
    capture.update(wideB, sample, 0);
    expect(draw).toHaveBeenCalledTimes(3);
    capture.update(wideA, sample, 0); // Main displaced Wide A.
    capture.update(wideA, sample, 1); // New hardware geometry.
    capture.update(wideA, sampleState(scenario, 1), 1);
    expect(draw).toHaveBeenCalledTimes(6);
  } finally {
    draw.mockRestore();
    capture.dispose();
    scene.environment.dispose();
  }
});
