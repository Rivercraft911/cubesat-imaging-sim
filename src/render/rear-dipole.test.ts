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
