import { describe, expect, it } from 'vitest';
import {
  cameraPose, createDefaultScenario, ecefToGeodetic, getSensor,
  intersectEarth, rayForPixel, rotate, sampleState,
} from '../sim';
import { mercator, shotBounds } from './bounds';

describe('imagery request bounds', () => {
  it('rebuilds camera-frame rays after a focal-length or custom-sensor change', () => {
    const scenario = createDefaultScenario();
    const main = scenario.cameras.find(camera => camera.id === 'main')!;
    main.sensorId = 'custom';
    scenario.customSensor = { width: 3840, height: 2160, pixelPitchUm: 2, shutter: 'rolling' };
    const timeS = 17;
    const width = (bounds: ReturnType<typeof shotBounds>) => bounds[2] - bounds[0];
    const initial = shotBounds(scenario, timeS);
    main.lens.focalLengthMm *= 2;
    const telephoto = shotBounds(scenario, timeS);
    expect(width(telephoto)).toBeLessThan(width(initial));
    scenario.customSensor.pixelPitchUm /= 2;
    expect(width(shotBounds(scenario, timeS))).toBeLessThan(width(telephoto));
    main.lens.focalLengthMm /= 2;
    scenario.customSensor.pixelPitchUm *= 2;
    expect(shotBounds(scenario, timeS)).toEqual(initial);
  });

  it.each([
    { imageCircleMm: 11, offNadirDeg: 0, shape: 'rectangular' },
    { imageCircleMm: 8, offNadirDeg: 24, shape: 'clipped rectangle' },
    { imageCircleMm: 4, offNadirDeg: 24, shape: 'circular' },
  ])('contains Earth hits across the $shape footprint', ({ imageCircleMm, offNadirDeg }) => {
    const base = createDefaultScenario();
    const main = base.cameras.find(camera => camera.id === 'main')!;
    const camera = {
      ...main,
      sensorId: 'imx676',
      lens: { ...main.lens, imageCircleMm, focalLengthMm: 25 },
    };
    const scenario = {
      ...base, altitudeM: 550_000, pointing: 'nadir' as const, offNadirDeg,
      cameras: base.cameras.map(previous => previous.id === 'main' ? camera : previous),
    };
    const sensor = getSensor(camera.sensorId);
    const timeS = 10;
    const pose = cameraPose(sampleState(scenario, timeS), camera);
    const [west, south, east, north] = shotBounds(scenario, timeS);
    let count = 0;
    for (let row = 0; row <= 32; row++) for (let col = 0; col <= 32; col++) {
      const ray = rayForPixel(camera, sensor, col * sensor.width / 32, row * sensor.height / 32);
      if (!ray) continue;
      const hit = intersectEarth(pose.positionEcefM, rotate(pose.qEcefFromCamera, ray));
      if (!hit) continue;
      const { latitudeDeg, longitudeDeg } = ecefToGeodetic(hit);
      const [x, y] = mercator(longitudeDeg, latitudeDeg);
      if (x < west || x > east || y < south || y > north) {
        throw new Error(`Sensor ray (${col}, ${row}) falls outside the imagery bounds`);
      }
      count++;
    }
    expect(count).toBeGreaterThan(100);
    if (offNadirDeg) {
      const [x, y] = mercator(scenario.target.longitudeDeg, scenario.target.latitudeDeg);
      expect(west <= x && x <= east && south <= y && y <= north).toBe(false);
    }
  });
});
