// The nine-point quadrature is the reference for both GPU filter paths.
const samples = Array.from({ length: 9 }, (_, i) => Math.exp(-0.5 * ((i - 4) * 0.75) ** 2));
const total = samples.reduce((a, b) => a + b, 0);
export const gaussianWeights = samples.map(weight => weight / total);

/** At native texel centers a ±3σ filter with support ≤2 px touches five texels.
 * Fold the bilinear quadrature into those texels, then combine the two on each
 * side in a single linear texture sample. Offsets are in sensor pixels. */
export function compactGaussian(sigmaPx: number) {
  if (3 * sigmaPx > 2) return null;
  let inner = 0, outer = 0;
  for (let i = 1; i <= 4; i++) {
    const radius = i * 0.75 * sigmaPx;
    const weight = gaussianWeights[4 + i];
    inner += weight * (1 - Math.abs(radius - 1));
    outer += weight * Math.max(0, radius - 1);
  }
  const sideWeight = inner + outer;
  return { sideWeight, offsetPx: sideWeight ? 1 + outer / sideWeight : 0 };
}
