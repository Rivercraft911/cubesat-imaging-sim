import * as THREE from 'three/webgpu';
import { expect, it } from 'vitest';
import { createDefaultScenario } from '../sim';
import { cameraBodyRotation } from '../sim/camera';
import { GuideOcclusion } from './guide-occlusion';
import { disposeObject, makeSpacecraft } from './spacecraft';

it('places the tape dipole behind the body and in the rear camera obstruction model', () => {
  const scenario = createDefaultScenario();
  const ship = makeSpacecraft(scenario);
  const dipole = ship.getObjectByName('Rear tape dipole')!;
  try {
    const camera = scenario.cameras.find(camera => camera.id === 'wideB')!;
    const pupil = new THREE.Vector3(...camera.positionBodyM);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...cameraBodyRotation(camera)));
    const rearNormal = new THREE.Vector3(0, -1, 0);
    const geometry = new GuideOcclusion(ship);
    const rays = ['Rear tape −X', 'Rear tape +X'].map(name => {
      const tape = dipole.getObjectByName(name) as THREE.Mesh;
      expect(tape.layers.isEnabled(0)).toBe(true);
      tape.geometry.computeBoundingBox();
      const root = tape.getWorldPosition(new THREE.Vector3());
      const tip = tape.localToWorld(new THREE.Vector3(tape.geometry.boundingBox!.max.x, 0, 0));
      const arm = tip.sub(root);
      expect(arm.length()).toBeCloseTo(0.1730903, 6);
      expect(arm.angleTo(rearNormal)).toBeCloseTo(Math.PI / 6, 6);
      const point = tape.localToWorld(new THREE.Vector3(0.11, 0, 0));
      expect(point.y).toBeLessThan(-scenario.body.depthM / 2);
      const direction = point.clone().sub(pupil).normalize();
      expect(direction.angleTo(axis)).toBeLessThan(THREE.MathUtils.degToRad(camera.lens.maxFovDeg / 2));
      const [entry] = new THREE.Raycaster(pupil, direction).intersectObject(tape);
      expect(entry).toBeDefined();
      expect(geometry.trace(pupil, direction, camera.id)?.distance).toBeCloseTo(entry.distance, 6);
      return direction;
    });
    ship.remove(dipole);
    const bare = new GuideOcclusion(ship);
    for (const ray of rays) expect(bare.trace(pupil, ray, camera.id)).toBeNull();
  } finally {
    ship.add(dipole);
    disposeObject(ship);
  }
});

it('mirrors the tape solids and presents equal broad faces to a rear observer', () => {
  const ship = makeSpacecraft(createDefaultScenario());
  try {
    const widthAxis = new THREE.Vector3(0, 0, 1);
    const rear = new THREE.Vector3(0, -1, 0);
    const [left, right] = [-1, 1].map(side => {
      const tape = ship.getObjectByName(side < 0 ? 'Rear tape −X' : 'Rear tape +X') as THREE.Mesh;
      const origin = tape.getWorldPosition(new THREE.Vector3());
      const center = tape.localToWorld(new THREE.Vector3(0.11, 0, 0));
      const arm = center.clone().sub(origin).normalize();
      const expected = widthAxis.clone().cross(arm).multiplyScalar(side);
      const positions = tape.geometry.getAttribute('position');
      const vertices = Array.from({ length: positions.count }, (_, i) =>
        tape.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i)));
      const widths = vertices.map(vertex => vertex.z);
      expect(Math.max(...widths) - Math.min(...widths)).toBeCloseTo(0.0055, 6);

      const normals = [1, -1].map((surface, materialIndex) => {
        const direction = expected.clone().multiplyScalar(-surface);
        const probe = center.clone().addScaledVector(direction, -0.01);
        const [hit] = new THREE.Raycaster(probe, direction).intersectObject(tape);
        expect(hit.face!.materialIndex).toBe(materialIndex);
        const normal = hit.face!.normal.clone().transformDirection(tape.matrixWorld);
        expect(normal.dot(direction)).toBeLessThan(-0.99);
        return normal;
      });
      expect(normals[0].x * side).toBeGreaterThan(0.85);
      const inboard = tape.geometry.groups.find(group => group.materialIndex === 1)!;
      const indices = tape.geometry.index!;
      const areaNormal = new THREE.Vector3();
      for (let i = inboard.start; i < inboard.start + inboard.count; i += 3) {
        const a = vertices[indices.getX(i)];
        const b = vertices[indices.getX(i + 1)];
        const c = vertices[indices.getX(i + 2)];
        areaNormal.add(b.clone().sub(a).cross(c.clone().sub(a)));
      }
      const rearExposure = areaNormal.normalize().dot(rear);
      expect(rearExposure).toBeCloseTo(0.5, 6);
      return { vertices, rearExposure };
    });
    expect(left.rearExposure).toBeCloseTo(right.rearExposure, 6);
    for (const vertex of left.vertices) {
      const reflected = new THREE.Vector3(-vertex.x, vertex.y, vertex.z);
      expect(right.vertices.some(candidate => candidate.distanceTo(reflected) < 1e-7)).toBe(true);
    }
  } finally {
    disposeObject(ship);
  }
});
