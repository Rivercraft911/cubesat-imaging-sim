import * as THREE from "three/webgpu";
import Color4 from "three/src/renderers/common/Color4.js";
import {
  cameraPose,
  type CameraConfig,
  type SimulationSample,
} from "../sim";

/** Main and Wide A share the front target. Wide B owns the rear target.
 * Editor overlays stay on layer 1, outside every cube camera's layer 0. */
export function createHardwareCapture(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
) {
  const keys = new Map<THREE.CubeCamera, string>();
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
      camera: CameraConfig,
      sample: SimulationSample,
      geometryRevision: number,
    ) {
      const cam = camera.id === "wideB" ? cubeCamB : cubeCamA;
      // Every cube face sees the same spacecraft, light and reflected Earth
      // regardless of the sensor optics used to project the cube afterward.
      const key = [
        camera.id, geometryRevision, sample.positionEcefM,
        sample.qEcefFromBody, sample.sunDirectionEcef, scene.environment?.version,
      ].join(":");
      if (keys.get(cam) === key) return;
      const previous = renderer.getRenderTarget();
      const oldClear = new Color4();
      renderer.getClearColor(oldClear);
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0, 0);
      try {
        const pose = cameraPose(sample, camera);
        cam.position
          .fromArray(pose.positionEcefM)
          .sub(new THREE.Vector3(...sample.positionEcefM));
        keys.delete(cam);
        cam.update(renderer, scene);
        keys.set(cam, key);
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
