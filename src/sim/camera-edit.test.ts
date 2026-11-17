import { expect, it } from 'vitest';
import { createDefaultScenario } from './catalog';
import { editCamera } from './camera-edit';

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
