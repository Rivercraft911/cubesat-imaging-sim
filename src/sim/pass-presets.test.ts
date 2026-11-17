import { describe, expect, it } from 'vitest';
import { createDefaultScenario } from './catalog';
import { applyStanfordPassPreset, orbitalBetaDeg } from './pass-presets';
import { sampleState } from './orbit';
import { ecefToGeodetic, localUp, EARTH_GM_M3_S2 } from './earth';
import { DEG, dot, length } from './math';
import { parseScenario } from './scenario';

describe('Stanford constructed presets', () => {
  it('aligns the whole orbit near the terminator, with a measured nonzero residual', () => {
    const scenario = applyStanfordPassPreset(createDefaultScenario(), 'terminator');
    const state = sampleState(scenario);
    expect(orbitalBetaDeg(scenario)).toBeGreaterThan(89.9);
    expect(Math.abs(state.sunElevationDeg)).toBeLessThan(0.25);
    expect(state.targetElevationDeg).toBeGreaterThan(89.8);
    const period = 2 * Math.PI * Math.sqrt(length(state.positionEcefM) ** 3 / EARTH_GM_M3_S2);
    let maxSolarElevation = 0;
    for (let i = 0; i <= 120; i += 1) {
      const point = sampleState(scenario, period * i / 120);
      const geo = ecefToGeodetic(point.positionEcefM);
      const solarElevation = Math.asin(dot(localUp(geo.latitudeDeg, geo.longitudeDeg), point.sunDirectionEcef)) / DEG;
      maxSolarElevation = Math.max(maxSolarElevation, Math.abs(solarElevation));
    }
    expect(maxSolarElevation).toBeLessThan(0.3);
    expect(parseScenario(JSON.parse(JSON.stringify(scenario)))).toEqual(scenario);
  });

  it('constructs a daylight overhead crossing on the selected date without changing optics', () => {
    const input = createDefaultScenario();
    const scenario = applyStanfordPassPreset(input, 'daylight');
    const state = sampleState(scenario);
    expect(state.epochISO.slice(0, 10)).toBe(input.epochISO.slice(0, 10));
    expect(state.sunElevationDeg).toBeGreaterThan(40);
    expect(state.targetElevationDeg).toBeGreaterThan(89.8);
    expect(sampleState(scenario, -60).sunElevationDeg).toBeLessThan(state.sunElevationDeg);
    expect(sampleState(scenario, 60).sunElevationDeg).toBeLessThan(state.sunElevationDeg);
    expect(scenario.cameras).toEqual(input.cameras);
    expect(scenario.altitudeM).toBe(input.altitudeM);
    expect(input.ltanHours).toBe(18);
  });
});
