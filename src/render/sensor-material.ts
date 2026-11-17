import * as THREE from "three/webgpu";
import type { CloudLayer } from "./cloud-layer";
import type { AerialTransfer } from "./aerial-transfer";
import { earthSurfaceCoordinates, earthDayColor, earthNightColor } from "./earth-surface";
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
  localMercatorWGSL,
} from "./projection";
const rayFn = wgslFn(cameraRayWGSL),
  hitFn = wgslFn(earthHitWGSL),
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
    groundWeight: uniform(1),
    groundFade: uniform(new THREE.Vector2(0.004, 0.004)),
    baseBounds: uniform(new THREE.Vector4(-1, -1, 1, 1)),
    baseFade: uniform(new THREE.Vector2(0.004, 0.004)),
    hasBase: uniform(0),
    detailFiner: uniform(1),
    exposure: uniform(1),
    twilight: uniform(0),
    diffuseFraction: uniform(0),
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
      // Image samples execute for every fragment. A branch on Earth/raster
      // coverage would make implicit derivatives (and mip selection) undefined.
      const surface = hit.xyz;
      const coords = earthSurfaceCoordinates(surface);
      const base = earthDayColor(day, western, coords).toVar();
      const delta = hit.w.greaterThan(0).select(
        u.localOrigin.add(ray.mul(hit.w)),
        surface.mul(6378137).sub(u.groundReference),
      );
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
          active: u.hasGround.mul(u.groundWeight),
          fade: u.groundFade,
        },
      ].map((layer) => {
        const regional = mercator
          .sub(layer.bounds.xy)
          .div(layer.bounds.zw.sub(layer.bounds.xy));
        const tile = layer.node.sample(regional).toVar();
        const distance = regional.min(vec2(1).sub(regional));
        // Smoothstep is zero outside either bound, including inactive layers.
        const alpha = tile.a
          .mul(layer.active)
          .mul(distance.x.smoothstep(0, layer.fade.x))
          .mul(distance.y.smoothstep(0, layer.fade.y));
        return { color: tile.rgb, alpha };
      });
      const baseFirst = mix(
        mix(base, layers[0].color, layers[0].alpha),
        layers[1].color,
        layers[1].alpha,
      );
      const detailFirst = mix(
        mix(base, layers[1].color, layers[1].alpha),
        layers[0].color,
        layers[0].alpha,
      );
      base.assign(
        u.detailFiner.greaterThan(0.5).select(baseFirst, detailFirst),
      );
      // Main imagery retains its photographed, normalized brightness.
      const result = hit.w.greaterThan(0).select(base, vec3(0)).toVar();
      if (!contextual) {
        If(u.twilight.greaterThan(0.5), () => {
          const normal = surface.mul(vec3(1, 1, 1 / 0.9966471893352525 ** 2)).normalize();
          result.mulAssign(normal.dot(u.sun).max(0).add(u.diffuseFraction));
        });
      }
      if (contextual) {
        const normal = surface
          .mul(vec3(1, 1, 1 / 0.9966471893352525 ** 2))
          .normalize();
        const sunCos = normal.dot(u.sun).toVar();
        const cityLights = earthNightColor(night, westernNight, coords).toVar();
        const cloud = cloudLayer.intersect(u.origin, ray).toVar();
        // Miss rays retain a continuous tangent proxy. Replacing them with a
        // fixed point makes limb-crossing fragment quads select unrelated mips.
        const cloudOpacity = cloudLayer.opacity(cloud.xyz).mul(0.82).toVar();
        If(hit.w.greaterThan(0), () => {
          result.assign(base.mul(sunCos.max(0).mul(0.88).add(0.025)));
          result.addAssign(
            cityLights.mul(float(0.1).sub(sunCos).smoothstep(0, 0.2)).mul(0.6),
          );
          result.assign(
            aerial.toPoint(result, u.origin, hit.xyz.mul(6378137), u.sun),
          );
        }).Else(() => {
          result.assign(aerial.sky(u.origin, ray, u.sun));
        });
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
            result.assign(mix(result, transported, cloudOpacity));
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
