import * as THREE from 'three/webgpu';
import { cameraPose, getSensor, rayForPixel, sampleState } from '../sim';
import { usableRadiusMm } from '../sim/camera';
import type { CameraConfig, CameraId, Scenario, SensorProfile } from '../sim';
import { getGuideOcclusion, type GuideOcclusion } from './guide-occlusion';

const GUIDE_LAYER = 1, RAY_LENGTH_M = 0.18, AZIMUTHS = 64, RINGS = 8;
const CLEAR = new THREE.Color(0xb5e5a3), BLOCKED = new THREE.Color(0xff493b);
type DynamicObject = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
type MountGuide = { mount: THREE.Group; surface: DynamicObject; lines: DynamicObject; sides: DynamicObject };
type GuideState = { mounts: MountGuide[]; blockers: DynamicObject; key: string; ship?: THREE.Group };
const states = new WeakMap<THREE.Group, GuideState>();

/** Sensor rectangle intersected with the image circle and angular limit. */
function boundaryRay(camera: CameraConfig, sensor: SensorProfile, azimuth: number, fraction = 1) {
  const pitchMm = sensor.pixelPitchUm / 1000;
  const x = Math.cos(azimuth), y = Math.sin(azimuth);
  const radius = Math.min(usableRadiusMm(camera.lens),
    sensor.width * pitchMm / (2 * Math.max(Math.abs(x), 1e-12)),
    sensor.height * pitchMm / (2 * Math.max(Math.abs(y), 1e-12))) * fraction;
  const u = THREE.MathUtils.clamp(sensor.width / 2 + radius * x / pitchMm, 0, sensor.width);
  const v = THREE.MathUtils.clamp(sensor.height / 2 + radius * y / pitchMm, 0, sensor.height);
  const ray = rayForPixel(camera, sensor, u, v);
  return ray ? new THREE.Vector3(...ray) : new THREE.Vector3(0, 0, 1);
}

function dynamicObject(vertices: number, lines = false, opacity = 0.055): DynamicObject {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'color']) geometry.setAttribute(name,
    new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const object = lines ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity, depthWrite: false, toneMapped: false,
  })) : new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity, side: THREE.DoubleSide,
    depthWrite: false, toneMapped: false, forceSinglePass: true,
  }));
  object.layers.set(GUIDE_LAYER);
  return object;
}

