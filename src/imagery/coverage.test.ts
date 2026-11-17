import { describe, expect, it } from 'vitest';
import { insetCoverage } from './coverage';

describe('survey coverage blending', () => {
  it('keeps a NoData hole empty, tapers its rim, and retains interior coverage', () => {
    const rgba = new Uint8ClampedArray(13 * 13 * 4).fill(255);
    rgba[(6 * 13 + 6) * 4 + 3] = 0;
    const mask = insetCoverage(rgba, 13, 13, 4);
    expect(mask[6 * 13 + 6]).toBe(0);
    expect(mask[6 * 13 + 7]).toBeGreaterThan(0);
    expect(mask[6 * 13 + 7]).toBeLessThan(mask[6 * 13 + 8]);
    expect(mask[6 * 13 + 10]).toBe(255);
    expect(rgba[(6 * 13 + 7) * 4 + 3]).toBe(255);
  });
  it('does not mistake dark valid water for missing coverage', () => {
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    expect([...insetCoverage(rgba, 8, 8, 4)].every(a => a === 255)).toBe(true);
  });
});
