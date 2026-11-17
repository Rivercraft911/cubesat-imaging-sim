import { expect, it } from 'vitest';
import { buildStreams, DEFAULT_DOWNLINK_CONFIG } from './types';
import { adaptVideo, ladderRate } from './adaptive';
import { bandwidthForRate, DEFAULT_RADIO, MODCODS, netRadioRate } from './radio';

it('uses framed spectral efficiency and independently accounts for occupied bandwidth and application reserve', () => {
  expect(netRadioRate(DEFAULT_RADIO)).toBeCloseTo(5_933_148, 6);
  expect(netRadioRate({ ...DEFAULT_RADIO, rollOff: 0, applicationReserve: 0 })).toBeCloseTo(7_910_864, 6);
  for (const mode of MODCODS) {
    const radio = { ...DEFAULT_RADIO, modcod: mode.id };
    expect(netRadioRate({ ...radio, bandwidthHz: bandwidthForRate(2_000_000, radio) })).toBeCloseTo(2_000_000, 6);
  }
  expect(() => netRadioRate({ ...DEFAULT_RADIO, applicationReserve: 1 })).toThrow();
});

it('steps from full configured height through 144p as capacity is reduced, retaining the exact shared budget', () => {
  const config = { ...DEFAULT_DOWNLINK_CONFIG, mainAspectRatio: 1 };
  expect(adaptVideo({ ...config, linkBitrateBps: 50_000_000 }, 2160).resolution).toBe(2160);
  expect(adaptVideo({ ...config, linkBitrateBps: 50_000_000 }, 720).resolution).toBe(720);
  expect(adaptVideo({ ...config, linkBitrateBps: 50_000 }, 2160)).toEqual({ resolution: 144, videoBitrateBps: 40_000 });
  const rates = [50_000, 200_000, 500_000, 2_000_000, 6_000_000, 50_000_000];
  const heights = rates.map(linkBitrateBps => adaptVideo({ ...config, linkBitrateBps }, 2160).resolution);
  expect(heights).toEqual([...heights].sort((a, b) => a - b));
});

it('skips a 2160p frame larger than the encoder limit even when capacity fits the target', () => {
  const config = { ...DEFAULT_DOWNLINK_CONFIG, mainAspectRatio: 4, linkBitrateBps: 50_000_000 };
  const chosen = adaptVideo(config, 2160);
  expect(chosen).toEqual({ resolution: 1440, videoBitrateBps: 40_000_000 });
  expect(buildStreams({ ...config, ...chosen })[0]).toMatchObject({ width: 5760, height: 1440 });
});

it('does not give a multistream program the single-stream resolution budget', () => {
  const config = { ...DEFAULT_DOWNLINK_CONFIG, mainAspectRatio: 1 };
  expect(ladderRate({ ...config, program: '360', architecture: 'onboard' }, 1080))
    .toBeCloseTo(ladderRate({ ...config, program: '360', architecture: 'ground' }, 1080), 6);
  const solo = adaptVideo(config, 2160);
  const both = adaptVideo({ ...config, program: 'both', architecture: 'ground' }, 2160);
  expect(both.resolution).toBeLessThan(solo.resolution);
});
