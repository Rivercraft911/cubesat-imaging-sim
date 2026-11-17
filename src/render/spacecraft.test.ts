import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createDefaultScenario } from '../sim';
import { makeSpacecraft, disposeObject } from './spacecraft';

it('uses one mip-filtered cell surface on all five fixed array faces', () => {
  const ship = makeSpacecraft(createDefaultScenario());
  ship.updateMatrixWorld(true);
  try {
    const rays = [
      [[1, 0, 0.022], [-1, 0, 0]], [[-1, 0, 0.022], [1, 0, 0]],
      [[0, 0.022, 1], [0, 0, -1]], [[0, 0.022, -1], [0, 0, 1]],
      [[0, -1, 0], [0, 1, 0]],
    ];
    const maps = rays.map(([origin, direction]) => {
      const ray = new THREE.Raycaster(new THREE.Vector3().fromArray(origin), new THREE.Vector3().fromArray(direction));
      const hit = ray.intersectObject(ship)[0];
      const material = (hit.object as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
      return material.map;
    });
    expect(new Set(maps).size).toBe(1);
    expect(maps[0]?.generateMipmaps).toBe(true);
    expect(maps[0]?.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  } finally {
    disposeObject(ship);
  }
});
