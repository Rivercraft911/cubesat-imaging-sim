import * as THREE from 'three/webgpu';
import { expect, it } from 'vitest';
import { createDefaultScenario, getSensor } from '../sim';
import { makeSpacecraft, disposeObject } from './spacecraft';
import { createHardwareVisibility } from './hardware-visibility';

it('skips a clear native main-camera cone and retains wide or undersampled views', () => {
  const scenario = createDefaultScenario(), ship = makeSpacecraft(scenario);
  const main = scenario.cameras[0], sensor = getSensor(main.sensorId);
  const visible = createHardwareVisibility(1024, 0.0001);
  try {
    ship.quaternion.setFromEuler(new THREE.Euler(0.3, 0.5, 1.3));
    for (const focalLengthMm of [25, 100, 200]) {
      expect(visible(ship, { ...main, lens: { ...main.lens, focalLengthMm } }, sensor, 0)).toBe(false);
    }
    expect(visible(ship, scenario.cameras[1], sensor, 0)).toBe(true);
    expect(visible(ship, main, { ...sensor, pixelPitchUm: 200 }, 0)).toBe(true);
    expect(visible(ship, { ...main, positionBodyM: [0, 0, 0] }, sensor, 1)).toBe(true);
  } finally {
    disposeObject(ship);
  }
});

it('retains crossing triangles, grazing cubemap filter support, and changed mounts', () => {
  const scenario = createDefaultScenario(), main = { ...scenario.cameras[0], positionBodyM: [0, 0, 0] as [number, number, number] };
  const sensor = getSensor(main.sensorId), ship = new THREE.Group();
  const visible = createHardwareVisibility(1024, 0.0001);
  // Main looks along body +Y. This triangle spans the pupil's view, although
  // every one of its three vertices lies outside the rectangular sensor.
  const geometry = new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute([-0.7, 1, 0.7, 0.7, 1, 0.7, 0, 1, -0.7], 3));
  const triangle = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  ship.add(triangle);
  try {
    expect(visible(ship, main, sensor, 0)).toBe(true);
    triangle.position.x = 2;
    expect(visible(ship, main, sensor, 1)).toBe(false);
    const slope = sensor.width * sensor.pixelPitchUm * 0.001 / (2 * main.lens.focalLengthMm);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(
      [slope + 0.001, 1, 0, slope + 0.001, 1, 0.03, slope + 0.009, 1, 0], 3));
    triangle.position.x = 0;
    expect(visible(ship, main, sensor, 2)).toBe(true);
  } finally {
    disposeObject(ship);
  }
});
