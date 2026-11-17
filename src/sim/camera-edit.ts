import type { CameraConfig, CameraId, Scenario } from './types';

/** Signed body Y of a wide optical center. The nominal pupil plane is 5 mm beyond the body face. */
export function wideMountBodyYM(id: Exclude<CameraId, 'main'>, bodyDepthM: number, extraStandOffMm = 0): number {
  const outward = id === 'wideA' ? 1 : -1;
  return outward * (bodyDepthM / 2 + 0.005 + extraStandOffMm / 1_000);
}

/** The wide pair shares optics and local mount angles. Its opposite mount is
 * a 180° rotation about body +Z: (x,y,z) → (−x,−y,z). */
export function editCamera(scenario: Scenario, id: CameraId, changes: Partial<CameraConfig>): Scenario {
  return {
    ...scenario,
    cameras: scenario.cameras.map(camera => {
      if (camera.id !== id && (id === 'main' || camera.id === 'main')) return camera;
      const position = changes.positionBodyM;
      return {
        ...camera,
        ...changes,
        id: camera.id,
        name: camera.name,
        ...(position && camera.id !== id ? { positionBodyM: [-position[0], -position[1], position[2]] as [number, number, number] } : {}),
      };
    }),
  };
}
