import * as THREE from "three/webgpu";
import {
  Fn,
  If,
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
    const applyLayer = (layer: (typeof layers)[number]) => {
      const regional = mercator
        .sub(layer.bounds.xy)
        .div(layer.bounds.zw.sub(layer.bounds.xy));
      If(
        layer.active
          .greaterThan(0.5)
          .and(regional.x.greaterThanEqual(0))
          .and(regional.x.lessThanEqual(1))
          .and(regional.y.greaterThanEqual(0))
          .and(regional.y.lessThanEqual(1)),
        () => {
          const image = layer.node.sample(regional);
          const distance = regional.min(vec2(1).sub(regional));
          const alpha = image.a
            .mul(distance.x.smoothstep(0, layer.fade.x))
            .mul(distance.y.smoothstep(0, layer.fade.y));
          base.assign(mix(base, image.rgb, alpha));
        },
      );
    };
    If(sensor.u.detailFiner.greaterThan(0.5), () => {
      applyLayer(layers[0]);
      applyLayer(layers[1]);
    }).Else(() => {
      applyLayer(layers[1]);
      applyLayer(layers[0]);
    });
    return base;
  })();
}
