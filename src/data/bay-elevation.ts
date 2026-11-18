/** USGS 3DEP bare-earth relief. Bounds are WGS84 raster edges in degrees.
 * PNG scanlines run north to south. In a linear UNORM texture, meters =
 * 255 * (256 * r + g), including after bilinear interpolation.
 * Zero is the model's sea surface. CONUS 3DEP heights are NAVD88 orthometric
 * meters; this layer applies no geoid-to-ellipsoid correction or tidal model.
 */
export const BAY_ELEVATION = {
  file: 'bay-elevation.png',
  west: -123.1, east: -120.8, south: 36.55, north: 38.45,
  width: 1536, height: 1792,
  heightCeilingM: 1300, edgeFeatherDeg: 0.04,
  horizontalCrs: 'EPSG:4326', verticalDatum: 'NAVD88',
} as const;
