import { Ray, Vector3 } from 'three/webgpu';
import type { CameraConfig, Scenario } from '../sim';
import { advanceMountCoordinate, MAX_MOUNT_PITCH_DEG, MAX_MOUNT_YAW_DEG, mountRightSign, mountTravelMm } from '../sim/wide-mount';

import type { WideMountDragMode } from './types';

// Two and a half degrees of mount rotation per degree of pointer-ray motion.
const AIM_GAIN = 2.5;

/** Rays and mount coordinates are in the body frame at pointer-down. */
export function startWideDrag(mode: WideMountDragMode, id: 'wideA' | 'wideB', config: CameraConfig,
  body: Scenario['body'], first: Ray) {
  const [x, y, z] = config.positionBodyM;
  const center = new Vector3(x, y, z);
  // An edge-on mount plane has no unique inverse projection. Use the visible
  // component of motion at the pupil's depth for these grazing views.
  const normal = mode === 'move' && Math.abs(first.direction.y) >= 0.18 ? new Vector3(0, 1, 0) : first.direction.clone();
  function intersect(ray: Ray) {
    const cosine = ray.direction.dot(normal);
    if (Math.abs(cosine) < 0.08 || cosine * first.direction.dot(normal) <= 0) return null;
    const t = center.clone().sub(ray.origin).dot(normal) / cosine;
    return t >= 0 ? ray.at(t, new Vector3()) : null;
  }
  const anchor = intersect(first);
  const observerRange = anchor?.distanceTo(first.origin) ?? 0;
  const halfX = mountTravelMm(body.widthM, config.housingDiameterMm) / 1000;
  const halfZ = mountTravelMm(body.heightM, config.housingDiameterMm) / 1000;
  return (ray: Ray): Partial<CameraConfig> | null => {
    const point = intersect(ray);
    if (!anchor || !point) return null;
    const dx = point.x - anchor.x, dz = point.z - anchor.z;
    if (mode === 'move') return {
      positionBodyM: [advanceMountCoordinate(x, dx, halfX), y, advanceMountCoordinate(z, dz, halfZ)],
    };
    if (observerRange <= 0) return null;
    const degrees = (distance: number) => AIM_GAIN * Math.atan2(distance, observerRange) * 180 / Math.PI;
    return {
      yawDeg: advanceMountCoordinate(config.yawDeg, degrees(dx) * mountRightSign(id), MAX_MOUNT_YAW_DEG),
      pitchDeg: advanceMountCoordinate(config.pitchDeg, degrees(dz), MAX_MOUNT_PITCH_DEG),
    };
  };
}
