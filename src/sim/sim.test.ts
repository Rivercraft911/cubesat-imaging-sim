import { describe, expect, it } from 'vitest';
import { EARTH_EQUATORIAL_RADIUS_M, EARTH_POLAR_RADIUS_M, cameraPose, computeMetrics, createDefaultScenario, ecefToGeodetic, geodeticToEcef, getSensor, intersectEarth, parseScenario, projectPoint, rayForPixel, rotate, sampleState } from './index';
import { DEG, dot, length, normalize, scale, sub, wrap } from './math';
import { localUp } from './earth';
import { daysSinceJ2000, greenwichSiderealRad, meanSunRaRad } from './sun';
import type { Scenario, SimulationSample, Vec3 } from './types';

const WGS84_A = 6_378_137;

describe('reference ellipsoid', () => {
  it('intersects the first surface along equatorial and polar rays, and rejects rays to space', () => {
    const origin: Vec3 = [WGS84_A + 550_000, 0, 0];
    expect(intersectEarth(origin, [-1, 0, 0])?.[0]).toBeCloseTo(EARTH_EQUATORIAL_RADIUS_M, 6);
    expect(intersectEarth([0, 0, 7e6], [0, 0, -1])?.[2]).toBeCloseTo(EARTH_POLAR_RADIUS_M, 6);
    expect(intersectEarth(origin, [1, 0, 0])).toBeNull();
    expect(intersectEarth(origin, [0, 1, 0])).toBeNull();
  });

  it('round trips WGS 84 coordinates across surface, orbit, and pole cases', () => {
    for (const [latitudeDeg, longitudeDeg, heightM] of [[37.4275, -122.1697, 123], [-42, 120, 550_000], [90, -60, 10]]) {
      const geodetic = ecefToGeodetic(geodeticToEcef(latitudeDeg, longitudeDeg, heightM));
      expect(geodetic.latitudeDeg).toBeCloseTo(latitudeDeg, 8);
      expect(geodetic.longitudeDeg).toBeCloseTo(longitudeDeg, 8);
      expect(geodetic.heightM).toBeCloseTo(heightM, 5);
    }
  });
});

describe('constructed pass', () => {
  it('passes Stanford at the specified altitude with circular speed and a moving ECEF frame', () => {
    const scenario = createDefaultScenario();
    const state = sampleState(scenario);
    expect(state.targetSlantRangeM).toBeCloseTo(550_000, 6);
    expect(state.targetElevationDeg).toBeGreaterThan(89.8);
    expect(state.inclinationDeg).toBeGreaterThan(97.4);
    expect(state.inclinationDeg).toBeLessThan(97.8);
    expect(state.groundSpeedMps).toBeGreaterThan(6900);
    expect(state.groundSpeedMps).toBeLessThan(7400);
    expect(state.epochISO.slice(0, 10)).toBe('2026-10-03');

    const p0 = sampleState(scenario, -0.05).positionEcefM;
    const p1 = sampleState(scenario, 0.05).positionEcefM;
    expect(length(sub(scale(sub(p1, p0), 10), state.velocityEcefMps))).toBeLessThan(1e-4);
    expect(length(sampleState(scenario, 360).positionEcefM)).toBeCloseTo(length(state.positionEcefM), 7);
  });

  it('opens on an October near-terminator pass without changing altitude or LTAN', () => {
    const scenario = createDefaultScenario();
    expect(scenario).toMatchObject({ altitudeM: 550_000, ltanHours: 18, ascending: true });
    const center = sampleState(scenario);
    expect(Math.abs(center.sunElevationDeg)).toBeLessThan(0.1);
    for (let timeS = -360; timeS <= 360; timeS += 30) {
      const state = sampleState(scenario, timeS);
      const { latitudeDeg, longitudeDeg } = ecefToGeodetic(state.positionEcefM);
      const solarElevation = Math.asin(dot(localUp(latitudeDeg, longitudeDeg), state.sunDirectionEcef)) / DEG;
      expect(Math.abs(solarElevation)).toBeLessThan(2);
    }
  });

  it.each([true, false])('preserves LTAN for either heading (ascending: %s)', ascending => {
    const scenario = { ...createDefaultScenario(), ascending, passOffsetKm: 447, ltanHours: 18 };
    let before = -4000;
    let after = 0;
    for (let step = 0; step < 4000; step += 20) {
      const t = before + 20;
      if (sampleState(scenario, before).positionEcefM[2] <= 0 && sampleState(scenario, t).positionEcefM[2] >= 0) {
        after = t;
        break;
      }
      before = t;
    }
    expect(before).toBeLessThan(0);
    for (let step = 0; step < 40; step += 1) {
      const mid = (before + after) / 2;
      if (sampleState(scenario, mid).positionEcefM[2] < 0) before = mid;
      else after = mid;
    }
    const nodeState = sampleState(scenario, (before + after) / 2);
    const node = nodeState.positionEcefM;
    expect(node[2]).toBeCloseTo(0, 4);
    expect(nodeState.velocityEcefMps[2]).toBeGreaterThan(0);
    const day = daysSinceJ2000(Date.parse(nodeState.epochISO));
    const hourAngle = greenwichSiderealRad(day) + Math.atan2(node[1], node[0]) - meanSunRaRad(day);
    expect(wrap(12 + hourAngle / DEG / 15, 24)).toBeCloseTo(18, 6);
    expect(Math.sign(sampleState(scenario).velocityEcefMps[2])).toBe(ascending ? 1 : -1);
  });

  it.each([-1500, -200, 200, 1500])('centers time on lateral closest approach (%d km)', passOffsetKm => {
    const scenario = { ...createDefaultScenario(), passOffsetKm };
    const state = sampleState(scenario);
    const target = state.targetEcefM;
    const targetAngle = Math.acos(dot(normalize(target), normalize(state.positionEcefM)));
    expect(targetAngle * length(target) / 1000).toBeCloseTo(Math.abs(passOffsetKm), 7);
    const rangeRate = dot(normalize(sub(state.positionEcefM, target)), state.velocityEcefMps);
    expect(rangeRate).toBeCloseTo(0, 6);
    expect(sampleState(scenario, -1).targetSlantRangeM).toBeGreaterThan(state.targetSlantRangeM);
    expect(sampleState(scenario, 1).targetSlantRangeM).toBeGreaterThan(state.targetSlantRangeM);
    expect(state.targetSlantRangeM).toBeGreaterThan(scenario.altitudeM);
    expect(state.targetElevationDeg).toBeLessThan(80);
  });
});

