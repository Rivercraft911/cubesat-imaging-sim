import { gaussianWeights } from "./gaussian-kernel";
import * as THREE from "three/webgpu";
import { Fn, If, float, texture, uniform, uv, vec2, vec3, vec4, wgslFn } from "three/tsl";
// Independent channel Gaussian deviates, fixed for a native pixel and simulation time.
// This deliberately approximates Poisson shot noise; not a photon-counting simulator.
const noiseResponse = wgslFn(`
fn studyResponse(color: vec3f, pixel: vec2f, seed: f32, response: vec4f) -> vec3f {
  let p = floor(pixel);
  let a = fract(sin(vec3f(dot(p, vec2f(12.9898,78.233))) + vec3f(0.0,31.7,73.9) + seed) * 43758.5453);
  let b = fract(sin(vec3f(dot(p, vec2f(39.346,11.135))) + vec3f(19.1,63.3,97.7) + seed) * 22578.1459);
  let z = sqrt(-2.0 * log(max(a, vec3f(0.00001)))) * cos(6.28318530718 * b);
  let electrons = max(color, vec3f(0.0)) * response.x;
  let sampled = electrons + z * sqrt(electrons + response.y * response.y);
  return clamp(min(sampled, vec3f(response.z)) * response.w / response.z, vec3f(0.0), vec3f(1.0));
}
`);
/** Bounded separable Gaussian core at 550 nm plus uniform exposure smear.
 * Gaussian sigma matches the Airy-core FWHM, not its sidelobes. The 9-tap
 * quadrature bounds cost and is approximate for large blur. Sensor-pixel units. */
export function makePsf(source: THREE.Texture) {
  const input = texture(source),
    delta = uniform(new THREE.Vector2()),
    exposure = uniform(1),
    motion = uniform(0),
    sideWeight = uniform(-1),
    study = uniform(0),
    response = uniform(new THREE.Vector4(0, 0, 1, 1)),
    crop = uniform(new THREE.Vector4(0, 0, 1, 1)),
    seed = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  material.colorNode = Fn(() => {
    const color = vec3(0).toVar();
    If(sideWeight.greaterThanEqual(0), () => {
      const sides = input.sample(uv().sub(delta)).rgb.add(input.sample(uv().add(delta)).rgb);
      color.assign(input.sample(uv()).rgb.mul(sideWeight.mul(2).oneMinus()).add(sides.mul(sideWeight)));
    }).Else(() => {
      for (let i = 0; i < 9; i++) {
        const offset = delta.mul((i - 4) * 0.75);
        const weight = float(gaussianWeights[i])
          .mul(motion.oneMinus())
          .add(motion.mul(1 / 9));
        color.addAssign(input.sample(uv().add(offset)).rgb.mul(weight));
      }
    });
    If(study.greaterThan(0.5), () => {
      const pixel = vec2(uv().x, float(1).sub(uv().y)).mul(crop.zw).add(crop.xy);
      color.assign(noiseResponse(color, pixel, seed, response));
    });
    return vec4(color.mul(exposure), 1);
  })();
  return { material, input, delta, exposure, motion, sideWeight, study, response, crop, seed };
}
