import { cameraPose, ecefToGeodetic, getSensor, intersectEarth, rayForPixel, rotate, sampleState } from '../sim';
import type { Scenario } from '../sim';

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
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    for (const [u, v] of [[t * sensor.width, 0], [t * sensor.width, sensor.height], [0, t * sensor.height], [sensor.width, t * sensor.height]]) {
      const ray = rayForPixel(camera, sensor, u, v);
      if (!ray) continue;
      const hit = intersectEarth(pose.positionEcefM, rotate(pose.qEcefFromCamera, ray));
      if (!hit) continue;
      const p = ecefToGeodetic(hit);
      points.push(mercator(p.longitudeDeg, p.latitudeDeg));
    }
  }
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
