import { cameraPose, ecefToGeodetic, getSensor, intersectEarth, rayForPixel, rotate, sampleState } from '../sim';
import type { CameraConfig, Lens, Scenario, SensorProfile, Vec3 } from '../sim';
import { usableRadiusMm } from '../sim/camera';

export type Bounds = [number, number, number, number];
const R = 6378137;
export function mercator(lon: number, lat: number): [number, number] {
  return [R * lon * Math.PI / 180, R * Math.asinh(Math.tan(Math.max(-85, Math.min(85, lat)) * Math.PI / 180))];
}

// Camera-frame samples depend on the lens and sensor, but not the pass time.
let lastFootprint: {
  width: number;
  height: number;
  pixelPitchUm: number;
  focalLengthMm: number;
  projection: Lens['projection'];
  maxFovDeg: number;
  imageCircleMm: number;
  rays: Vec3[];
} | undefined;

function perimeterRays(camera: CameraConfig, sensor: SensorProfile): Vec3[] {
  const { width, height, pixelPitchUm } = sensor;
  const { focalLengthMm, projection, maxFovDeg, imageCircleMm } = camera.lens;
  if (lastFootprint?.width === width && lastFootprint.height === height &&
      lastFootprint.pixelPitchUm === pixelPitchUm && lastFootprint.focalLengthMm === focalLengthMm &&
      lastFootprint.projection === projection && lastFootprint.maxFovDeg === maxFovDeg &&
      lastFootprint.imageCircleMm === imageCircleMm) return lastFootprint.rays;

  const rays: Vec3[] = [];
  const addRay = (u: number, v: number) => {
    const ray = rayForPixel(camera, sensor, u, v);
    if (ray) rays.push(ray);
  };
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    addRay(t * width, 0);
    addRay(t * width, height);
    addRay(0, t * height);
    addRay(width, t * height);
  }
  const cx = width / 2, cy = height / 2;
  const radius = usableRadiusMm(camera.lens) * 1000 / pixelPitchUm;
  // The usable image is the intersection of the sensor and the lens circle.
  // When that circle clips the sensor, its arcs are also footprint boundaries.
  if (radius < Math.hypot(cx, cy)) {
    for (let i = 0; i < 64; i++) {
      const theta = i * Math.PI / 32;
      addRay(cx + radius * Math.cos(theta), cy + radius * Math.sin(theta));
    }
    // Include the exact joins between the sensor edges and lens circle.
    if (radius >= cx) {
      const y = Math.sqrt(radius ** 2 - cx ** 2);
      for (const u of [0, width]) for (const v of [cy - y, cy + y]) addRay(u, v);
    }
    if (radius >= cy) {
      const x = Math.sqrt(radius ** 2 - cy ** 2);
      for (const v of [0, height]) for (const u of [cx - x, cx + x]) addRay(u, v);
    }
  }
  addRay(cx, cy);
  lastFootprint = { width, height, pixelPitchUm, focalLengthMm, projection, maxFovDeg, imageCircleMm, rays };
  return rays;
}

/** Bound the actual ray footprint using intersections with the Earth ellipsoid. */
export function shotBounds(scenario: Scenario, timeS = 0): Bounds {
  const camera = scenario.cameras.find(c => c.id === 'main')!;
  const sensor = getSensor(camera.sensorId, scenario.customSensor);
  const pose = cameraPose(sampleState(scenario, timeS), camera);
  let count = 0;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ray of perimeterRays(camera, sensor)) {
    const hit = intersectEarth(pose.positionEcefM, rotate(pose.qEcefFromCamera, ray));
    if (!hit) continue;
    const { longitudeDeg, latitudeDeg } = ecefToGeodetic(hit);
    west = Math.min(west, longitudeDeg);
    south = Math.min(south, latitudeDeg);
    east = Math.max(east, longitudeDeg);
    north = Math.max(north, latitudeDeg);
    count++;
  }
  if (count < 3) {
    const [x, y] = mercator(scenario.target.longitudeDeg, scenario.target.latitudeDeg);
    return [x - 50000, y - 35000, x + 50000, y + 35000];
  }
  // Mercator x and y are monotone in longitude and latitude, respectively.
  const [xMin, yMin] = mercator(west, south);
  const [xMax, yMax] = mercator(east, north);
  const dx = Math.max(50, (xMax - xMin) * 0.025), dy = Math.max(50, (yMax - yMin) * 0.025);
  return [xMin - dx, yMin - dy, xMax + dx, yMax + dy];
}

export function contains(outer: Bounds, inner: Bounds): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}
