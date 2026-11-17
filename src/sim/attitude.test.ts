import { describe, expect, it } from 'vitest';
import { targetTrackingAxes } from './attitude';
import { cameraPose, projectPoint } from './camera';
import { createDefaultScenario, getSensor } from './catalog';
import { geodeticToEcef, intersectEarth, localUp } from './earth';
import { add, cross, DEG, dot, length, normalize, rotate, scale, sub } from './math';
import { sampleState } from './orbit';
import type { Scenario, Vec3 } from './types';

function tangentNorth(latitude: number, longitude: number): Vec3 {
  // Independently obtain north as the local meridian's differential.
  return normalize(sub(geodeticToEcef(latitude + 1e-4, longitude), geodeticToEcef(latitude - 1e-4, longitude)));
}

describe('target tracking attitude', () => {
  it.each([
    [37.4275, -122.1697, 0, true],
    [37.4275, -122.1697, -1500, true],
    [37.4275, -122.1697, 1500, false],
    [-42, 140, 600, true],
    [0, 179.9, -600, false],
    [65, -20, 0, false],
  ] as const)('keeps local north up and a continuous physical body frame through the pass (%s, %s, %s km, ascending %s)', (latitudeDeg, longitudeDeg, passOffsetKm, ascending) => {
    const defaults = createDefaultScenario();
    const scenario: Scenario = { ...defaults, target: { ...defaults.target, latitudeDeg, longitudeDeg }, passOffsetKm, ascending };
    const north = tangentNorth(latitudeDeg, longitudeDeg);
    let previousUp: Vec3 | undefined;
    let previousRight: Vec3 | undefined;
    for (let timeS = -360; timeS <= 360; timeS += 1) {
      const state = sampleState(scenario, timeS);
      const forward = rotate(state.qEcefFromBody, [0, 1, 0]);
      const right = rotate(state.qEcefFromBody, [1, 0, 0]);
      const up = rotate(state.qEcefFromBody, [0, 0, 1]);
      expect(length(sub(forward, normalize(sub(state.targetEcefM, state.positionEcefM))))).toBeLessThan(1e-12);
      expect(length(sub(cross(right, forward), up))).toBeLessThan(1e-12);
      expect(length(up)).toBeCloseTo(1, 12);
      if (state.targetElevationDeg >= 0.2) {
        expect(Math.abs(dot(right, north))).toBeLessThan(1e-9);
        expect(dot(up, north)).toBeGreaterThan(0);
      }
      if (previousUp && previousRight) {
        // At 550 km the prescribed tracking rate is finite; no roll flips.
        expect(dot(previousUp, up)).toBeGreaterThan(Math.cos(5 * DEG));
        expect(dot(previousRight, right)).toBeGreaterThan(Math.cos(5 * DEG));
      }
      previousUp = up;
      previousRight = right;
    }
  });

  it('projects a local northward displacement upward in the fixed main camera throughout the visible pass', () => {
    const scenario = createDefaultScenario();
    const camera = scenario.cameras[0];
    const sensor = getSensor(camera.sensorId);
    const north = tangentNorth(scenario.target.latitudeDeg, scenario.target.longitudeDeg);
    for (const timeS of [-300, -150, 0, 150, 300]) {
      const state = sampleState(scenario, timeS);
      const pose = cameraPose(state, camera);
      const center = projectPoint(camera, sensor, pose, state.targetEcefM)!;
      const northward = projectPoint(camera, sensor, pose, add(state.targetEcefM, scale(north, 1000)))!;
      // Off-center mounting contributes only subpixel perspective parallax.
      expect(Math.abs(northward[0] - center[0])).toBeLessThan(1e-5);
      expect(northward[1]).toBeLessThan(center[1]);
    }
  });

  it.each([1, -1])('continues through the singular north/south horizon without changing boresight (%s)', sign => {
    const latitude = 37.4275;
    const longitude = -122.1697;
    const vertical = localUp(latitude, longitude);
    const azimuth = scale(tangentNorth(latitude, longitude), sign);
    let previousUp: Vec3 | undefined;
    for (let elevationDeg = 0.4; elevationDeg >= -0.4; elevationDeg -= 0.001) {
      const elevation = elevationDeg * DEG;
      const forward = normalize(add(scale(azimuth, Math.cos(elevation)), scale(vertical, -Math.sin(elevation))));
      const { right, up } = targetTrackingAxes(forward, latitude, longitude);
      expect(Math.abs(dot(up, forward))).toBeLessThan(1e-10);
      expect(length(sub(cross(right, forward), up))).toBeLessThan(1e-10);
      expect(length(up)).toBeCloseTo(1, 10);
      if (previousUp) expect(dot(previousUp, up)).toBeGreaterThan(Math.cos(0.01 * DEG));
      previousUp = up;
    }
  });

  it('keeps tracking an Earth-occluded target without making it visible', () => {
    const scenario = createDefaultScenario();
    const state = sampleState(scenario, 500);
    expect(state.targetElevationDeg).toBeLessThan(0);
    const forward = rotate(state.qEcefFromBody, [0, 1, 0]);
    const firstEarthHit = intersectEarth(state.positionEcefM, forward)!;
    expect(length(sub(firstEarthHit, state.positionEcefM))).toBeLessThan(state.targetSlantRangeM - 1000);
    expect(length(sub(forward, normalize(sub(state.targetEcefM, state.positionEcefM))))).toBeLessThan(1e-12);
  });

  it.each(['nadir', 'sun'] as const)('preserves %s pointing and roll through the pass', pointing => {
    const scenario = { ...createDefaultScenario(), pointing, rollDeg: 47 };
    for (const timeS of [-360, -180, 0, 180, 360]) {
      const state = sampleState(scenario, timeS);
      const expected = pointing === 'sun' ? state.sunDirectionEcef : normalize(scale(state.positionEcefM, -1));
      expect(length(sub(rotate(state.qEcefFromBody, [0, 1, 0]), expected))).toBeLessThan(1e-12);
    }
  });
});
