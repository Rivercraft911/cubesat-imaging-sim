import { expect, it, vi } from "vitest";
import { CanvasTexture, type TextureNode } from "three/webgpu";
import { createDefaultScenario, sampleState } from "../sim";
import { createPanoramaViewer, initialPanoramaDirection } from "./panorama-viewer";

it("replaces a resized received panorama texture and reuses it for same-size frames", () => {
  const output = new EventTarget() as HTMLCanvasElement;
  const frame = { width: 2160, height: 1080 } as HTMLCanvasElement;
  const viewer = createPanoramaViewer(output, () => false, () => {});
  const sampledTexture = () => (viewer.material.colorNode as TextureNode).value;
  try {
    viewer.setReceived(frame);
    const original = sampledTexture();
    expect(original).toBeInstanceOf(CanvasTexture);
    const disposeOriginal = vi.fn();
    original.addEventListener("dispose", disposeOriginal);

    frame.width = 288;
    frame.height = 144;
    viewer.setReceived(frame);

    const replacement = sampledTexture();
    expect(replacement).toBeInstanceOf(CanvasTexture);
    expect(replacement).not.toBe(original);
    expect([replacement.width, replacement.height]).toEqual([288, 144]);
    expect(disposeOriginal).toHaveBeenCalledOnce();

    const version = replacement.version;
    const disposeReplacement = vi.fn();
    replacement.addEventListener("dispose", disposeReplacement);
    viewer.setReceived(frame);

    expect(sampledTexture()).toBe(replacement);
    expect(replacement.version).toBeGreaterThan(version);
    expect(disposeReplacement).not.toHaveBeenCalled();
  } finally {
    viewer.dispose();
  }
});


it("enters the panorama along the previous sensor axis, including tilted rear mounts", () => {
  const scenario = createDefaultScenario();
  const sample = sampleState(scenario, 150);
  const [main, wideA, wideB] = scenario.cameras;
  const direction = (camera?: typeof main) => initialPanoramaDirection(sample, camera);
  expect(direction(main).y).toBeCloseTo(1, 12);
  expect(direction(wideA).y).toBeCloseTo(1, 12);
  expect(direction(wideB).y).toBeCloseTo(-1, 12);
  const tilted = direction({ ...wideB, pitchDeg: 30, rollDeg: 17 });
  expect(tilted.y).toBeCloseTo(-Math.sqrt(3) / 2, 12);
  expect(tilted.z).toBeCloseTo(0.5, 12);
  expect(direction().angleTo(direction(main))).toBeGreaterThan(0.5);
});
