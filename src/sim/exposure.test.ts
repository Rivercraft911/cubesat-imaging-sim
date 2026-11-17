import { describe, expect, it } from 'vitest';
import { createDefaultScenario, mainImageModel, parseScenario } from './index';
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
  it('uses the study defaults when no settings were supplied', () => {
    const c = { ...camera(), mainImageModel: 'twilight' as const, exposureStudy: undefined };
    expect(exposurePrediction(c, 1, -6).electrons).toBe(
      DEFAULT_EXPOSURE_STUDY.diffuseFraction * DEFAULT_EXPOSURE_STUDY.referenceElectronsPerMs,
    );
  });
});

describe('Main image model import', () => {
  const scenario = createDefaultScenario();
  const { mainImageModel: _mode, ...legacyMain } = scenario.cameras[0];
  const withMain = (main: unknown) => ({ ...scenario, cameras: [main, ...scenario.cameras.slice(1)] });

  it('defaults to pass lighting for new and unspecified legacy scenarios', () => {
    expect(mainImageModel(scenario.cameras[0])).toBe('pass');
    const imported = parseScenario(withMain(legacyMain)).cameras[0];
    expect(mainImageModel(imported)).toBe('pass');
    expect(imported.exposureStudy).toBeUndefined();
  });

  it.each([[false, 'reference'], [true, 'twilight']])('maps legacy enabled=%s to %s', (enabled, mode) => {
    const study = camera().exposureStudy;
    const imported = parseScenario(withMain({ ...legacyMain, exposureStudy: { ...study, enabled } })).cameras[0];
    expect(imported.mainImageModel).toBe(mode);
    expect(imported.exposureStudy).toEqual(study);
  });

  it.each(['pass', 'reference', 'twilight'])('preserves the explicit %s choice and custom study settings', mode => {
    const study = camera().exposureStudy;
    const selected = parseScenario(withMain({ ...legacyMain, mainImageModel: mode, exposureStudy: { ...study, enabled: false } }));
    expect(selected.cameras[0]).toMatchObject({ mainImageModel: mode, exposureStudy: study });
    expect(parseScenario(JSON.parse(JSON.stringify(selected)))).toEqual(selected);
  });

  it('rejects invalid modes and study inputs', () => {
    expect(() => parseScenario(withMain({ ...legacyMain, mainImageModel: 'unknown' }))).toThrow('Main image model');
    const study = camera().exposureStudy;
    expect(() => parseScenario(withMain({ ...legacyMain, exposureStudy: { ...study, enabled: 'true' } }))).toThrow('enabled');
    expect(() => parseScenario(withMain({ ...legacyMain, exposureStudy: { ...study, fullWellElectrons: 0 } }))).toThrow('Full well');
  });
});
