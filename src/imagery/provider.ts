import type { GroundImage } from '../render';
import type { Bounds } from './bounds';
import { cacheImage, cachedImage } from './cache';

const SERVICE = 'https://gis.wildlife.ca.gov/images/rest/services/Base_Remote_Sensing/NAIP_2022/ImageServer';
export type ImageryProgress = { state: 'preview' | 'loading' | 'ready' | 'error'; message: string; resolutionM?: number };

export async function openingImage(signal?: AbortSignal): Promise<GroundImage> {
  const [meta, blob] = await Promise.all([
    fetch('/assets/bay-preview.json', { signal }).then(r => r.json()),
    fetch('/assets/bay-preview.webp', { signal }).then(r => r.blob()),
  ]);
  return { ...meta, image: await createImageBitmap(blob) };
}

async function imageTile(bounds: Bounds, width: number, height: number, signal: AbortSignal): Promise<ImageBitmap> {
  const params = new URLSearchParams({
    bbox: bounds.map(v => v.toFixed(2)).join(','), bboxSR: '3857', imageSR: '3857',
    size: `${width},${height}`, format: 'png32', bandIds: '0,1,2',
    noData: '0,0,0', noDataInterpretation: 'esriNoDataMatchAll',
    interpolation: 'RSP_BilinearInterpolation', adjustAspectRatio: 'false', f: 'image',
  });
  const key = `${SERVICE}/exportImage?${params}`;
  let blob = await cachedImage(key);
  signal.throwIfAborted();
  if (!blob) {
    const response = await fetch(key, { signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) });
    if (!response.ok) throw new Error(`NAIP imagery returned ${response.status}`);
    blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('Imagery service did not return an image.');
    void cacheImage(key, blob);
  }
  signal.throwIfAborted();
  return createImageBitmap(blob);
}

/** Four independently requested rasters keep each export below the service's 4000px limit. */
export async function shotImage(bounds: Bounds, desiredPixelM: number, latitudeDeg: number, signal: AbortSignal): Promise<GroundImage> {
  const cosine = Math.cos(latitudeDeg * Math.PI / 180);
  const spanX = bounds[2] - bounds[0], spanY = bounds[3] - bounds[1];
  if (spanX > 2500000 || spanY > 2500000) throw new Error('This wide footprint uses the global background.');
  const mercatorPixel = Math.max(0.6, desiredPixelM) / Math.max(0.1, cosine);
  const scale = Math.min(1 / mercatorPixel, 7680 / spanX, 7680 / spanY);
  const width = Math.max(512, Math.ceil(spanX * scale / 2) * 2);
  const height = Math.max(512, Math.ceil(spanY * scale / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false })!;
  const midX = (bounds[0] + bounds[2]) / 2, midY = (bounds[1] + bounds[3]) / 2;
  const tiles: Bounds[] = [
    [bounds[0], midY, midX, bounds[3]], [midX, midY, bounds[2], bounds[3]],
    [bounds[0], bounds[1], midX, midY], [midX, bounds[1], bounds[2], midY],
  ];
  const images = await Promise.allSettled(tiles.map(b => imageTile(b, width / 2, height / 2, signal)));
  const failure = images.find(r => r.status === 'rejected');
  if (failure || signal.aborted) {
    images.forEach(r => { if (r.status === 'fulfilled') r.value.close(); });
    signal.throwIfAborted();
    throw failure?.status === 'rejected' ? failure.reason : new Error('Imagery cancelled');
  }
  images.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      context.drawImage(r.value, (i % 2) * width / 2, Math.floor(i / 2) * height / 2);
      r.value.close();
    }
  });
  const sourceResolutionM = Math.max(spanX / width, spanY / height) * cosine;
  return {
    image: await createImageBitmap(canvas), boundsMercator: bounds, sourceResolutionM,
    attribution: 'USDA / CDFW NAIP 2022 · natural-color aerial mosaic',
    id: `naip:${bounds.map(v => Math.round(v)).join(',')}:${width}x${height}`,
  };
}

type PreparedImage = Omit<GroundImage, 'image'> & { file: string };
let preparedIndex: Promise<PreparedImage[]> | undefined;
export async function preparedShot(bounds: Bounds, signal: AbortSignal): Promise<GroundImage | null> {
  preparedIndex ??= fetch('/assets/shots/manifest.json').then(r => r.ok ? r.json() as Promise<PreparedImage[]> : []).catch(() => []);
  const list = await preparedIndex;
  const entry = list.filter(p => p.boundsMercator[0] <= bounds[0] && p.boundsMercator[1] <= bounds[1] && p.boundsMercator[2] >= bounds[2] && p.boundsMercator[3] >= bounds[3]).sort((a, b) => a.sourceResolutionM - b.sourceResolutionM)[0];
  if (!entry) return null;
  const blob = await fetch(`/assets/shots/${entry.file}`, { signal }).then(r => { if (!r.ok) throw new Error('Prepared imagery unavailable'); return r.blob(); });
  signal.throwIfAborted();
  return { ...entry, image: await createImageBitmap(blob) };
}
