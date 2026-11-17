import { expect, it } from 'vitest';
import { compactGaussian, gaussianWeights } from './gaussian-kernel';

it('preserves the nine-tap response at native texel centers and clamped edges', () => {
  const row = [0.08, 3.5, 0, 0.17, 1.25, 0];
  function linear(x: number) {
    const clipped = Math.max(0, Math.min(row.length - 1, x));
    const i = Math.floor(clipped);
    return row[i] + (row[Math.min(i + 1, row.length - 1)] - row[i]) * (clipped - i);
  }
  for (const sigma of [0, 0.01, 1 / 3, 0.48, 2 / 3]) {
    const { sideWeight, offsetPx } = compactGaussian(sigma)!;
    for (let x = 0; x < row.length; x++) {
      const reference = gaussianWeights.reduce((sum, w, i) => sum + w * linear(x + (i - 4) * 0.75 * sigma), 0);
      const folded = (1 - 2 * sideWeight) * row[x] + sideWeight * (linear(x - offsetPx) + linear(x + offsetPx));
      expect(folded).toBeCloseTo(reference, 13);
    }
  }
  expect(compactGaussian(2 / 3 + 0.00001)).toBeNull();
});
