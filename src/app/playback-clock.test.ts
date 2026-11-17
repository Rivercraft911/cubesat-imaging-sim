import { expect, it } from 'vitest';
import { PASS_END_S, PlaybackClock } from './playback-clock';

it.each([60, 120])('publishes 30 wall-clock samples per second on a %d Hz display', refreshHz => {
  const clock = new PlaybackClock(-300, 1, 0);
  const samples = [];
  for (let frame = 1; frame <= refreshHz; frame++) {
    const time = clock.sample(frame * 1_000 / refreshHz);
    if (time !== null) samples.push(time);
  }
  expect(samples).toHaveLength(30);
  expect(samples.at(-1)).toBe(-299);
});

it('advances by the full visible wall time through a delayed animation frame', () => {
  const clock = new PlaybackClock(-300, 10, 100);
  expect(clock.sample(110)).toBeNull();
  expect(clock.sample(850)).toBe(-292.5);
  expect(clock.sample(851)).toBeNull();
});

it('freezes while hidden and keeps the elapsed time before hiding', () => {
  const clock = new PlaybackClock(0, 2, 100);
  clock.pause(250);
  expect(clock.timeAt(10_000)).toBe(0.3);
  expect(clock.sample(10_000)).toBeNull();
  clock.resume(10_000);
  expect(clock.sample(10_100)).toBe(0.5);
});

it('clamps the last playback sample to the pass endpoint', () => {
  const clock = new PlaybackClock(359.9, 30, 0);
  expect(clock.sample(16)).toBe(PASS_END_S);
});
