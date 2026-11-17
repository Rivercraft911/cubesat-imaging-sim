import * as THREE from "three/webgpu";
import {
  cameraPose,
  computeMetrics,
  intersectEarth,
  rotate,
  projectPoint,
  sampleState,
} from "../sim";
import type {
  CameraConfig,
  SensorProfile,
  Scenario,
  SimulationSample,
} from "../sim";
import { makePsf } from "./psf";
interface NativeOpticsInput {
  material: THREE.MeshBasicNodeMaterial;
  crop: THREE.Vector4;
  scenario: Scenario;
  camera: CameraConfig;
  sensor: SensorProfile;
  sample: SimulationSample;
  timeS: number;
  target: THREE.RenderTarget;
  warnings: Set<string>;
}
/** All optical filtering occurs at native resolution, in linear half-float
 * intermediates. Display and codec sizing happen after this pipeline. */
export function createOpticsPipeline(
  renderer: THREE.WebGPURenderer,
  quadScene: THREE.Scene,
  quadCamera: THREE.Camera,
  quad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>,
) {
  const linearTarget = () =>
    new THREE.RenderTarget(1, 1, {
      depthBuffer: false,
      type: THREE.HalfFloatType,
    });
  const rawTarget = linearTarget(),
    blurTarget = linearTarget(),
    blurTarget2 = linearTarget();
  const psf = makePsf(rawTarget.texture);
  return {
    render({
      material,
      crop,
      scenario,
      camera: c,
      sensor: s,
      sample,
      timeS,
      target,
      warnings,
    }: NativeOpticsInput) {
      for (const buffer of [rawTarget, blurTarget, blurTarget2])
        buffer.setSize(target.width, target.height);
      quad.material = material;
      renderer.setRenderTarget(rawTarget);
      renderer.render(quadScene, quadCamera);
      const metrics = computeMetrics(scenario, c.id, timeS);
      const requestedSigma = Math.hypot(
        metrics.airyDiameterPx * 0.179,
        metrics.jitterSigmaPx,
        c.lens.extraBlurPx,
      );
      const sigma = Math.min(24, requestedSigma);
      if (requestedSigma > 24)
        warnings.add(
          `${c.name}: Gaussian-core blur limited to 24 native pixels sigma.`,
        );

      quad.material = psf.material;
      psf.motion.value = 0;
      psf.exposure.value = 1;
      psf.input.value = rawTarget.texture;
      psf.delta.value.set(sigma / crop.z, 0);
      renderer.setRenderTarget(blurTarget);
      renderer.render(quadScene, quadCamera);
      psf.input.value = blurTarget.texture;
      psf.delta.value.set(0, sigma / crop.w);
      renderer.setRenderTarget(blurTarget2);
      renderer.render(quadScene, quadCamera);
      let dx = 0,
        dy = 0;
      const pose = cameraPose(sample, c),
        center = intersectEarth(
          pose.positionEcefM,
          rotate(pose.qEcefFromCamera, [0, 0, 1]),
        );
      if (center) {
        const t = c.exposureMs / 2000;
        const a = projectPoint(
          c,
          s,
          cameraPose(sampleState(scenario, timeS - t), c),
          center,
          false,
        );
        const b = projectPoint(
          c,
          s,
          cameraPose(sampleState(scenario, timeS + t), c),
          center,
          false,
        );
        if (a && b) {
          dx = b[0] - a[0];
          dy = b[1] - a[1];
        }
      }
      // Nine equal shutter samples along a locally linear image trajectory.
      const length = Math.hypot(dx, dy);
      if (length > 256)
        warnings.add(`${c.name}: shutter smear limited to 256 native pixels.`);
      const bound = Math.min(1, 256 / Math.max(length, 0.0001));
      psf.input.value = blurTarget2.texture;
      psf.motion.value = 1;
      psf.delta.value.set(
        (dx * bound) / (6.75 * crop.z),
        (-dy * bound) / (6.75 * crop.w),
      );
      psf.exposure.value = 1;
      renderer.setRenderTarget(target);
      renderer.render(quadScene, quadCamera);
    },
    dispose() {
      psf.material.dispose();
      for (const target of [rawTarget, blurTarget, blurTarget2])
        target.dispose();
    },
  };
}
