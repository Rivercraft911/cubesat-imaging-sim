import { describe, expect, it } from 'vitest';
import { advanceAerialArrival, aerialArrivalWeight, isAerialImage, settledAerialWeight } from './aerial-blend';

describe('whole-level aerial blending', () => {
  it('limits known aerial providers without changing satellite imagery', () => {
    expect(isAerialImage('cdfw-naip-2022-stanford:0:0:100:100')).toBe(true);
    expect(isAerialImage('naip-grid:tile-key')).toBe(true);
    expect(isAerialImage('sentinel-2b-stanford')).toBe(false);
  });
  it('keeps fully supported high-resolution imagery unmodified', () => {
    expect(settledAerialWeight([0,0,1000,1000], [100,100,900,900], 5)).toBe(1);
  });
  it('fades the entire level before coverage is lost', () => {
    expect(settledAerialWeight([0,0,1000,1000], [0,100,900,900], 5)).toBe(0);
    expect(settledAerialWeight([0,0,1000,1000], [-1,100,900,900], 5)).toBe(0);
    const near = settledAerialWeight([0,0,1000,1000], [40,100,900,900], 5);
    expect(near).toBeGreaterThan(0); expect(near).toBeLessThan(1);
  });
  it('approaches satellite smoothly at its native sampling threshold', () => {
    const bounds: [number,number,number,number] = [0,0,1000,1000];
    const shot: [number,number,number,number] = [100,100,900,900];
    expect(settledAerialWeight(bounds,shot,8,10)).toBe(1);
    expect(settledAerialWeight(bounds,shot,9,10)).toBe(.5);
    expect(settledAerialWeight(bounds,shot,10,10)).toBe(0);
    expect(settledAerialWeight(bounds,shot,10,20)).toBe(1);
    expect(settledAerialWeight(bounds,shot,10)).toBe(1);
    expect(settledAerialWeight(bounds,shot,NaN)).toBe(0);
  });
  it('stretches the fade through a stalled frame instead of flashing', () => {
    expect(advanceAerialArrival(0,130)).toBeCloseTo(1000/30);
    expect(advanceAerialArrival(240,20)).toBe(250);
    expect(advanceAerialArrival(20,-1)).toBe(20);
  });
  it('bounds a 59 DN transition at 60 Hz, settling after 250 ms', () => {
    const weights=Array.from({length:16},(_,i)=>aerialArrivalWeight(i*250/15));
    expect(weights[0]).toBe(0); expect(weights[15]).toBe(1);
    const maxStep=Math.max(...weights.slice(1).map((w,i)=>(w-weights[i])*59));
    expect(maxStep).toBeLessThan(6);
    expect(aerialArrivalWeight(-1)).toBe(0); expect(aerialArrivalWeight(1000)).toBe(1);
  });
});
