import { downlinkFrameSizeError } from './codec';
import { buildStreams, DOWNLINK_RESOLUTIONS, type DownlinkConfig, type DownlinkResolution, type VideoCodec } from './types';

// Transparent policy targets, not measured encoder quality or guarantees.
// A motion/complexity-aware rate controller can replace this independent ladder.
const BITS_PER_PIXEL_FRAME: Record<VideoCodec, number> = { h264: 0.12, h265: 0.08, av1: 0.08, vp9: 0.1 };

export function ladderRate(config: DownlinkConfig, resolution: DownlinkResolution): number {
  const streams = buildStreams({ ...config, resolution, videoBitrateBps: 1_000_000 });
  if (streams.some(stream => downlinkFrameSizeError(stream))) return Infinity;
  // Each selected stream must fit its own assigned fraction of the shared rate.
  return Math.max(...streams.map(stream => stream.width * stream.height * config.fps
    * BITS_PER_PIXEL_FRAME[config.codec] / (stream.bitrateBps / 1_000_000)));
}

export function adaptVideo(config: DownlinkConfig, ceiling: DownlinkResolution) {
  // Leave room for VBR bursts. The existing queue still models actual encoded
  // bytes; it can drop frames even when an average target is below capacity.
  const videoBitrateBps = Math.max(1_000, Math.min(50_000_000, Math.floor(config.linkBitrateBps * 0.8)));
  const candidates = DOWNLINK_RESOLUTIONS.filter(height => height <= ceiling).reverse();
  const resolution = candidates.find(height => ladderRate(config, height) <= videoBitrateBps) ?? DOWNLINK_RESOLUTIONS[0];
  return { resolution, videoBitrateBps };
}
