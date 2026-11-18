import type { CameraConfig, CameraMetrics, Lens, SensorProfile } from "../sim";
import { usableRadiusMm } from "../sim/camera";

/** The existing native PSF samples Gaussian offsets through ±3σ and shutter
 * offsets through ±(4/9) of its motion length. Add one interpolation pixel. */
export function stitchEdgeFeatherPx(
  camera: CameraConfig,
  metrics: Pick<CameraMetrics, "airyDiameterPx" | "jitterSigmaPx" | "smearPx">,
): number {
  const sigma = Math.min(
    24,
    Math.hypot(
      metrics.airyDiameterPx * 0.179,
      metrics.jitterSigmaPx,
      camera.lens.extraBlurPx,
    ),
  );
  const motion = Number.isFinite(metrics.smearPx)
    ? Math.min(256, metrics.smearPx)
    : 0;
  return 1 + 3 * sigma + (4 / 9) * motion;
}

/** Signed native-pixel distance to the usable lens, sensor, and encoded crop.
 * Kept pure for checking the same boundary arithmetic used in WGSL below. */
export function usableStitchEdgePx(
  sensor: SensorProfile,
  lens: Lens,
  uv: [number, number],
  crop = [0, 0, 1, 1],
): number {
  const pitch = sensor.pixelPitchUm / 1000;
  const theta =
    (Math.min(
      lens.maxFovDeg / 2,
      lens.projection === "rectilinear" ? 89.999 : 180,
    ) *
      Math.PI) /
    180;
  const radiusPx = Math.hypot(
    (uv[0] - 0.5) * sensor.width,
    (uv[1] - 0.5) * sensor.height,
  );
  return Math.min(
    usableRadiusMm(lens, theta) / pitch - radiusPx,
    uv[0] * sensor.width,
    (1 - uv[0]) * sensor.width,
    uv[1] * sensor.height,
    (1 - uv[1]) * sensor.height,
    (uv[0] - crop[0]) * sensor.width,
    (crop[0] + crop[2] - uv[0]) * sensor.width,
    (uv[1] - crop[1]) * sensor.height,
    (crop[1] + crop[3] - uv[1]) * sensor.height,
  );
}
export function edgeConfidence(distancePx: number, featherPx: number): number {
  const t = Math.max(0, Math.min(1, distancePx / featherPx));
  return t * t * (3 - 2 * t);
}

export const stitchCoverageWGSL = /*wgsl*/ `
fn stitchCoverage(projected: vec3f, sensor: vec3f, lens: vec4f, edgeFactor: f32, crop: vec4f, feather: f32) -> vec2f {
 if (projected.z < 0.5) { return vec2f(0.0); }
 var angularRadius = lens.x * tan(lens.z);
 if (lens.y > 0.5 && lens.y < 1.5) { angularRadius = lens.x * lens.z * (1.0 + edgeFactor); }
 if (lens.y > 1.5) { angularRadius = 2.0 * lens.x * sin(lens.z * 0.5); }
 let radiusPx = length((projected.xy - vec2f(0.5)) * sensor.xy);
 let lensEdge = min(lens.w * 0.5, angularRadius) / sensor.z - radiusPx;
 let sensorEdge = min(projected.xy, vec2f(1.0) - projected.xy) * sensor.xy;
 let cropEdge = min(projected.xy - crop.xy, crop.xy + crop.zw - projected.xy) * sensor.xy;
 let edge = min(lensEdge, min(min(sensorEdge.x, sensorEdge.y), min(cropEdge.x, cropEdge.y)));
 // Lens/sensor validity already came from the forward projection. Only the
 // encoded crop can further exclude it; tolerate sub-millipixel roundoff.
 if (min(cropEdge.x, cropEdge.y) < -0.001) { return vec2f(0.0); }
 return vec2f(smoothstep(0.0, max(feather, 0.001), edge), 1.0);
}`;
