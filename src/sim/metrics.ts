import { axisFovDeg, cameraPose, projectPoint, rayForPixel, usableRadiusMm } from './camera';
import { getSensor } from './catalog';
import { intersectEarth } from './earth';
import { clamp, DEG, dot, length, normalize, rotate, scale, sub, TAU } from './math';
import { sampleState } from './orbit';
import type { CameraConfig, CameraId, CameraMetrics, Scenario, SensorProfile, Vec3 } from './types';

type GroundAtPixel = (u: number, v: number) => Vec3 | null;
const WAVELENGTH_UM = 0.55;

function onePixelGsd(groundAt: GroundAtPixel, u: number, v: number, du: number, dv: number): number {
  const before = groundAt(u - du / 2, v - dv / 2);
  const after = groundAt(u + du / 2, v + dv / 2);
  return before && after ? length(sub(after, before)) : NaN;
}

function axisGroundSpan(groundAt: GroundAtPixel, u: number, v: number, du: number, dv: number): number {
  const ends = [-1, 1].map(sign => {
    const at = (t: number) => groundAt(u + sign * t * du, v + sign * t * dv);
    const edge = at(1);
    if (edge) return edge;

    // When the edge sees sky, locate the Earth limb along this image axis.
    let low = 0;
    let high = 1;
    for (let i = 0; i < 28; i += 1) {
      const mid = (low + high) / 2;
      if (at(mid)) low = mid;
      else high = mid;
    }
    return at(low);
  });
  return ends[0] && ends[1] ? length(sub(ends[0], ends[1])) : NaN;
}

function partialGroundVisible(groundAt: GroundAtPixel, width: number, height: number, radiusPx: number): boolean {
  // Check usable perimeter for limb shots whose center is in space.
  for (let i = 0; i < 64; i += 1) {
    const azimuth = TAU * i / 64;
    const x = Math.cos(azimuth);
    const y = Math.sin(azimuth);
    const r = Math.min(radiusPx, width / 2 / Math.abs(x), height / 2 / Math.abs(y));
    const edge = 1 - 1e-10;
    if (groundAt(width / 2 + edge * r * x, height / 2 + edge * r * y)) return true;
  }
  return false;
}

function exposureSmear(
  scenario: Scenario, camera: CameraConfig, sensor: SensorProfile, center: Vec3 | null, timeS: number,
): number {
  if (!center) return NaN;
  if (camera.exposureMs === 0) return 0;
  const halfExposureS = camera.exposureMs / 2000;
  const startPose = cameraPose(sampleState(scenario, timeS - halfExposureS), camera);
  const endPose = cameraPose(sampleState(scenario, timeS + halfExposureS), camera);
  const start = projectPoint(camera, sensor, startPose, center, false);
  const end = projectPoint(camera, sensor, endPose, center, false);
  return start && end ? Math.hypot(end[0] - start[0], end[1] - start[1]) : NaN;
}

export function computeMetrics(scenario: Scenario, cameraId: CameraId, timeS = 0): CameraMetrics {
  const camera = scenario.cameras.find(config => config.id === cameraId);
  if (!camera) throw new RangeError(`Missing camera: ${cameraId}`);
  const sensor = getSensor(camera.sensorId, scenario.customSensor);
  const sample = sampleState(scenario, timeS);
  const pose = cameraPose(sample, camera);
  const pitchMm = sensor.pixelPitchUm / 1000;
  const groundAt: GroundAtPixel = (u, v) => {
    const ray = rayForPixel(camera, sensor, u, v);
    return ray ? intersectEarth(pose.positionEcefM, rotate(pose.qEcefFromCamera, ray)) : null;
  };

  const u = sensor.width / 2;
  const v = sensor.height / 2;
  const center = groundAt(u, v);
  const radiusPx = usableRadiusMm(camera.lens) / pitchMm;
  const gsdXM = center ? onePixelGsd(groundAt, u, v, 1, 0) : NaN;
  const gsdYM = center ? onePixelGsd(groundAt, u, v, 0, 1) : NaN;
  const toTarget = sub(sample.targetEcefM, pose.positionEcefM);
  const targetRange = length(toTarget);
  const targetRayHit = intersectEarth(pose.positionEcefM, scale(toTarget, 1 / targetRange));
  const targetClear = !targetRayHit || length(sub(targetRayHit, pose.positionEcefM)) >= targetRange - 0.1;
  const targetPixel = targetClear ? projectPoint(camera, sensor, pose, sample.targetEcefM) : null;
  const forward = rotate(pose.qEcefFromCamera, [0, 0, 1]);
  const offNadirCos = -dot(forward, normalize(pose.positionEcefM));
  const projectedEarthCenter = projectPoint(camera, sensor, pose, [0, 0, 0]);

  return {
    horizontalFovDeg: axisFovDeg(camera.lens, sensor.width * pitchMm),
    verticalFovDeg: axisFovDeg(camera.lens, sensor.height * pitchMm),
    gsdXM, gsdYM, gsdM: Math.sqrt(gsdXM * gsdYM),
    footprintWidthM: center ? axisGroundSpan(groundAt, u, v, Math.min(u, radiusPx), 0) : NaN,
    footprintHeightM: center ? axisGroundSpan(groundAt, u, v, 0, Math.min(v, radiusPx)) : NaN,
    apertureMm: camera.lens.focalLengthMm / camera.lens.fNumber,
    airyDiameterPx: 2.44 * WAVELENGTH_UM * camera.lens.fNumber / sensor.pixelPitchUm,
    jitterSigmaPx: camera.jitterArcsec * DEG / 3600 * camera.lens.focalLengthMm / pitchMm,
    smearPx: exposureSmear(scenario, camera, sensor, center, timeS),
    offNadirDeg: Math.acos(clamp(offNadirCos, -1, 1)) / DEG,
    slantRangeM: center ? length(sub(center, pose.positionEcefM)) : NaN,
    groundVisible: Boolean(center || projectedEarthCenter || targetPixel) || partialGroundVisible(groundAt, sensor.width, sensor.height, radiusPx),
    centerGroundVisible: center !== null, targetPixel, targetVisible: targetPixel !== null,
  };
}
