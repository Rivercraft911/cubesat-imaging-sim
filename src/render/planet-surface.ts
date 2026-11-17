import * as THREE from "three/webgpu";
import {
  Fn,
  mix,
  positionGeometry,
  texture,
  vec2,
  vec3,
  vec4,
  wgslFn,
} from "three/tsl";
import type { makeSensorMaterial } from "./sensor-material";
import { surfaceUVWgsl } from "./projection";
const surfaceUV = wgslFn(surfaceUVWgsl);

/** The context globe uses the same regional images and alpha masks as the
 * cameras. Its sphere's reduced latitude is converted to geodetic latitude;
 * otherwise texture features drift when switching between context and sensor. */
export function makePlanetSurface(
  day: THREE.Texture,
  western: THREE.Texture,
  sensor: ReturnType<typeof makeSensorMaterial>,
) {
  return Fn(() => {
    // SphereGeometry is Y-polar; the planet is scaled at Y and rotated +90° at X.
    const ecef = vec3(
      positionGeometry.x,
      positionGeometry.z.negate(),
      positionGeometry.y.mul(0.9966471893352525),
    );
    const coords = vec4(surfaceUV(ecef) as ReturnType<typeof vec4>);
    const base = texture(day, coords.xy).rgb.toVar();
    const geographic = coords.xy.mul(vec2(360, 180)).sub(vec2(180, 90));
    const southwest = vec2(-130.66666666666666, 29.1),
      northeast = vec2(-113.6, 46.166666666666664);
    const regionalUV = geographic.sub(southwest).div(northeast.sub(southwest));
    const geographicEdge = geographic
      .sub(southwest)
      .min(northeast.sub(geographic));
    base.assign(
      mix(
        base,
        texture(western, regionalUV).rgb,
        geographicEdge.x.min(geographicEdge.y).smoothstep(0, 0.25),
      ),
    );
    const mercator = coords.zw.sub(sensor.u.referenceMercator);
    const layers = [
      {
        node: sensor.baseNode,
        bounds: sensor.u.baseBounds,
        active: sensor.u.hasBase,
        fade: sensor.u.baseFade,
      },
      {
        node: sensor.groundNode,
        bounds: sensor.u.bounds,
        active: sensor.u.hasGround,
        fade: sensor.u.groundFade,
      },
    ];
    // Sample all layers in uniform control flow; coverage only weights them.
    const sampled = layers.map((layer) => {
      const regional = mercator
        .sub(layer.bounds.xy)
        .div(layer.bounds.zw.sub(layer.bounds.xy));
      const image = layer.node.sample(regional).toVar();
      const distance = regional.min(vec2(1).sub(regional));
      const alpha = image.a
        .mul(layer.active)
        .mul(distance.x.smoothstep(0, layer.fade.x))
        .mul(distance.y.smoothstep(0, layer.fade.y));
      return { color: image.rgb, alpha };
    });
    const baseFirst = mix(
      mix(base, sampled[0].color, sampled[0].alpha),
      sampled[1].color,
      sampled[1].alpha,
    );
    const detailFirst = mix(
      mix(base, sampled[1].color, sampled[1].alpha),
      sampled[0].color,
      sampled[0].alpha,
    );
    base.assign(
      sensor.u.detailFiner.greaterThan(0.5).select(baseFirst, detailFirst),
    );
    return base;
  })();
}
