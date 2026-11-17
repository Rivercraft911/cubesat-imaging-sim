import { localUp } from './earth';
import { add, axisRotation, basisRotation, clamp, cross, DEG, dot, length, normalize, rotate, scale, sub } from './math';
import type { Quat, Scenario, Vec3 } from './types';

const EARTH_NORTH: Vec3 = [0, 0, 1];
const HORIZON_REFERENCE_RAD = 0.1 * DEG;

function northReferencedAxes(forward: Vec3, north: Vec3) {
  const right = normalize(cross(forward, north));
  return { right, up: normalize(cross(right, forward)) };
}

/** Target-local geographic north is image-up. Near the north/south horizon,
 * that projected direction vanishes. Continue the roll using a sightline just
 * above the horizon, then rotate its entire basis onto the actual boresight.
 * This changes spacecraft attitude, never the main camera's fixed mount. */
export function targetTrackingAxes(forward: Vec3, latitudeDeg: number, longitudeDeg: number) {
  const vertical = localUp(latitudeDeg, longitudeDeg);
  const latitude = latitudeDeg * DEG;
  const longitude = longitudeDeg * DEG;
  const north: Vec3 = [-Math.sin(latitude) * Math.cos(longitude), -Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude)];
  const verticalComponent = dot(forward, vertical);
  const horizontal = sub(forward, scale(vertical, verticalComponent));
  const horizontalLength = length(horizontal);
  const elevation = Math.atan2(-verticalComponent, horizontalLength);
  if (elevation >= 2 * HORIZON_REFERENCE_RAD) return northReferencedAxes(forward, north);

  // A C1 transition makes the roll reference stop at 0.1° elevation. Below
  // the horizon it continues the same azimuth/vertical-plane rotation; an
  // occulted target remains occulted. North-up is undefined at grazing north.
  const blend = clamp((elevation - HORIZON_REFERENCE_RAD) / HORIZON_REFERENCE_RAD, 0, 1);
  const referenceElevation = HORIZON_REFERENCE_RAD * (1 + blend * blend * (2 - blend));
  // On the far-side vertical axis azimuth itself is undefined. A deterministic
  // north meridian is sufficient there: the entire target is Earth-occluded.
  const azimuth = horizontalLength > 1e-12 ? scale(horizontal, 1 / horizontalLength) : north;
  const referenceForward = add(scale(azimuth, Math.cos(referenceElevation)), scale(vertical, -Math.sin(referenceElevation)));
  const reference = northReferencedAxes(referenceForward, north);
  const continuation = axisRotation(normalize(cross(vertical, azimuth)), elevation - referenceElevation);
  return { right: rotate(continuation, reference.right), up: rotate(continuation, reference.up) };
}

/** Prescribed kinematic attitude; no attitude-control dynamics or rate limits. */
export function spacecraftAttitude(scenario: Scenario, position: Vec3, target: Vec3, sun: Vec3): Quat {
  let forward = normalize(sub(target, position));
  if (scenario.pointing === 'nadir') forward = normalize(scale(position, -1));
  if (scenario.pointing === 'sun') forward = sun;

  let axes;
  if (scenario.pointing === 'target') {
    axes = targetTrackingAxes(forward, scenario.target.latitudeDeg, scenario.target.longitudeDeg);
  } else {
    // Nadir uses local geographic north; Sun pointing uses celestial north.
    // Greenwich supplies a deterministic reference at the polar singularity.
    const reference = length(cross(forward, EARTH_NORTH)) > 1e-9 ? EARTH_NORTH : [1, 0, 0] as Vec3;
    axes = northReferencedAxes(forward, reference);
  }
  let { right } = axes;
  const { up } = axes;
  if (scenario.pointing !== 'sun') {
    const tilt = axisRotation(up, -scenario.offNadirDeg * DEG);
    forward = rotate(tilt, forward);
    right = rotate(tilt, right);
  }

  const roll = axisRotation(forward, scenario.rollDeg * DEG);
  return basisRotation(rotate(roll, right), forward, rotate(roll, up));
}
