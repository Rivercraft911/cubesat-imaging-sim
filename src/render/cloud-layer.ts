import { NoColorSpace, type Node, type Texture } from 'three/webgpu';
import { Fn, mix, texture, vec2, vec3, vec4, wgslFn } from 'three/tsl';

export const CLOUD_ALTITUDE_M = 8_000;
export const CLOUD_EQUATORIAL_RADIUS_M = 6_378_137 + CLOUD_ALTITUDE_M;
export const CLOUD_POLAR_RADIUS_M = 6_356_752.314245179 + CLOUD_ALTITUDE_M;
export const CLOUD_REGION_BOUNDS_DEG = [-131.25, 23, -114, 52] as const;

/** A single ellipsoidal layer, not measured cloud heights or a volume model.
 * Axes are WGS84 semiaxes + 8 km. Rays and returned ECEF points use meters.
 * Misses retain a projected closest point on the shell for continuous UVs;
 * w=0 alone marks the miss. This prevents unrelated sky UVs corrupting the
 * implicit texture derivatives of adjacent fragments along the cloud limb. */
export const cloudIntersectionWGSL = /* wgsl */ `
fn cloudShellHit(originM: vec3f, ray: vec3f) -> vec4f {
  let equatorialM = 6386137.0;
  let radii = vec3f(1.0, 1.0, 6364752.314245179 / equatorialM);
  let origin = originM / equatorialM / radii;
  let direction = ray / radii;
  let a = dot(direction, direction);
  let b = dot(origin, direction);
  let c = dot(origin, origin) - 1.0;
  let discriminant = b * b - a * c;
  let closest = origin + direction * max(0.0, -b / a);
  let missPoint = normalize(closest) * radii * equatorialM;
  if (discriminant < 0.0) { return vec4f(missPoint, 0.0); }
  let root = sqrt(max(0.0, discriminant));
  let q = -b - select(-root, root, b >= 0.0);
  if (abs(q) < 1e-12) { return vec4f(missPoint, 0.0); }
  let first = q / a;
  let second = c / q;
  let near = min(first, second);
  let far = max(first, second);
  let distanceM = select(far, near, near > 0.0) * equatorialM;
  if (distanceM <= 0.0) { return vec4f(missPoint, 0.0); }
  return vec4f(originM + ray * distanceM, distanceM);
}`;

// Bowring's geodetic latitude keeps the cloud mask registered to the same
// geographic imagery bounds at altitude; geocentric latitude would drift.
const cloudCoordinatesWGSL = /* wgsl */ `
fn cloudGeographicUV(pointM: vec3f) -> vec2f {
  let equatorialM = 6378137.0;
  let polarM = 6356752.314245179;
  let e2 = 0.0066943799901413165;
  let ep2 = 0.006739496742276434;
  let horizontalM = length(pointM.xy);
  let theta = atan2(pointM.z * equatorialM, horizontalM * polarM);
  let sine = sin(theta);
  let cosine = cos(theta);
  let latitude = atan2(pointM.z + ep2 * polarM * sine * sine * sine,
    horizontalM - e2 * equatorialM * cosine * cosine * cosine);
  let longitude = atan2(pointM.y, pointM.x);
  return vec2f(longitude / 6.28318530718 + 0.5, latitude / 3.14159265359 + 0.5);
}`;

const cloudHit = wgslFn(cloudIntersectionWGSL);
const cloudUV = wgslFn(cloudCoordinatesWGSL);
type DirectionNode = Node<'vec3'>;

/** Static NASA 2001 cloud imagery is a display-opacity proxy, not a forecast
 * or calibrated optical depth. Both assets have the documented display toe
 * applied to native source texels before reduction/mip generation. Applying
 * that nonlinear transfer after sampling would change coverage with mip level.
 * Retain north-up TextureLoader orientation, like the other Earth maps. */
export function createCloudLayer(globalMap: Texture, regionalMap: Texture) {
  globalMap.colorSpace = NoColorSpace;
  regionalMap.colorSpace = NoColorSpace;
  const globalNode = texture(globalMap);
  const regionalNode = texture(regionalMap);
  const southwest = vec2(CLOUD_REGION_BOUNDS_DEG[0], CLOUD_REGION_BOUNDS_DEG[1]);
  const northeast = vec2(CLOUD_REGION_BOUNDS_DEG[2], CLOUD_REGION_BOUNDS_DEG[3]);

  const opacity = (pointECEF: DirectionNode) => Fn(() => {
    const coords = vec2(cloudUV(pointECEF) as ReturnType<typeof vec2>);
    const geographic = coords.mul(vec2(360, 180)).sub(vec2(180, 90));
    const regionalUV = geographic.sub(southwest).div(northeast.sub(southwest));
    const edge = geographic.sub(southwest).min(northeast.sub(geographic));
    const feather = edge.x.min(edge.y).smoothstep(0, 0.25);
    const regionalOpacity = regionalNode.sample(regionalUV).r;
    return mix(globalNode.sample(coords).r, regionalOpacity, feather).clamp(0, 1);
  })();

  const normal = (pointECEF: DirectionNode) => vec3(pointECEF).mul(vec3(
    1, 1, (CLOUD_EQUATORIAL_RADIUS_M / CLOUD_POLAR_RADIUS_M) ** 2,
  )).normalize();

  return {
    opacity,
    normal,
    /** Nearest positive cloud-shell intersection, vec4(ECEF meters, distance meters).
     * A miss has w=0 and a shell proxy in xyz. Compare distance with a ground
     * hit before compositing; sample xyz unconditionally for stable mipmaps. */
    intersect: (originECEF: DirectionNode, unitRay: DirectionNode) =>
      vec4(cloudHit(originECEF, unitRay) as ReturnType<typeof vec4>),
    /** Direct Lambert cosine only; caller supplies atmospheric attenuation,
     * diffuse sky light and display exposure. Never applies an arbitrary night floor. */
    sunlight: (pointECEF: DirectionNode, unitSun: DirectionNode) => normal(pointECEF).dot(unitSun).max(0),
  };
}

export type CloudLayer = ReturnType<typeof createCloudLayer>;
