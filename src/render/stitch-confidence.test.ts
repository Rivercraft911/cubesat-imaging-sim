import { expect, it } from "vitest";
import { createDefaultScenario, computeMetrics, getSensor } from "../sim";
import {
  edgeConfidence,
  stitchEdgeFeatherPx,
  usableStitchEdgePx,
} from "./stitch-confidence";

it("removes the former one-third edge contribution within the native PSF footprint", () => {
  const scenario = createDefaultScenario(),
    camera = scenario.cameras.find((c) => c.id === "wideA")!;
  const sensor = getSensor(camera.sensorId),
    feather = stitchEdgeFeatherPx(camera, computeMetrics(scenario, "wideA"));
  expect(feather).toBeGreaterThan(2);
  expect(feather).toBeLessThan(2.1);
  const theta = (94.999 * Math.PI) / 180;
  const radiusPx =
    (camera.lens.focalLengthMm * theta) / (sensor.pixelPitchUm / 1000);
  const uv: [number, number] = [0.5 + radiusPx / sensor.width, 0.5];
  const edge = usableStitchEdgePx(sensor, camera.lens, uv);
  const a = (1 + Math.cos(theta)) ** 4,
    b = (1 - Math.cos(theta)) ** 4;
  expect(a / (a + b)).toBeGreaterThan(0.33);
  const weighted = a * edgeConfidence(edge, feather);
  expect(weighted / (weighted + b)).toBeLessThan(0.001);
  expect(edgeConfidence(feather, feather)).toBe(1);
});

it("respects angular, image-circle, sensor and encoded-crop boundaries independently", () => {
  const camera = createDefaultScenario().cameras[1],
    sensor = getSensor(camera.sensorId);
  const pitch = sensor.pixelPitchUm / 1000;
  const angular = { ...camera.lens, maxFovDeg: 120 };
  const angularRadius = (camera.lens.focalLengthMm * Math.PI) / 3 / pitch;
  expect(
    usableStitchEdgePx(sensor, angular, [
      0.5 + angularRadius / sensor.width,
      0.5,
    ]),
  ).toBeCloseTo(0, 8);
  expect(
    usableStitchEdgePx(sensor, { ...camera.lens, imageCircleMm: 6 }, [
      0.5 + 3 / pitch / sensor.width,
      0.5,
    ]),
  ).toBeCloseTo(0, 8);
  expect(
    usableStitchEdgePx(
      sensor,
      { ...camera.lens, imageCircleMm: 20, maxFovDeg: 300 },
      [1, 0.5],
    ),
  ).toBeCloseTo(0, 8);
  expect(
    usableStitchEdgePx(sensor, camera.lens, [0.8, 0.5], [0.25, 0, 0.5, 1]),
  ).toBeLessThan(0);
  expect(edgeConfidence(-1, 2)).toBe(0);
  expect(edgeConfidence(0, 2)).toBe(0);
});

it("uses the same bounded Gaussian and shutter support as native optical filtering", () => {
  const camera = createDefaultScenario().cameras[1];
  camera.lens.extraBlurPx = 100;
  expect(
    stitchEdgeFeatherPx(camera, {
      airyDiameterPx: 1,
      jitterSigmaPx: 1,
      smearPx: 1000,
    }),
  ).toBeCloseTo(1 + 3 * 24 + (4 / 9) * 256, 10);
  camera.lens.extraBlurPx = 0;
  expect(
    stitchEdgeFeatherPx(camera, {
      airyDiameterPx: 0,
      jitterSigmaPx: 0,
      smearPx: NaN,
    }),
  ).toBe(1);
});
