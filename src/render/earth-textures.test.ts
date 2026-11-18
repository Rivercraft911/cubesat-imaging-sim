import { expect, it, vi } from "vitest";
import * as THREE from "three/webgpu";
import { loadEarthTextures } from "./earth-textures";

it("releases successful sibling loads even when they finish after a failed asset", async () => {
  const textures = Array.from(
    { length: 7 },
    () => new THREE.Texture<HTMLImageElement>(),
  );
  const disposed = textures.map((texture) => vi.spyOn(texture, "dispose"));
  let finishLast!: (texture: THREE.Texture<HTMLImageElement>) => void;
  const last = new Promise<THREE.Texture<HTMLImageElement>>((resolve) => {
    finishLast = resolve;
  });
  let index = 0;
  const load = vi
    .spyOn(THREE.TextureLoader.prototype, "loadAsync")
    .mockImplementation(() => {
      const request = index++;
      if (request === 0)
        return Promise.reject(new Error("Missing source asset"));
      if (request === 7) return last;
      return Promise.resolve(textures[request - 1]);
    });
  try {
    const pending = loadEarthTextures();
    const rejected = expect(pending).rejects.toThrow("Missing source asset");
    finishLast(textures[6]);
    await rejected;
    for (const dispose of disposed) expect(dispose).toHaveBeenCalledOnce();
  } finally {
    load.mockRestore();
  }
});
