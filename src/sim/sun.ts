import { DEG, rotationZ, TAU, wrap } from './math';
import type { Vec3 } from './types';

export const DAY_S = 86_400;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const SIDEREAL_HOURS_PER_DAY = 24.065709824279;
export const SIDEREAL_RATE_RAD_S = SIDEREAL_HOURS_PER_DAY * 15 * DEG / DAY_S;
export const MEAN_SUN_RATE_RAD_S = 0.98564736 * DEG / DAY_S;

export const daysSinceJ2000 = (epochMs: number): number => (epochMs - J2000_MS) / (DAY_S * 1000);

/** USNO short GMST expression. UTC substitutes for UT1 in the constructed scenario. */
export function greenwichSiderealRad(days: number): number {
  return wrap((18.697375 + SIDEREAL_HOURS_PER_DAY * days) * 15 * DEG, TAU);
}

export function meanSunRaRad(days: number): number {
  return wrap((280.459 + 0.98564736 * days) * DEG, TAU);
}

/** Geocentric apparent solar direction from USNO "Computing Approximate Solar Coordinates". */
export function sunDirectionEcef(days: number): Vec3 {
  const g = wrap((357.529 + 0.98560028 * days) * DEG, TAU);
  const longitude = meanSunRaRad(days) + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const obliquity = (23.439 - 0.00000036 * days) * DEG;
  const sinLongitude = Math.sin(longitude);
  return rotationZ([
    Math.cos(longitude), Math.cos(obliquity) * sinLongitude, Math.sin(obliquity) * sinLongitude,
  ], -greenwichSiderealRad(days));
}
