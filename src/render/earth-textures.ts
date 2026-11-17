import * as THREE from "three/webgpu";
import { publicAsset } from "../assets";

/** Actual source imagery, with mipmaps for native sensor and globe sampling. */
export async function loadEarthTextures() {
  const loader = new THREE.TextureLoader();
  const load = async (path: string) => {
    const t = await loader.loadAsync(publicAsset(path));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  // Wait for every independent load so a failed sibling cannot leak textures
  // that finish later than the first rejected image request.
  const loaded = await Promise.allSettled([
    load("earth-day.jpg"),
    load("earth-night.jpg"),
    load("earth-clouds.webp"),
    load("west-coast-regional.webp"),
    load("earth-night-western-us.webp"),
    load("earth-clouds-western-us.png"),
  ]);
  const failure = loaded.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    for (const result of loaded)
      if (result.status === "fulfilled") result.value.dispose();
    throw failure.reason;
  }
  const [day, night, cloud, western, westernNight, regionalCloud] = loaded.map(
    (result) => (result as PromiseFulfilledResult<THREE.Texture>).value,
  );
  cloud.colorSpace = THREE.NoColorSpace;
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
    fallback,
    dispose() {
      for (const texture of [
        day,
        night,
        cloud,
        western,
        westernNight,
        regionalCloud,
        fallback,
      ])
        texture.dispose();
    },
  };
}
