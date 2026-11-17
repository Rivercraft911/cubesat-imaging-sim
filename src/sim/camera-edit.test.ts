import { expect, it } from 'vitest';
import { createDefaultScenario } from './catalog';
import { editCamera, wideMountBodyYM } from './camera-edit';

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
