import { intersectEarth } from './earth';
import { add, axisRotation, basisRotation, composeRotation, DEG, inverseRotation, length, normalize, rotate, scale, sub } from './math';
import type { CameraConfig, CameraPose, Lens, SensorProfile, SimulationSample, Vec3 } from './types';

const FRONT_CAMERA = basisRotation([1, 0, 0], [0, 0, -1], [0, 1, 0]);
const REAR_CAMERA = basisRotation([-1, 0, 0], [0, 0, -1], [0, -1, 0]);

/** Wide mounts apply intrinsic yaw (right), pitch (up), then roll (clockwise).
 * Main's optical axes are fixed in the body frame. */
export function cameraBodyRotation(camera: CameraConfig) {
  let bodyFromCamera = FRONT_CAMERA;
  if (camera.id !== 'main') {
    const reference = camera.id === 'wideA' ? FRONT_CAMERA : REAR_CAMERA;
    const yaw = axisRotation([0, 1, 0], camera.yawDeg * DEG);
    const pitch = axisRotation([1, 0, 0], camera.pitchDeg * DEG);
    const roll = axisRotation([0, 0, 1], camera.rollDeg * DEG);
    bodyFromCamera = composeRotation(reference, composeRotation(yaw, composeRotation(pitch, roll)));
  }

  return bodyFromCamera;
}

export function cameraPose(sample: SimulationSample, camera: CameraConfig): CameraPose {
  return {
    positionEcefM: add(sample.positionEcefM, rotate(sample.qEcefFromBody, camera.positionBodyM)),
    qEcefFromCamera: composeRotation(sample.qEcefFromBody, cameraBodyRotation(camera)),
  };
}

function angleFromRadius(lens: Lens, radiusMm: number): number {
  const ratio = radiusMm / lens.focalLengthMm;
  if (lens.projection === 'rectilinear') return Math.atan(ratio);
  if (lens.projection === 'equidistant') {
    const factor = lens.fThetaEdgeFactor ?? 0;
    if (!factor) return ratio;
    const edgeAngle = availableAngle(lens);
    const normalizedRadius = ratio / edgeAngle;
    const edgeRadius = 1 + factor;
    if (normalizedRadius >= edgeRadius) {
      return edgeAngle * (1 + (normalizedRadius - edgeRadius) / (1 + 3 * factor));
    }
    let t = normalizedRadius / edgeRadius;
    for (let iteration = 0; iteration < 5; iteration++) {
      const cubic = factor * t * t;
      t -= (t * (1 + cubic) - normalizedRadius) / (1 + 3 * cubic);
    }
    return t * edgeAngle;
  }
  return 2 * Math.asin(ratio / 2);
}

function radiusFromAngle(lens: Lens, angleRad: number): number {
  if (lens.projection === 'rectilinear') return lens.focalLengthMm * Math.tan(angleRad);
  if (lens.projection === 'equidistant') {
    const factor = lens.fThetaEdgeFactor ?? 0;
    if (!factor) return lens.focalLengthMm * angleRad;
    const edgeAngle = availableAngle(lens);
    const t = angleRad / edgeAngle;
    // Continue linearly after the fitted edge for the unclipped projection path.
    const normalizedRadius = t <= 1
      ? t * (1 + factor * t * t)
      : 1 + factor + (t - 1) * (1 + 3 * factor);
    return lens.focalLengthMm * edgeAngle * normalizedRadius;
  }
  return 2 * lens.focalLengthMm * Math.sin(angleRad / 2);
}

function availableAngle(lens: Lens): number {
  return Math.min(lens.maxFovDeg * DEG / 2, lens.projection === 'rectilinear' ? Math.PI / 2 : Math.PI);
}

export function usableRadiusMm(lens: Lens, angle = availableAngle(lens)): number {
  return Math.min(lens.imageCircleMm / 2, radiusFromAngle(lens, angle));
}

export function axisFovDeg(lens: Lens, axisSizeMm: number): number {
  return angleFromRadius(lens, Math.min(usableRadiusMm(lens), axisSizeMm / 2)) * 2 / DEG;
}

/** Native sensor edge coordinates; first pixel center is (0.5, 0.5).
 * Returns a unit vector in the right/down/forward camera frame. */
export function rayForPixel(camera: CameraConfig, sensor: SensorProfile, u: number, v: number): Vec3 | null {
  if (u < 0 || v < 0 || u > sensor.width || v > sensor.height) return null;
  const pitchMm = sensor.pixelPitchUm / 1000;
  const x = (u - sensor.width / 2) * pitchMm;
  const y = (v - sensor.height / 2) * pitchMm;
  const radiusMm = Math.hypot(x, y);
  if (radiusMm > usableRadiusMm(camera.lens) + 1e-12) return null;
  if (radiusMm === 0) return [0, 0, 1];
  const angle = angleFromRadius(camera.lens, Math.min(radiusMm, usableRadiusMm(camera.lens)));
  const radialScale = Math.sin(angle) / radiusMm;
  return [radialScale * x, radialScale * y, Math.cos(angle)];
}

/** ECEF point projection. Unclipped projection is useful for exposure trajectories. */
export function projectPoint(
  camera: CameraConfig,
  sensor: SensorProfile,
  pose: CameraPose,
  pointEcefM: Vec3,
  clip = true,
): [number, number] | null {
  const [x, y, z] = rotate(inverseRotation(pose.qEcefFromCamera), normalize(sub(pointEcefM, pose.positionEcefM)));
  if (!Number.isFinite(z) || (camera.lens.projection === 'rectilinear' && z <= 0)) return null;
  const radial = Math.hypot(x, y);
  if (radial < 1e-14) return z > 0 ? [sensor.width / 2, sensor.height / 2] : null;
  const angle = Math.atan2(radial, z);
  const radiusMm = radiusFromAngle(camera.lens, angle);
  const radiusPx = radiusMm * 1000 / sensor.pixelPitchUm;
  const u = sensor.width / 2 + radiusPx * x / radial;
  const v = sensor.height / 2 + radiusPx * y / radial;
  if (clip && (radiusMm > usableRadiusMm(camera.lens) + 1e-12 || u < 0 || v < 0 || u > sensor.width || v > sensor.height)) {
    return null;
  }
  return [u, v];
}

/** Native projection with WGS84 Earth occlusion and sensor/lens clipping.
 * The 0.1 m intersection tolerance prevents roundoff hiding surface landmarks.
 * Terrain, structures and spacecraft occlusion are not modeled here.
 */
export function projectVisibleGroundPoint(
  camera: CameraConfig, sensor: SensorProfile, pose: CameraPose, pointEcefM: Vec3,
): [number, number] | null {
  const toPoint = sub(pointEcefM, pose.positionEcefM);
  const rangeM = length(toPoint);
  if (!(rangeM > 0)) return null;
  const hit = intersectEarth(pose.positionEcefM, scale(toPoint, 1 / rangeM));
  if (hit && length(sub(hit, pose.positionEcefM)) < rangeM - 0.1) return null;
  return projectPoint(camera, sensor, pose, pointEcefM);
}
