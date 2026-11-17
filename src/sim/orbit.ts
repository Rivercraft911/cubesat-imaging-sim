import { EARTH_EQUATORIAL_RADIUS_M, EARTH_GM_M3_S2, EARTH_POLAR_RADIUS_M, geodeticToEcef, localUp } from './earth';
import { add, axisRotation, basisRotation, clamp, cross, DEG, dot, length, normalize, rotate, rotationZ, scale, sub, TAU, wrap } from './math';
import { DAY_S, daysSinceJ2000, greenwichSiderealRad, MEAN_SUN_RATE_RAD_S, meanSunRaRad, SIDEREAL_RATE_RAD_S, sunDirectionEcef } from './sun';
import type { Quat, Scenario, SimulationSample, Vec3 } from './types';

const J2 = 1.08263e-3;
const EARTH_NORTH: Vec3 = [0, 0, 1];
const Z_FIXED_NODE_RATE = MEAN_SUN_RATE_RAD_S - SIDEREAL_RATE_RAD_S;

interface CircularOrbit {
  radiusM: number;
  meanMotionRadS: number;
  inclinationRad: number;
  ascending: boolean;
}

function stateInOrbit(orbit: CircularOrbit, u: number, nodeLongitude: number) {
  const { radiusM, meanMotionRadS, inclinationRad } = orbit;
  const cI = Math.cos(inclinationRad);
  const sI = Math.sin(inclinationRad);
  const orbitPosition: Vec3 = [Math.cos(u), cI * Math.sin(u), sI * Math.sin(u)];
  const orbitTangent: Vec3 = [-Math.sin(u), cI * Math.cos(u), sI * Math.cos(u)];
  const position = scale(rotationZ(orbitPosition, nodeLongitude), radiusM);
  const velocity = add(
    scale(rotationZ(orbitTangent, nodeLongitude), radiusM * meanMotionRadS),
    scale(cross(EARTH_NORTH, position), Z_FIXED_NODE_RATE),
  );
  return { position, velocity };
}

function orbitAtDirection(orbit: CircularOrbit, direction: Vec3) {
  const crossing = direction[2] / Math.sin(orbit.inclinationRad);
  if (!Number.isFinite(crossing) || Math.abs(crossing) > 1) {
    throw new RangeError('The circular Sun-synchronous orbit cannot cross the selected pass latitude at this altitude.');
  }
  const ascendingU = Math.asin(crossing);
  const argumentAtPass = orbit.ascending ? ascendingU : Math.PI - ascendingU;
  const angleFromNode = Math.atan2(Math.cos(orbit.inclinationRad) * Math.sin(argumentAtPass), Math.cos(argumentAtPass));
  const longitude = Math.atan2(direction[1], direction[0]);
  return { argumentAtPass, nodeLongitudeAtPass: longitude - angleFromNode };
}

function closestPass(orbit: CircularOrbit, targetDirection: Vec3, offsetRad: number) {
  let direction = targetDirection;
  let placement = orbitAtDirection(orbit, direction);
  if (offsetRad === 0) return placement;

  // Along a fixed angular-radius circle around the target, turn the radial
  // offset until it is perpendicular to the ECEF velocity at the pass.
  for (let i = 0; i < 20; i += 1) {
    const { velocity } = stateInOrbit(orbit, placement.argumentAtPass, placement.nodeLongitudeAtPass);
    const trackRight = normalize(cross(velocity, direction));
    const rightAtTarget = normalize(sub(trackRight, scale(targetDirection, dot(trackRight, targetDirection))));
    const next = add(scale(targetDirection, Math.cos(offsetRad)), scale(rightAtTarget, Math.sin(offsetRad)));
    placement = orbitAtDirection(orbit, next);
    if (length(sub(next, direction)) < 1e-12) return placement;
    direction = next;
  }
  throw new RangeError('Closest approach could not be constructed for the selected pass offset.');
}

function subsatelliteGroundSpeed(position: Vec3, velocity: Vec3): number {
  const a = EARTH_EQUATORIAL_RADIUS_M;
  const b = EARTH_POLAR_RADIUS_M;
  const ellipsoidWeightedPosition: Vec3 = [position[0] / a ** 2, position[1] / a ** 2, position[2] / b ** 2];
  const radialFactor = 1 / Math.sqrt(dot(position, ellipsoidWeightedPosition));
  const radialFactorRate = -(radialFactor ** 3) * dot(velocity, ellipsoidWeightedPosition);
  return length(add(scale(velocity, radialFactor), scale(position, radialFactorRate)));
}

