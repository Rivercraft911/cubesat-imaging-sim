import { expect, it } from 'vitest';
import { Ray, Vector3 } from 'three/webgpu';
import { createDefaultScenario } from '../sim/catalog';
import { startWideDrag } from './wide-mount-drag';

const scenario = createDefaultScenario();
const body = { ...scenario.body, widthM: 0.2, heightM: 0.1 };
const front = { ...scenario.cameras[1], positionBodyM: [0.012, 0.061, 0.003] as [number, number, number], housingDiameterMm: 20 };
const faceRay = (x: number, z: number) => new Ray(new Vector3(x, 1, z), new Vector3(0, -1, 0));

it('keeps the grabbed offset, pupil depth and housing clearance', () => {
  const update = startWideDrag('move', 'wideA', front, body, faceRay(0.018, 0.004));
  expect(update(faceRay(0.018, 0.004))?.positionBodyM).toEqual(front.positionBodyM);
  expect(update(faceRay(0.020, 0.004))?.positionBodyM?.[0]).toBeCloseTo(0.014);
  expect(update(faceRay(1, -1))?.positionBodyM).toEqual([0.09, 0.061, -0.04]);
});

it('retains the visible component of movement in an edge-on view', () => {
  const ray = (z: number) => new Ray(new Vector3(1, 0.061, z), new Vector3(-1, 0, 0));
  const update = startWideDrag('move', 'wideA', front, body, ray(0));
  expect(update(ray(0.005))?.positionBodyM).toEqual([0.012, 0.061, 0.008]);
});

it.each([0.5, 2])('gives the same aim sensitivity at %s m with a 50° vertical field of view', range => {
  const rear = { ...front, pitchDeg: 3, yawDeg: 4, rollDeg: 8 };
  const pupil = new Vector3(...rear.positionBodyM);
  const origin = pupil.clone().add(new Vector3(0, -range, 0));
  const start = new Ray(origin, new Vector3(0, 1, 0));
  // A 60 px displacement on either axis in a 1440 × 900 CSS pixel viewport.
  const slope = (2 * 60 / 900) * Math.tan(25 * Math.PI / 180);
  const moved = new Ray(origin, new Vector3(-slope, 1, slope).normalize());
  const update = startWideDrag('aim', 'wideB', rear, body, start);
  const patch = update(moved);
  expect(patch?.yawDeg).toBeCloseTo(4 + 8.895, 2);
  expect(patch?.pitchDeg).toBeCloseTo(3 + 8.895, 2);
  expect(patch).not.toHaveProperty('rollDeg');
});

it('preserves imported offsets on untouched axes and allows yaw beyond 90°', () => {
  const config = { ...front, pitchDeg: 112, yawDeg: 135, positionBodyM: [0.13, 0.06, 0] as [number, number, number] };
  const first = faceRay(0.13, 0);
  const move = startWideDrag('move', 'wideA', config, body, first);
  expect(move(faceRay(0.13, 0.01))?.positionBodyM).toEqual([0.13, 0.06, 0.01]);
  const aim = startWideDrag('aim', 'wideA', config, body, first);
  expect(aim(faceRay(2, 0))).toEqual({ yawDeg: 180, pitchDeg: 112 });
});
