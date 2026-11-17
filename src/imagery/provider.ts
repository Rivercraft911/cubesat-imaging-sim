import type { GroundImage } from "../render";
import type { Bounds } from "./bounds";
import { cacheImage, cachedImage } from "./cache";
import { featherCoverage } from "./coverage";
import { TILE_PIXELS, type ShotPlan } from "./plan";

const SERVICE =
  "https://gis.wildlife.ca.gov/images/rest/services/Base_Remote_Sensing/NAIP_2022/ImageServer";
export type ImageryProgress = {
  state: "preview" | "loading" | "ready" | "error";
  message: string;
  resolutionM?: number;
};

export async function openingImage(signal?: AbortSignal): Promise<GroundImage> {
  const [meta, blob] = await Promise.all([
    fetch("/assets/bay-preview.json", { signal }).then((r) => r.json()),
    fetch("/assets/bay-preview.webp", { signal }).then((r) => r.blob()),
  ]);
  return { ...meta, image: await createImageBitmap(blob) };
}

/** Continuous satellite coverage remains resident beneath changing aerial LOD. */
export async function regionalImage(
  signal: AbortSignal,
  level: "fine" | "wide" = "fine",
): Promise<GroundImage> {
  const response = await fetch(
    `/assets/bay-regional${level === "wide" ? "-wide" : ""}.json`,
    { signal },
  );
  if (!response.ok) throw new Error("Regional imagery unavailable");
  const meta = await response.json();
  const raster = await fetch(`/assets/${meta.file}`, { signal });
  if (!raster.ok) throw new Error("Regional raster unavailable");
  return { ...meta, image: await createImageBitmap(await raster.blob()) };
}