function attitude(scenario: Scenario, position: Vec3, target: Vec3, sun: Vec3): Quat {
  let forward = normalize(sub(target, position));
  if (scenario.pointing === 'nadir') forward = normalize(scale(position, -1));
  if (scenario.pointing === 'sun') forward = sun;

  // Image up is the projection of north onto the plane normal to the boresight.
  // Use Greenwich as an arbitrary roll reference for the polar singularity.
  const east = cross(forward, EARTH_NORTH);
  let right = normalize(length(east) > 1e-9 ? east : cross(forward, [1, 0, 0]));
  const up = normalize(cross(right, forward));
  if (scenario.pointing !== 'sun') {
    const tilt = axisRotation(up, -scenario.offNadirDeg * DEG);
    forward = rotate(tilt, forward);
    right = rotate(tilt, right);
  }

  const roll = axisRotation(forward, scenario.rollDeg * DEG);
  return basisRotation(rotate(roll, right), forward, rotate(roll, up));
}

/** Build a circular, target-centered pass on the requested UTC day. */
export function sampleState(scenario: Scenario, timeS = 0): SimulationSample {
  const { latitudeDeg, longitudeDeg, heightM } = scenario.target;
  const targetSurface = geodeticToEcef(latitudeDeg, longitudeDeg);
  const targetEcefM = geodeticToEcef(latitudeDeg, longitudeDeg, heightM);
  const targetRadiusM = length(targetSurface);
  const radiusM = targetRadiusM + scenario.altitudeM;
  const meanMotionRadS = Math.sqrt(EARTH_GM_M3_S2 / radiusM ** 3);

  // First-order J2 nodal precession, NASA GSFC GDC Orbit Primer, p. 4.
  const j2RateFactor = -1.5 * meanMotionRadS * J2 * (EARTH_EQUATORIAL_RADIUS_M / radiusM) ** 2;
  const inclinationRad = Math.acos(MEAN_SUN_RATE_RAD_S / j2RateFactor);
  const orbit = { radiusM, meanMotionRadS, inclinationRad, ascending: scenario.ascending };
  const offsetRad = (scenario.passOffsetKm ?? 0) * 1000 / targetRadiusM;
  const { argumentAtPass, nodeLongitudeAtPass } = closestPass(orbit, normalize(targetEcefM), offsetRad);

  // At the requested pass, node solar hour angle = 15° × (LTAN - 12 h).
  // Its fixed longitude follows from the target longitude and orbit geometry.
  // Solve for that mean solar hour angle once per UTC day.
  const midnightMs = Math.floor(Date.parse(scenario.epochISO) / (DAY_S * 1000)) * DAY_S * 1000;
  const midnightDays = daysSinceJ2000(midnightMs);
  const midnightHourAngle = greenwichSiderealRad(midnightDays) + nodeLongitudeAtPass - meanSunRaRad(midnightDays);
  const desiredHourAngle = (scenario.ltanHours - 12) * 15 * DEG;
  const passS = wrap(desiredHourAngle - midnightHourAngle, TAU) / -Z_FIXED_NODE_RATE;
  const epochMs = midnightMs + (passS + timeS) * 1000;

  const u = argumentAtPass + meanMotionRadS * timeS;
  const nodeLongitude = nodeLongitudeAtPass + Z_FIXED_NODE_RATE * timeS;
  const { position, velocity } = stateInOrbit(orbit, u, nodeLongitude);
  const sun = sunDirectionEcef(daysSinceJ2000(epochMs));
  const upAtTarget = localUp(latitudeDeg, longitudeDeg);
  const targetToSatellite = sub(position, targetEcefM);

  return {
    timeS, positionEcefM: position, velocityEcefMps: velocity,
    qEcefFromBody: attitude(scenario, position, targetEcefM, sun),
    sunDirectionEcef: sun, targetEcefM, inclinationDeg: inclinationRad / DEG,
    sunElevationDeg: Math.asin(clamp(dot(sun, upAtTarget), -1, 1)) / DEG,
    epochISO: new Date(epochMs).toISOString(),
    targetElevationDeg: Math.asin(clamp(dot(normalize(targetToSatellite), upAtTarget), -1, 1)) / DEG,
    targetSlantRangeM: length(targetToSatellite),
    groundSpeedMps: subsatelliteGroundSpeed(position, velocity),
  };
}