describe('camera coordinates and optics', () => {
  it('locks the main mount and applies wide camera pose in body coordinates', () => {
    const sample: SimulationSample = { ...sampleState(createDefaultScenario()), qEcefFromBody: [0, 0, 0, 1], positionEcefM: [0, 0, 0] };
    const [main, wideA, wideB] = createDefaultScenario().cameras;
    const mainPose = cameraPose(sample, { ...main, positionBodyM: [0.01, 0.02, -0.03], yawDeg: 90, pitchDeg: 31, rollDeg: -55 });
    expect(mainPose.positionEcefM).toEqual([0.01, 0.02, -0.03]);
    expect(length(sub(rotate(mainPose.qEcefFromCamera, [0, 0, 1]), [0, 1, 0]))).toBeLessThan(1e-12);
    expect(length(sub(rotate(mainPose.qEcefFromCamera, [0, 1, 0]), [0, 0, -1]))).toBeLessThan(1e-12);
    const yawed = cameraPose(sample, { ...wideA, yawDeg: 90 });
    expect(length(sub(rotate(yawed.qEcefFromCamera, [0, 0, 1]), [1, 0, 0]))).toBeLessThan(1e-12);
    const pitched = cameraPose(sample, { ...wideB, pitchDeg: 90 });
    expect(length(sub(rotate(pitched.qEcefFromCamera, [0, 0, 1]), [0, 0, 1]))).toBeLessThan(1e-12);
  });

  it('aims body +Y toward the Sun through roll and offset changes', () => {
    const scenario: Scenario = { ...createDefaultScenario(), pointing: 'sun', rollDeg: 55, offNadirDeg: 12 };
    const sample = sampleState(scenario, 36);
    const bodyFront = rotate(sample.qEcefFromBody, [0, 1, 0]);
    expect(length(sub(bodyFront, sample.sunDirectionEcef))).toBeLessThan(1e-12);
    expect(computeMetrics(scenario, 'main', 36).groundVisible).toBe(false);
  });

  it('round trips rectilinear and fisheye pixel-edge rays with a circular cutoff', () => {
    const scenario = createDefaultScenario();
    const sample = sampleState(scenario);
    for (const camera of scenario.cameras) {
      const sensor = getSensor(camera.sensorId);
      const pose = cameraPose(sample, camera);
      const point: [number, number] = [sensor.width / 2 + 203.5, sensor.height / 2 - 87.5];
      const ray = rayForPixel(camera, sensor, ...point);
      expect(ray).not.toBeNull();
      const worldVector = scale(rotate(pose.qEcefFromCamera, ray!), 550_000);
      const worldPoint: Vec3 = [0, 1, 2].map(i => pose.positionEcefM[i] + worldVector[i]) as Vec3;
      const hit = projectPoint(camera, sensor, pose, worldPoint);
      expect(hit?.[0]).toBeCloseTo(point[0], 7);
      expect(hit?.[1]).toBeCloseTo(point[1], 7);
    }
    const wide = scenario.cameras[1];
    const sensor = getSensor(wide.sensorId);
    expect(rayForPixel(wide, sensor, 0.5, 0.5)).toBeNull();
    expect(rayForPixel(wide, sensor, sensor.width / 2, 0)?.[2]).toBeCloseTo(Math.cos(95 * DEG), 12);
  });

  it('uses the full IMX676 recording area and sizes the default optics for it', () => {
    const scenario = createDefaultScenario();
    for (const camera of scenario.cameras) {
      expect(camera.sensorId).toBe('imx676');
      expect(getSensor(camera.sensorId)).toMatchObject({ width: 3536, height: 3536, pixelPitchUm: 2, shutter: 'rolling' });
    }
    const [main, ...wide] = scenario.cameras;
    const sensor = getSensor('imx676');
    expect(rayForPixel(main, sensor, 0, 0)).not.toBeNull();
    expect(rayForPixel(main, sensor, 3536, 3536)).not.toBeNull();
    for (const camera of wide) {
      expect(camera.lens.imageCircleMm).toBeCloseTo(7.072, 10);
      expect(camera.lens.focalLengthMm).toBeCloseTo(2.1326, 3);
      const metrics = computeMetrics(scenario, camera.id);
      expect(metrics.horizontalFovDeg).toBeCloseTo(190, 10);
      expect(metrics.verticalFovDeg).toBeCloseTo(190, 10);
    }
  });

  it('reports center GSD, aperture, diffraction, and tracking-dependent exposure motion', () => {
    const scenario = createDefaultScenario();
    const main = computeMetrics(scenario, 'main');
    // The body tracks the target. The front camera keeps its fixed orientation
    // and the mounting translation shifts the target by lens parallax.
    expect(main.targetPixel?.[0]).toBeCloseTo(1768 + 0.023 * 12_500 / 550_000, 6);
    expect(main.targetPixel?.[1]).toBeCloseTo(1768 - 0.022 * 12_500 / 550_000, 6);
    expect(main.gsdXM).toBeCloseTo(44, 2);
    expect(main.gsdYM).toBeCloseTo(44, 2);
    expect(main.footprintWidthM).toBeCloseTo(155_700, -2);
    expect(main.footprintHeightM).toBeCloseTo(155_700, -2);
    expect(main.apertureMm).toBe(6.25);
    expect(main.airyDiameterPx).toBeCloseTo(2.684, 9);
    expect(main.smearPx).toBeLessThan(1e-6);
    const nadir = computeMetrics({ ...scenario, pointing: 'nadir' }, 'main');
    expect(nadir.smearPx).toBeGreaterThan(0.145);
    expect(nadir.smearPx).toBeLessThan(0.195);
    const tilted = computeMetrics({ ...scenario, offNadirDeg: 50 }, 'main');
    expect(tilted.gsdXM).toBeGreaterThan(tilted.gsdYM * 1.4);
    const rear = computeMetrics(scenario, 'wideB');
    expect(rear.groundVisible).toBe(false);
    expect(rear.gsdM).toBeNaN();
    expect(computeMetrics(scenario, 'wideA').verticalFovDeg).toBeCloseTo(190, 10);
  });
});

