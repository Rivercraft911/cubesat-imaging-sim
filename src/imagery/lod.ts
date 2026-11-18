/** Use aerial mosaics only when satellite pixels cannot resolve sensor GSD.
 * Hysteresis avoids repeatedly swapping photographed lighting at the boundary. */
export function needsAerial(gsdM: number, satelliteSpacingM: number, alreadyAerial: boolean): boolean {
  return Number.isFinite(gsdM) && gsdM > 0
    && gsdM < satelliteSpacingM * (alreadyAerial ? 1.1 : 0.85);
}

export type ImagerySource = { sourceResolutionM: number; singlePass?: boolean };

export function isAerialImage(id: string): boolean {
  return id.startsWith('cdfw-naip-2022-') || id.startsWith('naip-grid:') || id.startsWith('naip-overview:');
}

/** A single acquisition avoids temporal seams when it samples the sensor's
 * ground pixel at least as finely. Otherwise prefer higher spatial resolution. */
export function resolvesSinglePass(source: ImagerySource, sensorSpacingM: number): boolean {
  return source.singlePass === true && source.sourceResolutionM <= sensorSpacingM;
}

export function compareImagery(a: ImagerySource, b: ImagerySource, sensorSpacingM: number): number {
  return Number(resolvesSinglePass(b, sensorSpacingM)) - Number(resolvesSinglePass(a, sensorSpacingM))
    || a.sourceResolutionM - b.sourceResolutionM;
}
