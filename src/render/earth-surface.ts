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

function regionalCoordinates(geographic: Node<'vec2'>, bounds: readonly number[]) {
  const southwest = vec2(bounds[0], bounds[1]), northeast = vec2(bounds[2], bounds[3]);
  const regionalUV = geographic.sub(southwest).div(northeast.sub(southwest));
  const edge = geographic.sub(southwest).min(northeast.sub(geographic));
  return { regionalUV, blend: edge.x.min(edge.y).smoothstep(0, 0.25) };
}

export function earthDayColor(global: Texture, regional: Texture, coords: ReturnType<typeof earthSurfaceCoordinates>) {
  // west-coast-regional.json: daily MODIS coverage for the full default pass.
  const day = regionalCoordinates(coords.geographic, [-131.25, 23, -114, 52]);
  return mix(texture(global, coords.globalUV).rgb, texture(regional, day.regionalUV).rgb, day.blend);
}

export function earthNightColor(global: Texture, regional: Texture, coords: ReturnType<typeof earthSurfaceCoordinates>) {
  // earth-night-western-us.json: native 500 m Black Marble crop.
  const night = regionalCoordinates(coords.geographic, [-130.66666666666666, 29.1, -113.6, 46.166666666666664]);
  return mix(texture(global, coords.globalUV).rgb,
    texture(regional, night.regionalUV).r.mul(vec3(1, 0.88, 0.74)), night.blend);
}
