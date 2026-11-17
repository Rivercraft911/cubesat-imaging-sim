import * as THREE from "three/webgpu";
import { ellipsoidNormal, intersectEarth } from "../sim";
import type { SimulationSample, Vec3 } from "../sim";
/** The same global day image used on the globe supplies a low-frequency
 * diffuse-color proxy for Earthshine. The image is display-referred and the
 * lighting remains illustrative. Longitude is east-positive, north is up. */
function diffuseEarthImage(day: THREE.Texture) {
  if (typeof HTMLImageElement === "undefined" || !(day.image instanceof HTMLImageElement)) return;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(day.image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
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
  private readonly surface?: ImageData;
  private readonly linear = Array.from({ length: 256 }, (_, i) => THREE.ColorManagement.toWorkingColorSpace(
    new THREE.Color(i / 255, 0, 0), THREE.SRGBColorSpace).r);
  constructor(day: THREE.Texture) {
    this.surface = diffuseEarthImage(day);
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
        let light = 0, r = 0.68, g = 0.8, b = 1;
        if (hit) {
          const n = ellipsoidNormal(hit);
          if (this.surface) {
            const { width, height, data } = this.surface;
            const longitude = Math.atan2(n[1], n[0]), latitude = Math.asin(n[2]);
            const col = Math.min(width - 1, Math.floor(width * (0.5 + longitude / (2 * Math.PI))));
            const row = Math.min(height - 1, Math.floor(height * (0.5 - latitude / Math.PI)));
            const i = 4 * (row * width + col);
            // Broad blue atmospheric fill plus spatially varying surface scatter.
            r = 0.18 + 0.82 * this.linear[data[i]];
            g = 0.24 + 0.76 * this.linear[data[i + 1]];
            b = 0.36 + 0.64 * this.linear[data[i + 2]];
          }
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
        this.data[index] = light * r;
        this.data[index + 1] = light * g;
        this.data[index + 2] = light * b;
        this.data[index + 3] = 1;
      }
    this.texture.needsUpdate = true;
    this.texture.needsPMREMUpdate = true;
  }
  dispose() {
    this.texture.dispose();
  }
}