async function imageTile(
  bounds: Bounds,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<ImageBitmap> {
  signal.throwIfAborted();
  const params = new URLSearchParams({
    bbox: bounds.map((v) => v.toFixed(2)).join(","),
    bboxSR: "3857",
    imageSR: "3857",
    size: `${width},${height}`,
    format: "png32",
    bandIds: "0,1,2",
    noData: "0,0,0",
    noDataInterpretation: "esriNoDataMatchAll",
    interpolation: "RSP_BilinearInterpolation",
    adjustAspectRatio: "false",
    f: "image",
  });
  const key = `${SERVICE}/exportImage?${params}`;
  const cached = await cachedImage(key);
  signal.throwIfAborted();
  if (cached) {
    try {
      const image = await createImageBitmap(cached);
      if (signal.aborted) {
        image.close();
        signal.throwIfAborted();
      }
      return image;
    } catch (error) {
      signal.throwIfAborted(); /* Replace an invalid cached blob. */
    }
  }
  const response = await fetch(key, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) throw new Error(`NAIP imagery returned ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/"))
    throw new Error("Imagery service did not return an image.");
  signal.throwIfAborted();
  const image = await createImageBitmap(blob);
  if (signal.aborted) {
    image.close();
    signal.throwIfAborted();
  }
  void cacheImage(key, blob);
  return image;
}

/** One complete-footprint overview replaces the satellite fallback before the
 * finer mosaic finishes. Its real source spacing is reported explicitly. */
export async function previewShot(
  plan: ShotPlan,
  signal: AbortSignal,
): Promise<GroundImage> {
  const scale = Math.min(1, 3072 / Math.max(plan.width, plan.height));
  const width = Math.max(1, Math.round(plan.width * scale));
  const height = Math.max(1, Math.round(plan.height * scale));
  const image = await imageTile(plan.bounds, width, height, signal);
  return {
    image,
    boundsMercator: plan.bounds,
    sourceResolutionM: plan.sourceResolutionM / scale,
    attribution: "USDA / CDFW NAIP 2022 · whole-footprint overview",
    id: `naip-overview:${plan.key}`,
  };
}

/** Four bounded workers decode, draw, and close each tile immediately. The
 * mosaic publishes only with complete coverage; missing survey alpha is real. */
export async function shotImage(
  plan: ShotPlan,
  signal: AbortSignal,
  progress?: (complete: number, total: number) => void,
): Promise<GroundImage> {
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext("2d", { alpha: true })!;
  const failed = new AbortController();
  const active = AbortSignal.any([signal, failed.signal]);
  let cursor = 0,
    complete = 0;
  const worker = async () => {
    while (cursor < plan.tiles.length) {
      active.throwIfAborted();
      const tile = plan.tiles[cursor++];
      const image = await imageTile(
        tile.bounds,
        TILE_PIXELS,
        TILE_PIXELS,
        active,
      );
      try {
        active.throwIfAborted();
        context.drawImage(
          image,
          tile.column * TILE_PIXELS,
          tile.row * TILE_PIXELS,
        );
        progress?.(++complete, plan.tiles.length);
      } finally {
        image.close();
      }
    }
  };
  try {
    const jobs = Array.from({ length: Math.min(4, plan.tiles.length) }, () =>
      worker().catch((error) => {
        failed.abort(error);
        throw error;
      }),
    );
    const results = await Promise.allSettled(jobs);
    signal.throwIfAborted();
    const error = results.find((result) => result.status === "rejected");
    if (error?.status === "rejected") throw error.reason;
    featherCoverage(canvas);
    const image = await createImageBitmap(canvas);
    if (signal.aborted) {
      image.close();
      signal.throwIfAborted();
    }
    return {
      image,
      boundsMercator: plan.bounds,
      sourceResolutionM: plan.sourceResolutionM,
      attribution: "USDA / CDFW NAIP 2022 · natural-color aerial mosaic",
      id: `naip-grid:${plan.key}`,
    };
  } finally {
    canvas.width = canvas.height = 1;
  }
}

type PreparedImage = Omit<GroundImage, "image"> & {
  file: string;
  width: number;
  height: number;
  transparentPixels?: number;
};
let preparedIndex: Promise<PreparedImage[]> | undefined;
export async function preparedShot(
  bounds: Bounds,
  signal: AbortSignal,
): Promise<GroundImage | null> {
  preparedIndex ??= fetch("/assets/shots/manifest.json")
    .then((r) => (r.ok ? (r.json() as Promise<PreparedImage[]>) : []))
    .catch(() => []);
  const list = await preparedIndex;
  signal.throwIfAborted();
  const entry = list
    .filter(
      (p) =>
        p.boundsMercator[0] <= bounds[0] &&
        p.boundsMercator[1] <= bounds[1] &&
        p.boundsMercator[2] >= bounds[2] &&
        p.boundsMercator[3] >= bounds[3],
    )
    .sort((a, b) => a.sourceResolutionM - b.sourceResolutionM)[0];
  if (!entry) return null;
  const response = await fetch(`/assets/shots/${entry.file}`, { signal });
  if (!response.ok) throw new Error("Prepared imagery unavailable");
  const blob = await response.blob();
  signal.throwIfAborted();
  const [west, south, east, north] = entry.boundsMercator;
  const dx = (east - west) / entry.width,
    dy = (north - south) / entry.height;
  const marginX = (bounds[2] - bounds[0]) * 0.1,
    marginY = (bounds[3] - bounds[1]) * 0.1;
  const left = Math.max(0, Math.floor((bounds[0] - marginX - west) / dx)),
    top = Math.max(0, Math.floor((north - bounds[3] - marginY) / dy));
  const right = Math.min(
      entry.width,
      Math.ceil((bounds[2] + marginX - west) / dx),
    ),
    bottom = Math.min(
      entry.height,
      Math.ceil((north - bounds[1] + marginY) / dy),
    );
  // Crop while decoding; do not retain a 50MP prepared raster for a tiny shot.
  let image = await createImageBitmap(
    blob,
    left,
    top,
    right - left,
    bottom - top,
  );
  if (entry.transparentPixels !== 0) {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    image.close();
    featherCoverage(canvas);
    image = await createImageBitmap(canvas);
    canvas.width = canvas.height = 1;
  }
  if (signal.aborted) {
    image.close();
    signal.throwIfAborted();
  }
  return {
    ...entry,
    image,
    boundsMercator: [
      west + left * dx,
      north - bottom * dy,
      west + right * dx,
      north - top * dy,
    ],
    id: `${entry.id}:${left}:${top}:${right}:${bottom}`,
  };
}
