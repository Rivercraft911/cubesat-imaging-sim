import { add, DEG, dot, normalize, scale } from './math';
import type { Vec3 } from './types';

/** NGA WGS 84, tabulated in Bowditch Vol. 1, Table 203. */
export const EARTH_EQUATORIAL_RADIUS_M = 6_378_137;
export const EARTH_FLATTENING = 1 / 298.257223563;
export const EARTH_POLAR_RADIUS_M = EARTH_EQUATORIAL_RADIUS_M * (1 - EARTH_FLATTENING);
export const EARTH_GM_M3_S2 = 3.986004418e14;
const ECCENTRICITY_SQUARED = EARTH_FLATTENING * (2 - EARTH_FLATTENING);

/** WGS 84 longitude is east-positive. ECEF +X at Greenwich, +Z north. */
export function geodeticToEcef(latitudeDeg: number, longitudeDeg: number, heightM = 0): Vec3 {
  const latitude = latitudeDeg * DEG;
  const longitude = longitudeDeg * DEG;
  const sinLatitude = Math.sin(latitude);
  const primeVerticalM = EARTH_EQUATORIAL_RADIUS_M / Math.sqrt(1 - ECCENTRICITY_SQUARED * sinLatitude ** 2);
  const equatorialM = (primeVerticalM + heightM) * Math.cos(latitude);
  return [
    equatorialM * Math.cos(longitude),
    equatorialM * Math.sin(longitude),
    (primeVerticalM * (1 - ECCENTRICITY_SQUARED) + heightM) * sinLatitude,
  ];
}

export function localUp(latitudeDeg: number, longitudeDeg: number): Vec3 {
  const latitude = latitudeDeg * DEG;
  const longitude = longitudeDeg * DEG;
  return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
}

/** Inverse WGS 84 conversion for surface and exterior positions. */
export function ecefToGeodetic([x, y, z]: Vec3): { latitudeDeg: number; longitudeDeg: number; heightM: number } {
  const p = Math.hypot(x, y);
  const a = EARTH_EQUATORIAL_RADIUS_M;
  const b = EARTH_POLAR_RADIUS_M;
  const longitude = Math.atan2(y, x);
  const theta = Math.atan2(z * a, p * b);
  const secondEccentricitySquared = (a / b) ** 2 - 1;
  let latitude = Math.atan2(
    z + secondEccentricitySquared * b * Math.sin(theta) ** 3,
    p - ECCENTRICITY_SQUARED * a * Math.cos(theta) ** 3,
  );
  const sinLatitude = Math.sin(latitude);
  const primeVerticalM = a / Math.sqrt(1 - ECCENTRICITY_SQUARED * sinLatitude ** 2);
  latitude = Math.atan2(z + ECCENTRICITY_SQUARED * primeVerticalM * sinLatitude, p);
  const heightM = p * Math.cos(latitude) + z * Math.sin(latitude)
    - a * Math.sqrt(1 - ECCENTRICITY_SQUARED * Math.sin(latitude) ** 2);
  return { latitudeDeg: latitude / DEG, longitudeDeg: longitude / DEG, heightM };
}

export function ellipsoidNormal(pointEcefM: Vec3): Vec3 {
  const [x, y, z] = pointEcefM;
  return normalize([x, y, z / (1 - ECCENTRICITY_SQUARED)]);
}

function toUnitSphere([x, y, z]: Vec3): Vec3 {
  return [x / EARTH_EQUATORIAL_RADIUS_M, y / EARTH_EQUATORIAL_RADIUS_M, z / EARTH_POLAR_RADIUS_M];
}

/** Positive-distance intersection with the reference ellipsoid in ECEF meters. */
export function intersectEarth(origin: Vec3, unitDirection: Vec3): Vec3 | null {
  const o = toUnitSphere(origin);
  const d = toUnitSphere(unitDirection);
  const a = dot(d, d);
  const b = dot(o, d);
  const c = dot(o, o) - 1;
  const discriminant = b ** 2 - a * c;
  if (a === 0 || discriminant < 0) return null;

  const q = -b - (b >= 0 ? 1 : -1) * Math.sqrt(discriminant);
  const tA = q / a;
  const tB = q === 0 ? tA : c / q;
  const nearM = Math.min(tA, tB);
  const farM = Math.max(tA, tB);
  const distanceM = nearM > 1e-7 ? nearM : farM;
  return distanceM > 1e-7 ? add(origin, scale(unitDirection, distanceM)) : null;
}
