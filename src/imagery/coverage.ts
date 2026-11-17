/** Feather only the inside of a survey's validity mask. RGB is never repaired
 * or invented: uncovered pixels reveal the independently georeferenced base. */
export function featherCoverage(canvas: HTMLCanvasElement): void {
  const scale = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
  const mask = document.createElement('canvas');
  mask.width = Math.max(1, Math.round(canvas.width * scale));
  mask.height = Math.max(1, Math.round(canvas.height * scale));
  const context = mask.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0, mask.width, mask.height);
  const pixels = context.getImageData(0, 0, mask.width, mask.height);
  const alpha = insetCoverage(pixels.data, mask.width, mask.height, 4);
  for (let i = 0; i < alpha.length; i++) pixels.data[i * 4 + 3] = alpha[i];
  context.putImageData(pixels, 0, 0);
  const target = canvas.getContext('2d')!;
  target.save();
  target.globalCompositeOperation = 'destination-in';
  target.drawImage(mask, 0, 0, canvas.width, canvas.height);
  target.restore();
}

/** Bounded chamfer distance to NoData; operates on a small mask, not native RGB. */
export function insetCoverage(rgba: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const distance = new Float32Array(width * height);
  for (let i = 0; i < distance.length; i++) distance[i] = rgba[i * 4 + 3] < 250 ? 0 : radius;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    if (y) distance[i] = Math.min(distance[i], distance[i - width] + 1);
    if (x && y) distance[i] = Math.min(distance[i], distance[i - width - 1] + diagonal);
    if (x < width - 1 && y) distance[i] = Math.min(distance[i], distance[i - width + 1] + diagonal);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x < width - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    if (y < height - 1) distance[i] = Math.min(distance[i], distance[i + width] + 1);
    if (x < width - 1 && y < height - 1) distance[i] = Math.min(distance[i], distance[i + width + 1] + diagonal);
    if (x && y < height - 1) distance[i] = Math.min(distance[i], distance[i + width - 1] + diagonal);
  }
  return Uint8ClampedArray.from(distance, value => {
    const t = Math.min(1, value / radius);
    return Math.round(255 * t * t * (3 - 2 * t));
  });
}

export async function featheredBitmap(blob: Blob): Promise<ImageBitmap> {
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  image.close();
  featherCoverage(canvas);
  return createImageBitmap(canvas);
}
