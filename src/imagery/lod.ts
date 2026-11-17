/** Use aerial mosaics only when satellite pixels cannot resolve sensor GSD.
 * Hysteresis avoids repeatedly swapping photographed lighting at the boundary. */
export function needsAerial(gsdM: number, satelliteSpacingM: number, alreadyAerial: boolean): boolean {
  return Number.isFinite(gsdM) && gsdM > 0
    && gsdM < satelliteSpacingM * (alreadyAerial ? 1.1 : 0.85);
}
