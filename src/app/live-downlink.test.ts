import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DOWNLINK_CONFIG as initial } from '../downlink/types';
import { EncoderChanges, LiveCaptureClock } from './live-downlink';

describe('live encoder settings', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the final encoder preset after a burst and does not defer the restart for transport edits', () => {
    const settings = new EncoderChanges(initial);
    const restart = vi.fn();
    settings.request({ ...initial, resolution: 360 }, initial, restart);
    vi.advanceTimersByTime(100);
    const final = { ...initial, resolution: 480 as const };
    settings.request(final, initial, restart);
    vi.advanceTimersByTime(200);
    expect(restart).not.toHaveBeenCalled();
    settings.request({ ...final, linkBitrateBps: 320_000, propagationMs: 23, maxQueueMs: 400 }, initial, restart);
    vi.advanceTimersByTime(50);
    expect(restart).toHaveBeenCalledExactlyOnceWith(final);
  });

  it('cancels pending work when the preset returns to the running encoder or the link stops', () => {
    const settings = new EncoderChanges(initial);
    const restart = vi.fn();
    const next = { ...initial, fps: 30 as const };
    expect(settings.request(next, initial, restart)).toBe('scheduled');
    expect(settings.request(initial, initial, restart)).toBe('current');
    vi.runAllTimers();
    expect(settings.request(next, initial, restart)).toBe('scheduled');
    settings.cancel();
    vi.runAllTimers();
    expect(restart).not.toHaveBeenCalled();
  });
});

describe('live capture time', () => {
  it('advances across an encoder restart and gives parallel streams the same pass time', () => {
    const clock = new LiveCaptureClock(-12);
    expect(clock.capture(4_000_000)).toEqual({ captureUs: -12_000_000, advanced: true });
    expect(clock.capture(4_000_000)).toEqual({ captureUs: -12_000_000, advanced: false });
    expect(clock.capture(4_750_000)).toEqual({ captureUs: -11_250_000, advanced: true });
    expect(clock.capture(4_700_000)).toEqual({ captureUs: -11_250_000, advanced: false });
  });

  it('bounds capture at the end of the pass', () => {
    const clock = new LiveCaptureClock(359.5);
    clock.capture(1_000_000);
    expect(clock.capture(2_000_000).captureUs).toBe(360_000_000);
  });
});
