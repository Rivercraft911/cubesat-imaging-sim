import * as THREE from "three/webgpu";
import { geodeticToEcef } from "../sim";
import type { GroundImage } from "./types";
import type { makeSensorMaterial } from "./sensor-material";
type SensorMaterial = ReturnType<typeof makeSensorMaterial>;

/** Permanent regional coverage stays resident when a detailed shot is replaced.
 * Texture RGB is unchanged. Alpha and a 1%-wide perimeter (at least 16 source pixels) select the
 * underlying real image; GPU mipmaps handle minification within each level. */
export function createGroundLayers(
  sensor: SensorMaterial,
  fallback: THREE.Texture,
  retire: (texture: THREE.Texture) => void,
  upload: (texture: THREE.Texture) => void,
) {
  const baseFallback = fallback.clone();
  baseFallback.needsUpdate = true;
  let baseImage: GroundImage | null = null,
    detailImage: GroundImage | null = null;
  let baseSize = [1, 1],
    detailSize = [1, 1];
  let baseTexture: THREE.Texture = baseFallback,
    detailTexture: THREE.Texture = fallback;
  sensor.baseNode.value = baseFallback;
  function makeTexture(image: GroundImage) {
    if (image.image.width < 1 || image.image.height < 1)
      throw new Error("Cannot upload an empty or closed ground image.");
    const result = new THREE.Texture(image.image);
    result.flipY = true;
    result.colorSpace = THREE.SRGBColorSpace;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.magFilter = THREE.LinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = 8;
    result.needsUpdate = true;
    try {
      upload(result);
    } catch (error) {
      result.dispose();
      throw error;
    }
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
    for (const [image, bounds, fade, size] of [
      [baseImage, sensor.u.baseBounds, sensor.u.baseFade, baseSize],
      [detailImage, sensor.u.bounds, sensor.u.groundFade, detailSize],
    ] as const) {
      if (!image) continue;
      const [w, s, e, n] = image.boundsMercator;
      bounds.value.set(w - cx, s - cy, e - cx, n - cy);
      fade.value.set(
        Math.max(0.01, 16 / size[0]),
        Math.max(0.01, 16 / size[1]),
      );
    }
  }
  return {
    setBase(image: GroundImage | null) {
      const next = image ? makeTexture(image) : baseFallback;
      if (baseTexture !== baseFallback) retire(baseTexture);
      baseSize = image ? [image.image.width, image.image.height] : [1, 1];
      baseImage = image;
      baseTexture = next;
      sensor.baseNode.value = baseTexture;
      sensor.u.hasBase.value = image ? 1 : 0;
      updateReference();
    },
    setDetail(image: GroundImage | null) {
      const next = image ? makeTexture(image) : fallback;
      if (detailTexture !== fallback) retire(detailTexture);
      detailSize = image ? [image.image.width, image.image.height] : [1, 1];
      detailImage = image;
      detailTexture = next;
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
