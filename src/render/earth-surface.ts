import type { Node, Texture } from 'three/webgpu';
import { atan, mix, texture, vec2, vec3 } from 'three/tsl';

const southwest = vec2(-130.66666666666666, 29.1);
const northeast = vec2(-113.6, 46.166666666666664);

/** Shared ECEF registration for the regional MODIS and native Black Marble
 * crops. Samples stay outside coverage branches so mip derivatives are valid. */
export function earthSurfaceCoordinates(point: Node<'vec3'>) {
  const longitude = atan(point.y, point.x);
  const latitude = atan(point.z.div(0.9966471893352525 ** 2), point.xy.length());
  const globalUV = vec2(longitude.div(2 * Math.PI).add(0.5), latitude.div(Math.PI).add(0.5));
  const geographic = vec2(longitude, latitude).mul(180 / Math.PI);
  const regionalUV = geographic.sub(southwest).div(northeast.sub(southwest));
  const edge = geographic.sub(southwest).min(northeast.sub(geographic));
  return { globalUV, regionalUV, blend: edge.x.min(edge.y).smoothstep(0, 0.25) };
}

export function earthDayColor(global: Texture, regional: Texture, coords: ReturnType<typeof earthSurfaceCoordinates>) {
  return mix(texture(global, coords.globalUV).rgb, texture(regional, coords.regionalUV).rgb, coords.blend);
}

export function earthNightColor(global: Texture, regional: Texture, coords: ReturnType<typeof earthSurfaceCoordinates>) {
  return mix(texture(global, coords.globalUV).rgb,
    texture(regional, coords.regionalUV).r.mul(vec3(1, 0.88, 0.74)), coords.blend);
}
