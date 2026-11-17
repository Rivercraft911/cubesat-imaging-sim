/** Three r184 WebGPUTextureUtils.copyTextureToBuffer returns padded rows,
 * including a short final row: (height−1)*alignedStride + width*4 bytes.
 * RGBA8 only; never pass padding into ImageData. */
export function unpackRgba8(
  bytes: ArrayBufferView,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * 4,
    stride = Math.ceil(rowBytes / 256) * 256;
  const source = new Uint8Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const tightLength = rowBytes * height;
  if (source.byteLength === tightLength) return new Uint8ClampedArray(source);
  const required = (height - 1) * stride + rowBytes;
  if (source.byteLength < required)
    throw new RangeError(
      `GPU readback has ${source.byteLength} bytes; expected at least ${required}.`,
    );
  const output = new Uint8ClampedArray(tightLength);
  for (let y = 0; y < height; y++)
    output.set(
      source.subarray(y * stride, y * stride + rowBytes),
      y * rowBytes,
    );
  return output;
}
