import { expect, it } from 'vitest';
import { needsAerial } from './lod';

it('keeps broad orbital views on continuous satellite sources', () => {
  for (const gsd of [22, 44, 100, 500, Infinity, NaN]) {
    expect(needsAerial(gsd, 18.9, false)).toBe(false);
    expect(needsAerial(gsd, 18.9, true)).toBe(false);
  }
  expect(needsAerial(2.2, 18.9, false)).toBe(true);
});

it('does not alternate sources around the resolution threshold', () => {
  expect(needsAerial(18, 18.9, false)).toBe(false);
  expect(needsAerial(18, 18.9, true)).toBe(true);
  expect(needsAerial(21, 18.9, true)).toBe(false);
});
