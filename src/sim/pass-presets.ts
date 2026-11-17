import { createDefaultScenario, TARGETS } from './catalog';
import { localUp } from './earth';
import { sampleState } from './orbit';
import { add, cross, DEG, dot, normalize, scale, wrap } from './math';
import { DAY_S, daysSinceJ2000, MEAN_SUN_RATE_RAD_S, SIDEREAL_RATE_RAD_S, sunDirectionEcef } from './sun';
import type { Scenario, Vec3 } from './types';

export type StanfordPassPreset = 'terminator' | 'daylight';
const epochCache = new Map<string, number>();
const NORTH: Vec3 = [0, 0, 1];
const SOLAR_HOUR_RATE = (SIDEREAL_RATE_RAD_S - MEAN_SUN_RATE_RAD_S) / (15 * DEG);

/** Geometric normal of the instantaneous circular orbit plane (ECEF components). */
export function orbitPlaneNormal(scenario: Scenario): Vec3 {
  const state = sampleState(scenario);
  const tangent = add(state.velocityEcefMps, scale(cross(NORTH, state.positionEcefM), SIDEREAL_RATE_RAD_S - MEAN_SUN_RATE_RAD_S));
  return normalize(cross(state.positionEcefM, tangent));
}

function maximize(f: (x: number) => number, low: number, high: number): number {
  for (let i = 0; i < 60; i += 1) {
    const left = low + (high - low) / 3;
    const right = high - (high - low) / 3;
    if (f(left) < f(right)) low = left;
    else high = right;
  }
  return (low + high) / 2;
}

function atEpoch(scenario: Scenario, epochMs: number): Scenario {
  const day = new Date(epochMs).toISOString().slice(0, 10);
  const base = { ...scenario, epochISO: `${day}T00:00:00.000Z`, ltanHours: 12 };
  const baseMs = Date.parse(sampleState(base).epochISO);
  return { ...base, ltanHours: wrap(12 + (epochMs - baseMs) / 1000 * SOLAR_HOUR_RATE, 24) };
}

/**
 * Reproducible constructed passes, not an ephemeris. Keep the selected altitude
 * and cameras. Terminator searches 2026 for the closest Sun/plane-normal
 * alignment compatible with the imposed Stanford overhead crossing. The
 * residual is nonzero because daily crossing time and solar declination are
 * linked. Daylight maximizes target solar elevation on the selected UTC day.
 */
export function applyStanfordPassPreset(scenario: Scenario, preset: StanfordPassPreset): Scenario {
  const base: Scenario = { ...scenario, target: { ...TARGETS[0] }, ascending: true,
    passOffsetKm: 0, pointing: 'target', offNadirDeg: 0, rollDeg: 0 };
  const cacheKey = `${preset}:${base.altitudeM}:${preset === 'daylight' ? base.epochISO.slice(0, 10) : '2026'}`;
  const cached = epochCache.get(cacheKey);
  if (cached !== undefined) return atEpoch(base, cached);
  const normal = orbitPlaneNormal(base);
  const targetUp = localUp(base.target.latitudeDeg, base.target.longitudeDeg);
  const score = (epoch: number) => {
    const sun = sunDirectionEcef(daysSinceJ2000(epoch));
    return preset === 'terminator' ? Math.abs(dot(normal, sun)) : dot(targetUp, sun);
  };
  const dayMs = DAY_S * 1000;
  const start = preset === 'terminator' ? Date.UTC(2026, 0, 1) : Math.floor(Date.parse(base.epochISO) / dayMs) * dayMs;
  const end = start + (preset === 'terminator' ? 365 : 1) * dayMs;
  const step = 20 * 60 * 1000;
  let best = start;
  let bestScore = -Infinity;
  // Find the best daily extremum; refine each candidate rather than relying on
  // a coarse grid to rank two almost equally aligned days.
  let previous = score(start - step);
  let current = score(start);
  for (let epoch = start; epoch < end; epoch += step) {
    const next = score(epoch + step);
    if (current >= previous && current >= next) {
      const refined = maximize(score, Math.max(start, epoch - step), Math.min(end - 1, epoch + step));
      const value = score(refined);
      if (value > bestScore) { best = refined; bestScore = value; }
    }
    previous = current;
    current = next;
  }
  epochCache.set(cacheKey, best);
  return atEpoch(base, best);
}

export function createOpeningScenario(): Scenario {
  const scenario = createDefaultScenario();
  // Use the same date as the 550 km terminator preset for a lighting comparison.
  return applyStanfordPassPreset({ ...scenario, epochISO: '2026-03-01T00:00:00.000Z' }, 'daylight');
}

/** 90° means Sun normal to the orbital plane, i.e. ideal terminator geometry. */
export function orbitalBetaDeg(scenario: Scenario): number {
  return Math.asin(Math.min(1, Math.abs(dot(orbitPlaneNormal(scenario), sampleState(scenario).sunDirectionEcef)))) / DEG;
}
