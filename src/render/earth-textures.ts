import * as THREE from "three/webgpu";
import { BAY_ELEVATION } from "../data/bay-elevation";
import { publicAsset } from "../assets";

/** Actual source imagery, with mipmaps for native sensor and globe sampling. */
export async function loadEarthTextures() {
  const loader = new THREE.TextureLoader();
  const load = async (path: string) => {
    const t = await loader.loadAsync(publicAsset(path)).catch((cause: unknown) => {
      const detail = cause instanceof Error ? `: ${cause.message}` : ".";
      throw new Error(`Unable to load Earth texture ${path}${detail}`, { cause });
    });
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  // Wait for every independent load so a failed sibling cannot leak textures
  // that finish later than the first rejected image request.
  const photographs = Promise.allSettled([
    load("earth-day.jpg"),
    load("earth-night.jpg"),
    load("earth-clouds.webp"),
    load("west-coast-regional.webp"),
    load("earth-night-western-us.webp"),
    load("earth-clouds-western-us-v2.png"),
    load("stanford-night-iss.webp").catch(() => {
      // A failed local photograph leaves the independent VIIRS layer visible.
      const clear = new THREE.DataTexture(new Uint8Array(4), 1, 1);
      clear.needsUpdate = true;
      return clear;
    }),
  ]);
  const [loaded, terrain] = await Promise.all([
    photographs,
    loader.loadAsync(publicAsset(BAY_ELEVATION.file)).catch(() => undefined),
  ]);
  const failure = loaded.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    for (const result of loaded)
      if (result.status === "fulfilled") result.value.dispose();
    terrain?.dispose();
    throw failure.reason;
  }
  const [day, night, cloud, western, westernNight, regionalCloud, stanfordNight] = loaded.map(
    (result) => (result as PromiseFulfilledResult<THREE.Texture>).value,
  );
  cloud.colorSpace = THREE.NoColorSpace;
  if (terrain) {
    terrain.colorSpace = THREE.NoColorSpace;
    terrain.generateMipmaps = false;
    terrain.minFilter = terrain.magFilter = THREE.LinearFilter;
  }
  const fallback = new THREE.DataTexture(
    new Uint8Array([40, 48, 46, 255]),
    1,
    1,
  );
  fallback.needsUpdate = true;
  fallback.colorSpace = THREE.SRGBColorSpace;
  return {
    day,
    night,
    cloud,
    western,
    westernNight,
    regionalCloud,
    stanfordNight,
    fallback,
    terrain,
    dispose() {
      terrain?.dispose();
      for (const texture of [
        day,
        night,
        cloud,
        western,
        westernNight,
        regionalCloud,
        stanfordNight,
        fallback,
      ])
        texture.dispose();
    },
  };
}
