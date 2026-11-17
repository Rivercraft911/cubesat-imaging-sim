import type { Bounds } from "./bounds";

export const TILE_PIXELS = 1536;
const MAX_TILES_PER_AXIS = 4;
export interface ImageryTile {
  key: string;
  bounds: Bounds;
  column: number;
  row: number;
}
export interface ShotPlan {
  key: string;
  bounds: Bounds;
  mercatorPixelM: number;
  sourceResolutionM: number;
  width: number;
  height: number;
  tiles: ImageryTile[];
}

/** Fixed map grid and half-octave source levels make neighboring requests reuse
 * the same tiles. The 6144px mosaic cap bounds source memory, never sensor size. */
export function planShot(
  bounds: Bounds,
  desiredGroundPixelM: number,
  latitudeDeg: number,
): ShotPlan {
  if (
    !bounds.every(Number.isFinite) ||
    bounds[2] <= bounds[0] ||
    bounds[3] <= bounds[1] ||
    !Number.isFinite(desiredGroundPixelM) ||
    desiredGroundPixelM <= 0 ||
    !Number.isFinite(latitudeDeg)
  )
    throw new RangeError(
      "Imagery bounds and source spacing must be finite and positive.",
    );
  const cosine = Math.max(0.1, Math.cos((latitudeDeg * Math.PI) / 180));
  const requested = Math.max(0.6, desiredGroundPixelM) / cosine;
  let level = Math.ceil(Math.log2(requested) * 2);
  let grid!: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    span: number;
    pixel: number;
  };
  for (;;) {
    const pixel = 2 ** (level / 2),
      span = pixel * TILE_PIXELS;
    grid = {
      pixel,
      span,
      x0: Math.floor(bounds[0] / span),
      y0: Math.floor(bounds[1] / span),
      x1: Math.ceil(bounds[2] / span),
      y1: Math.ceil(bounds[3] / span),
    };
    if (
      grid.x1 - grid.x0 <= MAX_TILES_PER_AXIS &&
      grid.y1 - grid.y0 <= MAX_TILES_PER_AXIS
    )
      break;
    level++;
  }
  const { x0, y0, x1, y1, span, pixel } = grid;
  const tiles: ImageryTile[] = [];
  for (let y = y1 - 1; y >= y0; y--)
    for (let x = x0; x < x1; x++) {
      tiles.push({
        key: `${level}/${x}/${y}`,
        bounds: [x * span, y * span, (x + 1) * span, (y + 1) * span],
        column: x - x0,
        row: y1 - 1 - y,
      });
    }
  return {
    key: `${level}:${x0}:${y0}:${x1}:${y1}`,
    bounds: [x0 * span, y0 * span, x1 * span, y1 * span],
    mercatorPixelM: pixel,
    sourceResolutionM: Math.max(0.6, pixel * cosine),
    width: (x1 - x0) * TILE_PIXELS,
    height: (y1 - y0) * TILE_PIXELS,
    tiles,
  };
}
