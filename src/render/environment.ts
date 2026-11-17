import * as THREE from "three/webgpu";
import { ellipsoidNormal, intersectEarth } from "../sim";
import type { SimulationSample, Vec3 } from "../sim";
/** Low-resolution Earth-reflected radiance for material reflections. Uniform
 * 0.3 broadband albedo is an illustrative context approximation, not the
 * source-normalized sensor image or a calibrated spacecraft thermal model. */
export class EarthEnvironment {
  readonly width = 128;
  readonly height = 64;
  readonly data = new Float32Array(this.width * this.height * 4);
  readonly texture = new THREE.DataTexture(
    this.data,
    this.width,
    this.height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  private key = "";
  constructor() {
    this.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.texture.needsUpdate = true;
  }
  update(sample: SimulationSample) {
    const key =
      sample.positionEcefM.map((v) => Math.round(v / 10_000)).join(",") +
      sample.sunDirectionEcef.map((v) => v.toFixed(3)).join(",");
    if (key === this.key) return;
    this.key = key;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const longitude = ((x + 0.5) / this.width - 0.5) * Math.PI * 2,
          latitude = ((y + 0.5) / this.height - 0.5) * Math.PI;
        const ray: Vec3 = [
          Math.cos(latitude) * Math.cos(longitude),
          Math.sin(latitude),
          Math.cos(latitude) * Math.sin(longitude),
        ];
        const hit = intersectEarth(sample.positionEcefM, ray);
        let light = 0;
        if (hit) {
          const n = ellipsoidNormal(hit);
          light =
            0.9 *
            Math.max(
              0,
              n[0] * sample.sunDirectionEcef[0] +
                n[1] * sample.sunDirectionEcef[1] +
                n[2] * sample.sunDirectionEcef[2],
            );
        }
        const index = (y * this.width + x) * 4;
        this.data[index] = light * 0.68;
        this.data[index + 1] = light * 0.8;
        this.data[index + 2] = light;
        this.data[index + 3] = 1;
      }
    this.texture.needsUpdate = true;
    this.texture.needsPMREMUpdate = true;
  }
  dispose() {
    this.texture.dispose();
  }
}
