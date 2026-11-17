import * as THREE from "three/webgpu";
import { geodeticToEcef } from "../sim";
import type { GroundImage } from "./types";
import type { makeSensorMaterial } from "./sensor-material";
type SensorMaterial = ReturnType<typeof makeSensorMaterial>;

/** Permanent regional coverage stays resident when a detailed shot is replaced.
 * Texture RGB is unchanged. Alpha and a 16-source-pixel perimeter select the
 * underlying real image; GPU mipmaps handle minification within each level. */
export function createGroundLayers(
  sensor: SensorMaterial,
  fallback: THREE.Texture,
  retire: (texture: THREE.Texture) => void,
) {
  const baseFallback = fallback.clone();
  baseFallback.needsUpdate = true;
  let baseImage: GroundImage | null = null,
    detailImage: GroundImage | null = null;
  let baseTexture: THREE.Texture = baseFallback,
    detailTexture: THREE.Texture = fallback;
  sensor.baseNode.value = baseFallback;
  function makeTexture(image: GroundImage) {
    const result = new THREE.Texture(image.image);
    result.flipY = true;
    result.colorSpace = THREE.SRGBColorSpace;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.magFilter = THREE.LinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = 8;
    result.needsUpdate = true;
    return result;
  }
  function updateReference() {
    sensor.u.detailFiner.value =
      detailImage &&
      baseImage &&
      detailImage.sourceResolutionM > baseImage.sourceResolutionM
        ? 0
        : 1;
    const reference = detailImage ?? baseImage;
    if (!reference) return;
    const [west, south, east, north] = reference.boundsMercator,
      cx = (west + east) / 2,
      cy = (south + north) / 2;
    sensor.u.referenceMercator.value.set(cx, cy);
    const latitude = Math.atan(Math.sinh(cy / 6378137)),
      longitude = cx / 6378137;
    sensor.u.groundReference.value.fromArray(
      geodeticToEcef((latitude * 180) / Math.PI, (longitude * 180) / Math.PI),
    );
    sensor.u.referenceLat.value.set(Math.sin(latitude), Math.cos(latitude));
    for (const [image, bounds, fade] of [
      [baseImage, sensor.u.baseBounds, sensor.u.baseFade],
      [detailImage, sensor.u.bounds, sensor.u.groundFade],
    ] as const) {
      if (!image) continue;
      const [w, s, e, n] = image.boundsMercator;
      bounds.value.set(w - cx, s - cy, e - cx, n - cy);
      fade.value.set(16 / image.image.width, 16 / image.image.height);
    }
  }
  return {
    setBase(image: GroundImage | null) {
      if (baseTexture !== baseFallback) retire(baseTexture);
      baseImage = image;
      baseTexture = image ? makeTexture(image) : baseFallback;
      sensor.baseNode.value = baseTexture;
      sensor.u.hasBase.value = image ? 1 : 0;
      updateReference();
    },
    setDetail(image: GroundImage | null) {
      if (detailTexture !== fallback) retire(detailTexture);
      detailImage = image;
      detailTexture = image ? makeTexture(image) : fallback;
      sensor.groundNode.value = detailTexture;
      sensor.u.hasGround.value = image ? 1 : 0;
      updateReference();
    },
    dispose() {
      if (baseTexture !== baseFallback) baseTexture.dispose();
      if (detailTexture !== fallback) detailTexture.dispose();
      baseFallback.dispose();
    },
  };
}