function writeVertex(object: DynamicObject, index: number, point: THREE.Vector3, color: THREE.Color) {
  object.geometry.getAttribute('position').setXYZ(index, point.x, point.y, point.z);
  object.geometry.getAttribute('color').setXYZ(index, color.r, color.g, color.b);
}
function finish(object: DynamicObject, count: number) {
  object.geometry.setDrawRange(0, count);
  object.geometry.getAttribute('position').needsUpdate = true;
  object.geometry.getAttribute('color').needsUpdate = true;
  // Unused trailing vertices stay at zero; these bounds safely overestimate.
  object.geometry.computeBoundingSphere();
  object.geometry.computeBoundingBox();
}
function makeMount(group: THREE.Group): MountGuide {
  const mount = new THREE.Group();
  mount.layers.set(GUIDE_LAYER);
  const surface = dynamicObject(AZIMUTHS * RINGS * 6);
  const lines = dynamicObject((AZIMUTHS + 8 * RINGS + 4) * 2, true, 0.45);
  const sides = dynamicObject(AZIMUTHS * 3, false, 0.055);
  mount.add(surface, sides, lines);
  group.add(mount);
  return { mount, surface, lines, sides };
}
function disposeObjects(group: THREE.Group) {
  group.traverse(object => {
    if (!(object instanceof THREE.LineSegments) && !(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
  group.clear();
}

function updateMount(guide: MountGuide, camera: CameraConfig, sensor: SensorProfile,
  occlusion: GuideOcclusion | undefined, triangles: Set<number>) {
  const corners = [Math.atan2(sensor.height, sensor.width), Math.atan2(sensor.height, -sensor.width),
    Math.atan2(-sensor.height, -sensor.width) + Math.PI * 2, Math.atan2(-sensor.height, sensor.width) + Math.PI * 2];
  const azimuths = [...corners, ...Array.from({ length: AZIMUTHS - 4 }, (_, i) => i * Math.PI * 2 / (AZIMUTHS - 4))]
    .sort((a, b) => a - b);
  const rectangular = camera.lens.projection === 'rectilinear';
  const axialExtent = RAY_LENGTH_M * Math.max(1e-6,
    Math.min(...azimuths.map(angle => boundaryRay(camera, sensor, angle).z)));
  const endpoint = (ray: THREE.Vector3) => ray.clone().multiplyScalar(rectangular ? axialExtent / Math.max(ray.z, 1e-6) : RAY_LENGTH_M);
  // Concentrate samples near the angular boundary: a uniform eight-ring grid
  // would never sample the backward 90–95° rim of a 190° fisheye.
  const radialFraction = (ring: number) => rectangular ? ring / RINGS : 1 - (1 - ring / RINGS) ** 2;
  const points = azimuths.map(angle => Array.from({ length: RINGS + 1 }, (_, ring) =>
    endpoint(boundaryRay(camera, sensor, angle, radialFraction(ring)))));
  const centerRay = new THREE.Vector3();
  let vertices = 0, blocked = 0;
  for (let azimuth = 0; azimuth < AZIMUTHS; azimuth++) {
    const next = (azimuth + 1) % AZIMUTHS;
    const nextAngle = next ? azimuths[next] : azimuths[0] + Math.PI * 2;
    for (let ring = 0; ring < RINGS; ring++) {
      centerRay.copy(boundaryRay(camera, sensor, (azimuths[azimuth] + nextAngle) / 2, radialFraction(ring + 0.5)))
        .applyQuaternion(guide.mount.quaternion);
      const hit = occlusion?.trace(guide.mount.position, centerRay, camera.id);
      if (hit) { blocked++; triangles.add(hit.triangleId); }
      const color = hit ? BLOCKED : CLEAR;
      for (const point of [points[azimuth][ring], points[azimuth][ring + 1], points[next][ring + 1],
        points[azimuth][ring], points[next][ring + 1], points[next][ring]]) {
        writeVertex(guide.surface, vertices++, point, color);
      }
    }
  }
  finish(guide.surface, vertices);
  let lines = 0, sides = 0;
  const origin = new THREE.Vector3();
  for (let i = 0; i < AZIMUTHS; i++) {
    const a = points[i][RINGS], b = points[(i + 1) % AZIMUTHS][RINGS];
    writeVertex(guide.lines, lines++, a, CLEAR); writeVertex(guide.lines, lines++, b, CLEAR);
    if (rectangular) for (const point of [origin, a, b]) writeVertex(guide.sides, sides++, point, CLEAR);
  }
  for (const azimuth of corners) {
    writeVertex(guide.lines, lines++, origin, CLEAR);
    writeVertex(guide.lines, lines++, endpoint(boundaryRay(camera, sensor, azimuth)), CLEAR);
  }
  if (!rectangular) for (let meridian = 0; meridian < 8; meridian++) {
    for (let ring = 0; ring < RINGS; ring++) {
      for (const fraction of [radialFraction(ring), radialFraction(ring + 1)]) {
        writeVertex(guide.lines, lines++, endpoint(boundaryRay(camera, sensor, meridian * Math.PI / 4, fraction)), CLEAR);
      }
    }
  }
  finish(guide.lines, lines); finish(guide.sides, sides);
  return blocked;
}

/** Update positions/colors in place during focal-length dragging. Obstruction
 * samples 64×8 angular cells per camera, so very small obstructions can be missed.
 * Red CAD triangles are actual nearest ray hits, not mechanical intersections. */
export function updateCameraGuides(group: THREE.Group, scenario: Scenario, selectedId: CameraId | null, ship?: THREE.Group) {
  const started = performance.now();
  const cameras = selectedId ? scenario.cameras.filter(camera => selectedId === 'main' ? camera.id === 'main' : camera.id !== 'main') : [];
  const key = JSON.stringify([scenario.customSensor, cameras.map(camera => [camera.id, camera.sensorId, camera.lens,
    camera.positionBodyM, camera.yawDeg, camera.pitchDeg, camera.rollDeg])]);
  let state = states.get(group);
  if (state?.key === key && state.ship === ship) return;
  if (!state || state.mounts.length !== cameras.length) {
    disposeObjects(group);
    const blockers = dynamicObject(AZIMUTHS * RINGS * 2 * 3, false, 0.65);
    const material = blockers.material as THREE.MeshBasicMaterial;
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -2;
    group.add(blockers);
    state = { mounts: cameras.map(() => makeMount(group)), blockers, key, ship };
    states.set(group, state);
  }
  state.key = key; state.ship = ship;
  const beforeIndex = performance.now();
  const occlusion = cameras.length && ship ? getGuideOcclusion(ship) : undefined;
  const indexMs = performance.now() - beforeIndex;
  const sample = sampleState(scenario);
  const inverseBody = new THREE.Quaternion(...sample.qEcefFromBody).invert();
  const hitTriangles = new Set<number>();
  let blockedRays = 0;
  cameras.forEach((camera, i) => {
    const guide = state!.mounts[i];
    guide.mount.position.fromArray(camera.positionBodyM);
    guide.mount.quaternion.copy(inverseBody).multiply(new THREE.Quaternion(...cameraPose(sample, camera).qEcefFromCamera));
    guide.mount.name = `${camera.id} angular coverage`;
    blockedRays += updateMount(guide, camera, getSensor(camera.sensorId, scenario.customSensor), occlusion, hitTriangles);
  });
  let vertices = 0;
  const point = new THREE.Vector3();
  for (const id of hitTriangles) {
    const p = occlusion!.triangles[id].p;
    for (let i = 0; i < 9; i += 3) writeVertex(state.blockers, vertices++, point.fromArray(p, i), BLOCKED);
  }
  finish(state.blockers, vertices);
  group.userData.occlusion = { sampledRays: occlusion ? cameras.length * AZIMUTHS * RINGS : 0,
    blockedRays, highlightedTriangles: hitTriangles.size, meshTriangles: occlusion?.triangles.length ?? 0,
    accelerationBuildMs: indexMs, updateMs: performance.now() - started };
}

/** Body-frame editor geometry. Every descendant is layer 1, excluded from
 * native sensor/cube captures. Apply qEcefFromBody to this root. */
export function createCameraGuides(scenario: Scenario, selectedId: CameraId | null, ship?: THREE.Group): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Camera field of view'; group.layers.set(GUIDE_LAYER);
  updateCameraGuides(group, scenario, selectedId, ship);
  return group;
}
export function disposeCameraGuides(group: THREE.Group) { disposeObjects(group); states.delete(group); }
