import * as THREE from "three/webgpu";
import type { CloudLayer } from "./cloud-layer";
import type { AerialTransfer } from "./aerial-transfer";
import {
  Fn,
  If,
  float,
  mat3,
  mix,
  texture,
  cubeTexture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  wgslFn,
} from "three/tsl";
import {
  cameraRayWGSL,
  earthHitWGSL,
  surfaceUVWgsl,
  localMercatorWGSL,
} from "./projection";
const rayFn = wgslFn(cameraRayWGSL),
  hitFn = wgslFn(earthHitWGSL),
  uvFn = wgslFn(surfaceUVWgsl),
  localUV = wgslFn(localMercatorWGSL);
export function makeSensorMaterial(
  day: THREE.Texture,
  ground: THREE.Texture,
  night: THREE.Texture,
  clouds: THREE.Texture,
  ship: THREE.CubeTexture,
  western: THREE.Texture,
  westernNight: THREE.Texture,
  cloudLayer: CloudLayer,
  aerial: AerialTransfer,
) {
  const u = {
    sensor: uniform(new THREE.Vector3(3840, 2160, 0.002)),
    lens: uniform(new THREE.Vector4(8, 0, Math.PI / 2, 20)),
    rotation: uniform(new THREE.Matrix3()),
    origin: uniform(new THREE.Vector3()),
    sun: uniform(new THREE.Vector3(1, 0, 0)),
    earthC: uniform(0),
    localOrigin: uniform(new THREE.Vector3()),
    groundReference: uniform(new THREE.Vector3(6378137, 0, 0)),
    referenceLat: uniform(new THREE.Vector2(0, 1)),
    referenceMercator: uniform(new THREE.Vector2()),
    bounds: uniform(new THREE.Vector4(-1, -1, 1, 1)),
    hasGround: uniform(0),
    groundFade: uniform(new THREE.Vector2(0.004, 0.004)),
    baseBounds: uniform(new THREE.Vector4(-1, -1, 1, 1)),
    baseFade: uniform(new THREE.Vector2(0.004, 0.004)),
    hasBase: uniform(0),
    detailFiner: uniform(1),
    exposure: uniform(1),
    // Display crop is expressed in native pixel coordinates, independent of GPU framebuffer size.
    crop: uniform(new THREE.Vector4(0, 0, 3840, 2160)),
    space: uniform(0),
    showShip: uniform(1),
  };
  const baseNode = texture(ground);
  const groundNode = texture(ground),
    shipNode = cubeTexture(ship);
  // Compile separate graphs: normalized main imagery must not depend on the
  // atmospheric LUT pipeline, even when context rendering is unavailable.
  const build = (contextual: boolean) => {
    const material = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    material.colorNode = Fn(() => {
      const p = vec2(uv().x, float(1).sub(uv().y))
        .mul(u.crop.zw)
        .add(u.crop.xy);
      const camRay = vec4(
        rayFn(p, u.sensor, u.lens) as ReturnType<typeof vec4>,
      ).toVar();
      const ray = vec3(u.rotation.mul(camRay.xyz)).normalize().toVar();
      const hit = vec4(
        hitFn(u.origin, ray, u.earthC) as ReturnType<typeof vec4>,
      ).toVar();
      const result = vec3(0).toVar();
      If(hit.w.greaterThan(0), () => {
        const coords = vec4(uvFn(hit.xyz) as ReturnType<typeof vec4>).toVar();
        const base = texture(day, coords.xy).rgb.toVar();
        // Geographic crop bounds recorded in west-coast-regional.json.
        const geographic = coords.xy.mul(vec2(360, 180)).sub(vec2(180, 90));
        const southwest = vec2(-130.66666666666666, 29.1),
          northeast = vec2(-113.6, 46.166666666666664);
        const westUV = geographic.sub(southwest).div(northeast.sub(southwest));
        const edge = geographic.sub(southwest).min(northeast.sub(geographic));
        const blend = edge.x.min(edge.y).smoothstep(0, 0.25);
        base.assign(mix(base, texture(western, westUV).rgb, blend));
        const delta = u.localOrigin.add(ray.mul(hit.w));
        const mercator = vec2(
          localUV(delta, u.groundReference, u.referenceLat) as ReturnType<
            typeof vec2
          >,
        );
        const layers = [
          {
            node: baseNode,
            bounds: u.baseBounds,
            active: u.hasBase,
            fade: u.baseFade,
          },
          {
            node: groundNode,
            bounds: u.bounds,
            active: u.hasGround,
            fade: u.groundFade,
          },
        ];
        const applyLayer = (layer: (typeof layers)[number]) => {
          const regional = mercator
            .sub(layer.bounds.xy)
            .div(layer.bounds.zw.sub(layer.bounds.xy))
            .toVar();
          If(
            layer.active
              .greaterThan(0.5)
              .and(regional.x.greaterThanEqual(0))
              .and(regional.x.lessThanEqual(1))
              .and(regional.y.greaterThanEqual(0))
              .and(regional.y.lessThanEqual(1)),
            () => {
              const tile = layer.node.sample(regional).toVar();
              const distance = regional.min(vec2(1).sub(regional));
              const edge = vec2(
                distance.x.smoothstep(0, layer.fade.x),
                distance.y.smoothstep(0, layer.fade.y),
              );
              base.assign(mix(base, tile.rgb, tile.a.mul(edge.x).mul(edge.y)));
            },
          );
        };
        If(u.detailFiner.greaterThan(0.5), () => {
          applyLayer(layers[0]);
          applyLayer(layers[1]);
        }).Else(() => {
          applyLayer(layers[1]);
          applyLayer(layers[0]);
        });
        const normal = hit.xyz
          .mul(vec3(1, 1, 1 / 0.9966471893352525 ** 2))
          .normalize();
        const sunCos = normal.dot(u.sun).toVar();
        // Orthophoto source is already photographed and lit: preserve its normalized brightness.
        result.assign(base);
        if (contextual) {
          result.assign(base.mul(sunCos.max(0).mul(0.88).add(0.025)));
          // Source-resolved VIIRS city lights; warm display tint is illustrative.
          const cityLights = mix(
            texture(night, coords.xy).rgb,
            texture(westernNight, westUV).r.mul(vec3(1, 0.88, 0.74)),
            blend,
          );
          result.addAssign(
            cityLights.mul(float(0.1).sub(sunCos).smoothstep(0, 0.2)).mul(0.6),
          );
          result.assign(
            aerial.toPoint(result, u.origin, hit.xyz.mul(6378137), u.sun),
          );
        }
      });
      if (contextual) {
        If(hit.w.lessThanEqual(0), () => {
          result.assign(aerial.sky(u.origin, ray, u.sun));
        });
        const cloud = cloudLayer.intersect(u.origin, ray).toVar();
        If(
          cloud.w
            .greaterThan(0)
            .and(hit.w.lessThanEqual(0).or(cloud.w.lessThan(hit.w))),
          () => {
            const color = vec3(0.88).mul(cloudLayer.sunlight(cloud.xyz, u.sun));
            const transported = aerial.toPoint(
              color,
              u.origin,
              cloud.xyz,
              u.sun,
            );
            result.assign(
              mix(result, transported, cloudLayer.opacity(cloud.xyz).mul(0.82)),
            );
          },
        );
      }
      If(u.showShip.greaterThan(0.5), () => {
        const hardware = shipNode.sample(ray).toVar();
        result.assign(mix(result, hardware.rgb, hardware.a));
      });
      return vec4(result.mul(u.exposure).mul(camRay.w), 1);
    })();
    return material;
  };
  return {
    material: build(false),
    wideMaterial: build(true),
    u,
    groundNode,
    baseNode,
    shipNode,
  };
}
