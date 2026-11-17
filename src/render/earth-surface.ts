import type { Node, Texture } from 'three/webgpu';
import { atan, mix, texture, vec2, vec3 } from 'three/tsl';

/** Shared ECEF registration for the regional MODIS and native Black Marble
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

export function earthNightColor(global: Texture, regional: Texture, coords: ReturnType<typeof earthSurfaceCoordinates>) {
  // Native 500 m Black Marble grayscale and the publisher's colored global map
  // have different display styling, epochs and resolution. Compare their
  // linear-light luminance and apply one illustrative tint after blending, so
  // crossing the crop cannot change the apparent light color. This is not a
  // radiance calibration. A 2° transition softens the source-detail boundary;
  // it does not alter or synthesize either source's spatial detail.
  const night = regionalCoordinates(coords.geographic, [-130.66666666666666, 29.1, -113.6, 46.166666666666664], 2);
  const luminance = vec3(0.2126, 0.7152, 0.0722);
  const globalLight = texture(global, coords.globalUV).rgb.dot(luminance);
  const regionalLight = texture(regional, night.regionalUV).rgb.dot(luminance);
  return mix(globalLight, regionalLight, night.blend).mul(vec3(1, 0.88, 0.74));
}
