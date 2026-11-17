/** Explicit scratch-buffer budget. Two native RGBA16F intermediates consume
 * 16 bytes/pixel; this excludes retained images, context maps and readbacks.
 * Crossing a limit is an error, never an implicit change of sensor resolution. */
export const MAX_OPTICS_WORKING_BYTES = 512 * 1024 * 1024;
export function validateNativeAllocation(
  width: number,
  height: number,
  dimensionLimit: number,
) {
  if (width > dimensionLimit || height > dimensionLimit)
    throw new RangeError(
      `Native sensor ${width} × ${height} exceeds this GPU's ${dimensionLimit}-pixel texture limit.`,
    );
  const bytes = width * height * 2 * 4 * 2;
  if (bytes > MAX_OPTICS_WORKING_BYTES)
    throw new RangeError(
      `Native sensor ${width} × ${height} needs ${(bytes / 1024 ** 2).toFixed(0)} MiB of optical working textures, above the explicit 512 MiB budget. Select smaller custom sensor dimensions; resolution has not been changed automatically.`,
    );
  return bytes;
}
