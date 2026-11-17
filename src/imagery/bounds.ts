import { cameraPose, ecefToGeodetic, getSensor, intersectEarth, rayForPixel, rotate, sampleState } from '../sim';
import type { Scenario } from '../sim';
import { usableRadiusMm } from '../sim/camera';

export type Bounds = [number, number, number, number];
const R = 6378137;
export function mercator(lon: number, lat: number): [number, number] {
  return [R * lon * Math.PI / 180, R * Math.asinh(Math.tan(Math.max(-85, Math.min(85, lat)) * Math.PI / 180))];
}

/** Bound the actual ray footprint, not a tangent-plane approximation. */
export function shotBounds(scenario: Scenario, timeS = 0): Bounds {
  const camera = scenario.cameras.find(c => c.id === 'main')!;
  const sensor = getSensor(camera.sensorId, scenario.customSensor);
  const pose = cameraPose(sampleState(scenario, timeS), camera);
  const points: [number, number][] = [];
  const addHit = (u: number, v: number) => {
    const ray = rayForPixel(camera, sensor, u, v);
    if (!ray) return;
    const hit = intersectEarth(pose.positionEcefM, rotate(pose.qEcefFromCamera, ray));
    if (!hit) return;
    const p = ecefToGeodetic(hit);
    points.push(mercator(p.longitudeDeg, p.latitudeDeg));
  };
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    addHit(t * sensor.width, 0);
    addHit(t * sensor.width, sensor.height);
    addHit(0, t * sensor.height);
    addHit(sensor.width, t * sensor.height);
  }
  const cx = sensor.width / 2, cy = sensor.height / 2;
  const radius = usableRadiusMm(camera.lens) * 1000 / sensor.pixelPitchUm;
  // The usable image is the intersection of the sensor and the lens circle.
  // When that circle clips the sensor, its arcs are also footprint boundaries.
  if (radius < Math.hypot(cx, cy)) {
    for (let i = 0; i < 64; i++) {
      const theta = i * Math.PI / 32;
      addHit(cx + radius * Math.cos(theta), cy + radius * Math.sin(theta));
    }
    // Include the exact joins between the sensor edges and lens circle.
    if (radius >= cx) {
      const y = Math.sqrt(radius ** 2 - cx ** 2);
      for (const u of [0, sensor.width]) for (const v of [cy - y, cy + y]) addHit(u, v);
    }
    if (radius >= cy) {
      const x = Math.sqrt(radius ** 2 - cy ** 2);
      for (const v of [0, sensor.height]) for (const u of [cx - x, cx + x]) addHit(u, v);
    }
  }
  addHit(cx, cy);
  if (points.length < 3) {
    const [x, y] = mercator(scenario.target.longitudeDeg, scenario.target.latitudeDeg);
    return [x - 50000, y - 35000, x + 50000, y + 35000];
  }
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const b: Bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const dx = Math.max(50, (b[2] - b[0]) * 0.025), dy = Math.max(50, (b[3] - b[1]) * 0.025);
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}

export function contains(outer: Bounds, inner: Bounds): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}
