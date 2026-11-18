import { expect, it } from 'vitest';
import { editCamera } from './camera-edit';
import { createDefaultScenario } from './catalog';
import { fitWideLens, wideLensChoice } from './wide-lens';

it('fits the selected lens to both cameras without changing their placement', () => {
  const original = createDefaultScenario();
  const [, beforeA, beforeB] = original.cameras;
  const fitted = editCamera(original, 'wideA', fitWideLens(beforeA, 'commonlands-cil220'));
  const [main, wideA, wideB] = fitted.cameras;
  expect(main).toEqual(original.cameras[0]);
  for (const [camera, before] of [[wideA, beforeA], [wideB, beforeB]]) {
    expect(camera).toMatchObject({ housingDiameterMm: 14, housingLengthMm: 13.1 });
    expect(camera.positionBodyM).toEqual(before.positionBodyM);
    expect(wideLensChoice(camera.lens)).toBe('commonlands-cil220');
  }
  expect(fitWideLens(wideA, 'study')).toMatchObject({
    housingDiameterMm: beforeA.housingDiameterMm, housingLengthMm: beforeA.housingLengthMm,
  });
});

it('distinguishes generic and catalog optics from manual edits', () => {
  const wide = createDefaultScenario().cameras[1];
  expect(wideLensChoice(wide.lens)).toBe('study');
  const framos = fitWideLens(wide, 'framos-l185a');
  expect(framos).toMatchObject({ housingDiameterMm: 25.8, housingLengthMm: 12.66 });
  expect(wideLensChoice(framos.lens)).toBe('framos-l185a');
  expect(wideLensChoice({ ...framos.lens, focalLengthMm: 2 })).toBe('custom');
});
