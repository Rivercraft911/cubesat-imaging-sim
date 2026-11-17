import * as THREE from "three/webgpu";
import { Fn, float, texture, uniform, uv, vec3, vec4 } from "three/tsl";
/** Bounded separable Gaussian core at 550 nm plus uniform exposure smear.
 * Gaussian sigma matches the Airy-core FWHM, not its sidelobes. The 9-tap
 * quadrature bounds cost and is approximate for large blur. Sensor-pixel units. */
export function makePsf(source: THREE.Texture) {
  const input = texture(source),
    delta = uniform(new THREE.Vector2()),
    exposure = uniform(1),
    motion = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const rawWeights = Array.from({ length: 9 }, (_, i) =>
    Math.exp(-0.5 * ((i - 4) * 0.75) ** 2),
  );
  const sum = rawWeights.reduce((a, b) => a + b, 0);
  const weights = rawWeights.map((w) => w / sum);
  material.colorNode = Fn(() => {
    const color = vec3(0).toVar();
    for (let i = 0; i < 9; i++) {
      const offset = delta.mul((i - 4) * 0.75);
      const weight = float(weights[i])
        .mul(motion.oneMinus())
        .add(motion.mul(1 / 9));
      color.addAssign(input.sample(uv().add(offset)).rgb.mul(weight));
    }
    return vec4(color.mul(exposure), 1);
  })();
  return { material, input, delta, exposure, motion };
}
