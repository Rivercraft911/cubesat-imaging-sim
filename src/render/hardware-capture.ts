import * as THREE from "three/webgpu";
import Color4 from "three/src/renderers/common/Color4.js";
import {
  cameraPose,
  type Scenario,
  type SimulationSample,
  type CameraId,
} from "../sim";

/** Two reusable hardware captures; both fisheyes share one scene/time cache key.
 * Editor overlays stay on layer 1, outside every cube camera's layer 0. */
export function createHardwareCapture(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
) {
  let cubeKey = "";
  const cubeA = new THREE.CubeRenderTarget(1024, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeB = new THREE.CubeRenderTarget(1024, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCamA = new THREE.CubeCamera(0.0001, 4, cubeA),
    cubeCamB = new THREE.CubeCamera(0.0001, 4, cubeB);
  return {
    front: cubeA.texture as THREE.CubeTexture,
    rear: cubeB.texture as THREE.CubeTexture,
    update(
      scenario: Scenario,
      sample: SimulationSample,
      sceneRevision: number,
      requested: "main" | "wide",
    ) {
      const config = (id: CameraId) =>
        scenario.cameras.find((c) => c.id === id)!;
      const firstId: CameraId = requested === "main" ? "main" : "wideA";
      const key = `${sceneRevision}:${sample.timeS}:${firstId}`;
      if (cubeKey === key) return;
      const previous = renderer.getRenderTarget();
      const oldClear = new Color4();
      renderer.getClearColor(oldClear);
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0, 0);
      const captures: [CameraId, THREE.CubeCamera][] =
        requested === "main"
          ? [[firstId, cubeCamA]]
          : [
              [firstId, cubeCamA],
              ["wideB", cubeCamB],
            ];
      try {
        for (const [id, cam] of captures) {
          const pose = cameraPose(sample, config(id));
          cam.position
            .fromArray(pose.positionEcefM)
            .sub(new THREE.Vector3(...sample.positionEcefM));
          cam.update(renderer, scene);
        }
        cubeKey = key;
      } finally {
        renderer.setRenderTarget(previous);
        renderer.setClearColor(oldClear, alpha);
      }
    },
    dispose() {
      cubeA.dispose();
      cubeB.dispose();
    },
  };
}
