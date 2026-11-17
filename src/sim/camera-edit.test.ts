import { expect, it } from 'vitest';
import { cameraBodyRotation } from './camera';
import { createDefaultScenario } from './catalog';
import { editCamera, wideMountBodyYM } from './camera-edit';
import { add, length, rotate } from './math';
import type { CameraConfig } from './types';

function expectOpposedBoresights(first: CameraConfig, second: CameraConfig) {
  const firstForward = rotate(cameraBodyRotation(first), [0, 0, 1]);
  const secondForward = rotate(cameraBodyRotation(second), [0, 0, 1]);
  expect(length(add(firstForward, secondForward))).toBeLessThan(1e-12);
}

it('links wide optics and mirrors mounts without changing the main camera', () => {
  const scenario = createDefaultScenario();
  const edited = editCamera(scenario, 'wideA', { positionBodyM: [-0.03, 0.06, 0.04], yawDeg: 12, sensorId: 'imx477' });
  expect(edited.cameras[0]).toBe(scenario.cameras[0]);
  expect(edited.cameras[2].positionBodyM).toEqual([0.03, -0.06, 0.04]);
  expect(edited.cameras[2].yawDeg).toBe(12);
  expect(edited.cameras[2].sensorId).toBe('imx477');
  expect(edited.cameras[2].id).toBe('wideB');
  expect(scenario.cameras[1].yawDeg).toBe(0);
});

it('mirrors rear edits back to the front and keeps main edits independent', () => {
  const scenario = createDefaultScenario();
  const paired = editCamera(scenario, 'wideB', { positionBodyM: [0.02, -0.07, 0.035] });
  expect(paired.cameras[1].positionBodyM).toEqual([-0.02, 0.07, 0.035]);
  const main = editCamera(paired, 'main', { housingLengthMm: 40 });
  expect(main.cameras[1]).toBe(paired.cameras[1]);
  expect(main.cameras[2]).toBe(paired.cameras[2]);
});

it.each([
  ['wideA', 1, 2],
  ['wideB', 2, 1],
] as const)('keeps the boresights opposite when aiming %s', (id, driverIndex, partnerIndex) => {
  const { cameras } = editCamera(createDefaultScenario(), id, { yawDeg: 27, pitchDeg: -19, rollDeg: 31 });
  const driver = cameras[driverIndex];
  const partner = cameras[partnerIndex];
  expect(driver).toMatchObject({ yawDeg: 27, pitchDeg: -19, rollDeg: 31 });
  expect(partner).toMatchObject({ yawDeg: 27, pitchDeg: 19, rollDeg: 31 });
  expectOpposedBoresights(driver, partner);
});

it('repairs a saved common pitch when only yaw is edited', () => {
  const scenario = createDefaultScenario();
  scenario.cameras[1].pitchDeg = 19;
  scenario.cameras[2].pitchDeg = 19;

  const { cameras } = editCamera(scenario, 'wideB', { yawDeg: -27 });
  expect(cameras[2]).toMatchObject({ yawDeg: -27, pitchDeg: 19 });
  expect(cameras[1]).toMatchObject({ yawDeg: -27, pitchDeg: -19 });
  expectOpposedBoresights(cameras[1], cameras[2]);
});

it('preserves saved wide camera poses when editing optics', () => {
  const scenario = createDefaultScenario();
  Object.assign(scenario.cameras[1], { yawDeg: 10, pitchDeg: 19, rollDeg: 5 });
  Object.assign(scenario.cameras[2], { yawDeg: 20, pitchDeg: 19, rollDeg: -8 });

  const { cameras } = editCamera(scenario, 'wideA', { sensorId: 'imx477' });
  expect(cameras[1]).toEqual({ ...scenario.cameras[1], sensorId: 'imx477' });
  expect(cameras[2]).toEqual({ ...scenario.cameras[2], sensorId: 'imx477' });
});

it.each(['wideA', 'wideB'] as const)('adds 2 mm outward to both mounts when editing %s', id => {
  const scenario = editCamera(createDefaultScenario(), 'wideA', { yawDeg: 12, pitchDeg: -4, rollDeg: 3 });
  const [x, y, z] = scenario.cameras.find(camera => camera.id === id)!.positionBodyM;
  expect(wideMountBodyYM(id, scenario.body.depthM)).toBeCloseTo(y, 12);

  const positionBodyM = [x, wideMountBodyYM(id, scenario.body.depthM, 2), z] as [number, number, number];
  const edited = editCamera(scenario, id, { positionBodyM });
  expect(edited.cameras[0]).toBe(scenario.cameras[0]);
  for (const [index, expectedY] of [[1, 0.057], [2, -0.057]] as const) {
    const old = scenario.cameras[index];
    expect(edited.cameras[index]).toEqual({
      ...old,
      positionBodyM: [old.positionBodyM[0], expect.closeTo(expectedY, 12), old.positionBodyM[2]],
    });
  }
});
