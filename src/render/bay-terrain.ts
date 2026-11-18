import type { Node, Texture } from 'three/webgpu';
import { sampler, texture, vec2, wgsl, wgslFn } from 'three/tsl';
import { BAY_ELEVATION as dem } from '../data/bay-elevation';

// North is v=1 in the uploaded geographic raster. Explicit LOD keeps branch
// and loop texture reads independent of derivatives in neighboring pixels.
export const bayHeightWGSL = /* wgsl */ `
fn bayHeight(geo: vec2f, grid: texture_2d<f32>, linearSampler: sampler) -> f32 {
  let sw = vec2f(${dem.west}, ${dem.south});
  let ne = vec2f(${dem.east}, ${dem.north});
  let border = smoothstep(vec2f(0.0), vec2f(${dem.edgeFeatherDeg}), min(geo - sw, ne - geo));
  let rg = textureSampleLevel(grid, linearSampler, (geo - sw) / (ne - sw), 0.0).rg;
  return dot(rg, vec2f(65280.0, 255.0)) * border.x * border.y;
}`;

// Returns meters back along the ray from its ellipsoid hit, and the height
// above the local ellipsoid. WGS84 meridional and prime-vertical radii
// give the local geographic derivatives. At most ~4 km is traversed, and
// the second-order curvature correction is under 1.5 m over that baseline.
export const bayIntersectionWGSL = /* wgsl */ `
fn bayIntersection(hit: vec4f, ray: vec3f, geo: vec2f, grid: texture_2d<f32>, linearSampler: sampler) -> vec2f {
  if (hit.w <= 0.0 || any(geo < vec2f(${dem.west}, ${dem.south})) ||
      any(geo > vec2f(${dem.east}, ${dem.north}))) { return vec2f(0.0); }
  let normal = normalize(hit.xyz * vec3f(1.0, 1.0, 1.0067394967422765));
  let incidence = -dot(ray, normal);
  if (incidence <= 0.30) { return vec2f(0.0); }
  let fade = smoothstep(0.30, 0.45, incidence);
  let east = normalize(vec3f(-normal.y, normal.x, 0.0));
  let north = cross(normal, east);
  let cosLat = length(normal.xy);
  let q = 1.0 - 0.0066943799901413165 * normal.z * normal.z;
  let prime = 6378137.0 / sqrt(q);
  let meridian = prime * 0.9933056200098587 / q;
  let eastRate = -dot(ray, east);
  let northRate = -dot(ray, north);
  let geoRate = degrees(vec2f(eastRate / (prime * cosLat), northRate / meridian));
  let curvature = 0.5 * (eastRate * eastRate / prime + northRate * northRate / meridian);
  let top = ${dem.heightCeilingM.toFixed(1)} * fade / incidence; // Bundled DEM maximum 1292 m.
  let horizontal = sqrt(max(0.0, 1.0 - incidence * incidence));
  // Below ~20 degrees from vertical the ray rises more steeply than every
  // slope in this raster (<1.7 m/m). The two endpoints bracket a unique hit.
  // At oblique incidence, sample front to back at about one DEM cell per
  // step. Sub-cell peaks / tangencies can be missed by this sampled model.
  let steps = select(clamp(i32(ceil(top * horizontal / 110.0)), 1, 40), 1, incidence >= 0.94);
  var above = top;
  var aboveGap = top * incidence + curvature * top * top -
      fade * bayHeight(geo + geoRate * top, grid, linearSampler);
  for (var i = 1; i <= steps; i++) {
    // Pin the endpoint exactly: GPU reciprocal approximations can leave a
    // small signed distance at i == steps even over level water.
    let below = select(top * (1.0 - f32(i) / f32(steps)), 0.0, i == steps);
    let gap = below * incidence + curvature * below * below -
        fade * bayHeight(geo + geoRate * below, grid, linearSampler);
    if (gap <= 0.0) {
      if (gap == 0.0) { return vec2f(below, below * incidence + curvature * below * below); }
      var lo = below;
      var lowGap = gap;
      var hi = above;
      var highGap = aboveGap;
      // Interpolate the crossing. Re-evaluate against the bilinear DEM
      // because an interval may span a cell boundary or sloping ridge.
      var s = lo;
      for (var j = 0; j < 5; j++) {
        s = mix(lo, hi, -lowGap / max(highGap - lowGap, 1e-6));
        let residual = s * incidence + curvature * s * s -
            fade * bayHeight(geo + geoRate * s, grid, linearSampler);
        if (abs(residual) < 0.05) { break; }
        if (residual > 0.0) { hi = s; highGap = residual; }
        else { lo = s; lowGap = residual; }
      }
      return vec2f(s, s * incidence + curvature * s * s);
    }
    above = below;
    aboveGap = gap;
  }
  return vec2f(0.0);
}`;

const intersection = wgslFn(bayIntersectionWGSL, [wgsl(bayHeightWGSL)]);

export function createBayTerrain(map: Texture) {
  const grid = texture(map);
  return (hit: Node<'vec4'>, ray: Node<'vec3'>, geo: Node<'vec2'>) =>
    vec2(intersection(hit, ray, geo, grid, sampler(grid)) as ReturnType<typeof vec2>);
}
