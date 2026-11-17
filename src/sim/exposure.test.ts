import { describe, expect, it } from 'vitest';
import { createDefaultScenario, parseScenario } from './index';
import { DEFAULT_EXPOSURE_STUDY, exposurePrediction, exposureScale } from './exposure';

function camera() {
  const c = createDefaultScenario().cameras[0];
  return { ...c, exposureMs: 1, lens: { ...c.lens, fNumber: 4 },
    exposureStudy: { ...DEFAULT_EXPOSURE_STUDY, diffuseFraction: 0, referenceElectronsPerMs: 100 } };
}
describe('illustrative exposure model', () => {
  it('scales electrons with shutter time and inverse square f-number', () => {
    const c = camera();
    expect(exposureScale(c)).toBe(100);
    expect(exposureScale({ ...c, exposureMs: 2 })).toBe(200);
    expect(exposureScale({ ...c, lens: { ...c.lens, fNumber: 8 } })).toBe(25);
  });
  it('uses actual Sun elevation with no direct light below horizon', () => {
    const c = camera();
    expect(exposurePrediction(c, 1, 90).electrons).toBe(100);
    expect(exposurePrediction(c, 1, 30).electrons).toBeCloseTo(50);
    expect(exposurePrediction(c, 1, -6).electrons).toBe(0);
    c.exposureStudy.diffuseFraction = 0.001;
    expect(exposurePrediction(c, 1, -6).electrons).toBeCloseTo(0.1);
  });
  it('gain changes output without creating electrons or improving SNR', () => {
    const c = camera();
    const a = exposurePrediction(c, 1, 90);
    c.exposureStudy.gain = 10;
    const b = exposurePrediction(c, 1, 90);
    expect(b.electrons).toBe(a.electrons);
    expect(b.snr).toBe(a.snr);
    expect(b.snr).toBeCloseTo(100 / Math.sqrt(109));
    expect(b.output).toBeCloseTo(10 * a.output);
  });
  it('preserves old scenarios and validates optional study inputs', () => {
    const scenario = createDefaultScenario();
    expect(parseScenario(scenario).cameras[0].exposureStudy).toBeUndefined();
    scenario.cameras[0] = camera();
    expect(parseScenario(scenario).cameras[0].exposureStudy).toEqual(camera().exposureStudy);
    scenario.cameras[0].exposureStudy!.fullWellElectrons = 0;
    expect(() => parseScenario(scenario)).toThrow('Full well');
  });
});
