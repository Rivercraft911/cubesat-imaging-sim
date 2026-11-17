import { expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { createDefaultScenario, sampleState } from '../sim';
import { AtmosphereAdapter } from './atmosphere';
import { createSpaceContext } from './space-context';
import type { CloudLayer } from './cloud-layer';

vi.mock('three/addons/controls/TrackballControls.js', () => ({
  TrackballControls: class {
    target = new THREE.Vector3();
    handleResize() {}
    update() {}
    dispose() {}
  },
}));

it('reuses Space shadows during paused orbit and guide selection, and restores the display after a study', async () => {
  const initialize = vi.spyOn(AtmosphereAdapter.prototype, 'initialize').mockResolvedValue();
  const scenario = createDefaultScenario(), sample = sampleState(scenario);
  const texture = new THREE.Texture();
  const canvas = new EventTarget() as HTMLCanvasElement;
  const space = await createSpaceContext({} as THREE.WebGPURenderer, canvas, scenario, sample,
    texture, texture, texture, texture, texture, { opacity: () => float(0) } as unknown as CloudLayer);
  try {
    const sun = space.shipScene.children.find(object => object instanceof THREE.DirectionalLight)!;
    const guides = space.shipScene.getObjectByName('Camera field of view')!;
    expect(space.updateWorld(scenario, sample)).toBe(false);
    expect(sun.shadow.needsUpdate).toBe(true);
    sun.shadow.needsUpdate = false;
    for (let frame = 0; frame < 60; frame++) {
      space.spaceCamera.position.x += 0.001;
      expect(space.updateWorld(scenario, sample)).toBe(false);
      expect(sun.shadow.needsUpdate).toBe(false);
    }
    space.setSelectedCamera('main');
    expect(guides.userData.occlusion.sampledRays).toBe(512);
    expect(sun.shadow.needsUpdate).toBe(false);
    const study = { ...scenario, body: { ...scenario.body, widthM: scenario.body.widthM * 1.1 } };
    expect(space.updateWorld(study, sample)).toBe(true);
    expect(space.updateWorld(scenario, sample)).toBe(true);
    sun.shadow.needsUpdate = false;
    expect(space.updateWorld(scenario, sampleState(scenario, 1))).toBe(false);
    expect(sun.shadow.needsUpdate).toBe(true);
  } finally {
    space.dispose();
    texture.dispose();
    initialize.mockRestore();
  }
});
