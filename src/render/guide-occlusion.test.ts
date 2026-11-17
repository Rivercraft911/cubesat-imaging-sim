import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { getGuideOcclusion } from './guide-occlusion';

it('tracks translated and tilted blocking triangles in the spacecraft frame', () => {
  const ship = new THREE.Group();
  ship.rotation.x = 0.7;
  const mount = new THREE.Group();
  mount.userData.cameraId = 'wideB';
  mount.position.z = 0.04;
  mount.add(new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.02), new THREE.MeshPhysicalMaterial()));
  ship.add(mount);
  const origin = new THREE.Vector3(), ray = new THREE.Vector3(0, 0, 1);
  const index = getGuideOcclusion(ship);
  expect(index.trace(origin, ray, 'wideA')?.distance).toBeCloseTo(0.04);
  expect(index.trace(origin, ray, 'wideB')).toBeNull();
  mount.position.set(0.07, 0, 0);
  mount.rotation.y = Math.PI / 2;
  expect(getGuideOcclusion(ship)).toBe(index);
  expect(index.trace(origin, ray, 'wideA')).toBeNull();
  const hit = index.trace(origin, ray.set(1, 0, 0), 'wideA')!;
  expect(hit.distance).toBeCloseTo(0.07);
  for (let corner = 0; corner < 3; corner++) {
    expect(index.vertex(hit.triangleId, corner, new THREE.Vector3()).x).toBeCloseTo(0.07);
  }
});
