import type { Node, Texture } from 'three/webgpu';
import iss from '../data/stanford-night.json';
import { atan, fwidth, mix, texture, vec2, vec3 } from 'three/tsl';

/** Shared ECEF registration for the regional MODIS and native VIIRS
 * crops. Samples stay outside coverage branches so mip derivatives are valid. */
export function earthSurfaceCoordinates(point: Node<'vec3'>) {
  const longitude = atan(point.y, point.x);
  const latitude = atan(point.z.div(0.9966471893352525 ** 2), point.xy.length());
  const globalUV = vec2(longitude.div(2 * Math.PI).add(0.5), latitude.div(Math.PI).add(0.5));
  const geographic = vec2(longitude, latitude).mul(180 / Math.PI);
  return { globalUV, geographic };
}

function regionalCoordinates(geographic: Node<'vec2'>, bounds: readonly number[], featherDeg = 0.25) {
  const southwest = vec2(bounds[0], bounds[1]), northeast = vec2(bounds[2], bounds[3]);
  const regionalUV = geographic.sub(southwest).div(northeast.sub(southwest));
  const edge = geographic.sub(southwest).min(northeast.sub(geographic));
  return { regionalUV, blend: edge.x.min(edge.y).smoothstep(0, featherDeg) };
}

export function earthDayColor(global: Texture, regional: Texture, coords: ReturnType<typeof earthSurfaceCoordinates>) {
  // west-coast-regional.json: daily MODIS coverage for the full default pass.
  const day = regionalCoordinates(coords.geographic, [-131.25, 23, -114, 52]);
  return mix(texture(global, coords.globalUV).rgb, texture(regional, day.regionalUV).rgb, day.blend);
}

export function earthNightColor(global: Texture, regional: Texture, photograph: Texture, coords: ReturnType<typeof earthSurfaceCoordinates>) {
  // The regional 2016 VIIRS annual radiance composite has a documented
  // display shoulder baked into its sRGB texture. Feather the independent
  // regional and global composites in linear display light.
  const night = regionalCoordinates(coords.geographic, [-130.66666666666663, 29.099166666666626, -113.59999999999995, 46.1658333333333], 2);
  const luminance = vec3(0.2126, 0.7152, 0.0722);
  const globalLight = texture(global, coords.globalUV).rgb.dot(luminance);
  // Match mean linear display luminance over the co-registered opaque area.
  const regionalLight = texture(regional, night.regionalUV).rgb.dot(luminance).mul(iss.displayMatch.regionalGain);
  const composite = mix(globalLight, regionalLight, night.blend).mul(vec3(1, 0.88, 0.74));

  // The photograph carries its own irregular coverage mask. Its display colors
  // are already sRGB-decoded by the sampler. Return to the annual composite
  // as the screen footprint grows from one to two regional grid cells.
  const local = regionalCoordinates(coords.geographic, iss.bounds, 0.01);
  const observed = texture(photograph, local.regionalUV);
  const footprint = fwidth(coords.geographic);
  const resolutionWeight = footprint.x.max(footprint.y).smoothstep(1 / 240, 2 / 240).oneMinus();
  return mix(composite, observed.rgb, observed.a.mul(local.blend).mul(resolutionWeight));
}
