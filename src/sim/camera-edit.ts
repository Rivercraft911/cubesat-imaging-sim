import type { CameraConfig, CameraId, Scenario } from './types';

/** Signed body Y of a wide optical center. The nominal pupil plane is 5 mm beyond the body face. */
export function wideMountBodyYM(id: Exclude<CameraId, 'main'>, bodyDepthM: number, extraStandOffMm = 0): number {
  const outward = id === 'wideA' ? 1 : -1;
  return outward * (bodyDepthM / 2 + 0.005 + extraStandOffMm / 1_000);
}

/** Opposing faces have opposite image-right axes and the same up axis.
 * Equal local yaw and opposite local pitch keep the two boresights antiparallel. */
export function editCamera(scenario: Scenario, id: CameraId, changes: Partial<CameraConfig>): Scenario {
  const driver = scenario.cameras.find(camera => camera.id === id);
  if (!driver) return scenario;
  // Resolve both angles on aim edits so a single-axis edit also relinks a saved asymmetric study.
  const partnerAim = changes.yawDeg !== undefined || changes.pitchDeg !== undefined
    ? { yawDeg: changes.yawDeg ?? driver.yawDeg, pitchDeg: -(changes.pitchDeg ?? driver.pitchDeg) || 0 }
    : undefined;
  return {
    ...scenario,
    cameras: scenario.cameras.map(camera => {
      if (camera.id !== id && (id === 'main' || camera.id === 'main')) return camera;
      const position = changes.positionBodyM;
      return {
        ...camera,
        ...changes,
        ...(camera.id !== id && partnerAim),
        id: camera.id,
        name: camera.name,
        ...(position && camera.id !== id ? { positionBodyM: [-position[0], -position[1], position[2]] as [number, number, number] } : {}),
      };
    }),
  };
}
