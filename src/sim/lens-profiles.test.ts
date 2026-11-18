import { expect, it } from 'vitest';
import { axisFovDeg, projectPoint, rayForPixel, usableRadiusMm } from './camera';
import { createDefaultScenario, getSensor } from './catalog';
import { applyLensProfile, LENS_PROFILES } from './lens-profiles';
import { parseScenario } from './scenario';
import type { CameraPose, Vec3 } from './types';

const camera = createDefaultScenario().cameras[1];
const sensor = getSensor(camera.sensorId);
const pitchMm = sensor.pixelPitchUm / 1000;
const pose: CameraPose = { positionEcefM: [0, 0, 0], qEcefFromCamera: [0, 0, 0, 1] };

it.each(LENS_PROFILES)('fits $name to its nominal round image on the IMX676', profile => {
  const lens = applyLensProfile({ ...camera.lens, extraBlurPx: 2 }, profile.id);
  const configured = { ...camera, lens };
  expect(lens).toEqual({ ...profile.optics, profileId: profile.id, extraBlurPx: 2 });
  const radius = lens.imageCircleMm / 2;
  expect(usableRadiusMm(lens)).toBeCloseTo(radius, 12);
  expect(axisFovDeg(lens, sensor.width * pitchMm)).toBeCloseTo(lens.maxFovDeg, 12);
  expect(axisFovDeg(lens, sensor.height * pitchMm)).toBeCloseTo(lens.maxFovDeg, 12);
  expect(rayForPixel(configured, sensor, 0.5, 0.5)).toBeNull();
  const edge = rayForPixel(configured, sensor, sensor.width / 2 + radius / pitchMm, sensor.height / 2);
  expect(edge?.[2]).toBeCloseTo(Math.cos(lens.maxFovDeg * Math.PI / 360), 12);
  expect(rayForPixel(configured, sensor, sensor.width / 2 + (radius + 0.0005) / pitchMm, sensor.height / 2)).toBeNull();
});

it.each(LENS_PROFILES)('inverts the radial model for $name and retains its paraxial focal length', profile => {
  const lens = applyLensProfile(camera.lens, profile.id);
  const configured = { ...camera, lens };
  for (const fraction of [1e-5, 0.1, 0.5, 0.95, 1]) {
    const angle = fraction * lens.maxFovDeg * Math.PI / 360;
    const ray: Vec3 = [Math.sin(angle) * 0.6, Math.sin(angle) * 0.8, Math.cos(angle)];
    const pixel = projectPoint(configured, sensor, pose, ray)!;
    expect(pixel).not.toBeNull();
    const recovered = rayForPixel(configured, sensor, ...pixel)!;
    recovered.forEach((component, index) => expect(component).toBeCloseTo(ray[index], 12));
    if (fraction < 0.001) {
      const radiusMm = Math.hypot(pixel[0] - sensor.width / 2, pixel[1] - sensor.height / 2) * pitchMm;
      expect(radiusMm / angle).toBeCloseTo(lens.focalLengthMm, 8);
    }
  }
});

it('preserves version-1 lens settings and treats an explicit zero factor as ideal equidistant', () => {
  const generic = { ...camera, lens: { ...camera.lens, fThetaEdgeFactor: 0 } };
  expect(usableRadiusMm(generic.lens)).toBe(usableRadiusMm(camera.lens));
  expect(rayForPixel(generic, sensor, 900, 1000)).toEqual(rayForPixel(camera, sensor, 900, 1000));
  const scenario = createDefaultScenario();
  expect(parseScenario(scenario).cameras[1].lens).toEqual(camera.lens);
  scenario.cameras[1].lens = applyLensProfile(camera.lens, 'framos-l185a');
  expect(parseScenario(JSON.parse(JSON.stringify(scenario))).cameras[1].lens).toEqual(scenario.cameras[1].lens);
});