describe('scenario interchange', () => {
  it('preserves the IMX678 and its lens settings in a saved scenario', () => {
    const scenario = createDefaultScenario();
    const main = scenario.cameras[0];
    main.sensorId = 'imx678';
    main.lens.imageCircleMm = 9;
    const parsed = parseScenario(JSON.parse(JSON.stringify(scenario)));
    expect(parsed.cameras[0]).toEqual(main);
    expect(getSensor(parsed.cameras[0].sensorId)).toMatchObject({ width: 3840, height: 2160, pixelPitchUm: 2 });
  });

  it('round trips version 1 and supports an editable custom sensor', () => {
    const scenario = createDefaultScenario();
    expect(parseScenario(JSON.parse(JSON.stringify(scenario)))).toEqual(scenario);
    scenario.customSensor = { width: 1920, height: 1440, pixelPitchUm: 4.4, shutter: 'global' };
    scenario.cameras[0].sensorId = 'custom';
    scenario.cameras[0].yawDeg = 45;
    const parsed = parseScenario(scenario);
    expect(parsed.cameras[0].yawDeg).toBe(0);
    expect(getSensor('custom', parsed.customSensor)).toMatchObject(scenario.customSensor);
  });

  it('rejects nonfinite numbers, duplicate cameras, impossible passes, and invalid dates', () => {
    const scenario = createDefaultScenario();
    expect(() => parseScenario({ ...scenario, altitudeM: Infinity })).toThrow(/altitude/);
    expect(() => parseScenario({ ...scenario, cameras: [scenario.cameras[0], ...scenario.cameras.slice(0, 2)] })).toThrow(/once each/);
    expect(() => parseScenario({ ...scenario, target: { ...scenario.target, latitudeDeg: 90 } })).toThrow(/latitude/);
    expect(() => parseScenario({ ...scenario, epochISO: '2026-02-31' })).toThrow(/date/);
  });
});
