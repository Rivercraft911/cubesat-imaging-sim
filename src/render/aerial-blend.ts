import { coverageMargin, type Bounds } from '../imagery/bounds';

export const AERIAL_ARRIVAL_MS = 250;
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Whole-level coverage fade, never a partial aerial rectangle. The footprint
 * already includes shotBounds' 2.5% guard. Fade across its final 10% margin.
 * Optional GSD fade uses the sampling of satellite imagery that actually
 * covers this footprint, from 80% to 100% of that spacing. An absent covering
 * satellite disables this term. This blends dated source photographs; it is
 * not radiometric normalization.
 */
export function settledAerialWeight(coverage: Bounds, footprint: Bounds, gsdM: number, satelliteSpacingM?: number): number {
  if (!Number.isFinite(gsdM) || gsdM <= 0) return 0;
  const resolution = satelliteSpacingM !== undefined && satelliteSpacingM > 0
    ? smooth((satelliteSpacingM - gsdM) / (0.2 * satelliteSpacingM)) : 1;
  return smooth(coverageMargin(coverage, footprint)) * resolution;
}

/** A delayed frame stretches the fade rather than skipping through it.
 * No extra image history is retained; only this scalar display clock advances. */
export function advanceAerialArrival(progressMs: number, elapsedMs: number): number {
  return Math.min(AERIAL_ARRIVAL_MS, progressMs + Math.max(0, Math.min(1000 / 30, elapsedMs)));
}

/** Arrival affects preview/live only; still/study captures use settled weight. */
export function aerialArrivalWeight(ageMs: number): number {
  return smooth(ageMs / AERIAL_ARRIVAL_MS);
}
