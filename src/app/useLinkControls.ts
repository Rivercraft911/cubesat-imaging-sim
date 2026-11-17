import { useEffect, useState } from 'react';
import { adaptVideo } from '../downlink/adaptive';
import {
  BANDWIDTH_MAX_HZ, BANDWIDTH_MIN_HZ, bandwidthForRate, DEFAULT_RADIO, MODCODS, netRadioRate,
} from '../downlink/radio';
import type { LiveLinkControls } from './LinkStrip';
import type { useDownlink } from './useDownlink';

export function useLinkControls({ config, setConfig }: ReturnType<typeof useDownlink>): LiveLinkControls {
  const [radio, setRadio] = useState(DEFAULT_RADIO);
  const [adaptive, setAdaptive] = useState(true);
  const [quality, setQuality] = useState(config.resolution);
  const throughputBps = netRadioRate(radio);

  useEffect(() => {
    const next = { ...config, linkBitrateBps: throughputBps };
    const video = adaptive ? adaptVideo(next, quality) : { resolution: quality, videoBitrateBps: config.videoBitrateBps };
    if (config.linkBitrateBps !== throughputBps || config.resolution !== video.resolution
      || config.videoBitrateBps !== video.videoBitrateBps) {
      setConfig(current => ({ ...current, linkBitrateBps: throughputBps, ...video }));
    }
  }, [adaptive, config, quality, setConfig, throughputBps]);

  const setBandwidth = (hz: number) => {
    if (Number.isFinite(hz)) setRadio(current => ({
      ...current, bandwidthHz: Math.min(BANDWIDTH_MAX_HZ, Math.max(BANDWIDTH_MIN_HZ, hz)),
    }));
  };

  return {
    bandwidthHz: radio.bandwidthHz, throughputBps, modcod: radio.modcod, modcods: MODCODS,
    minThroughputBps: netRadioRate({ ...radio, bandwidthHz: BANDWIDTH_MIN_HZ }),
    maxThroughputBps: netRadioRate({ ...radio, bandwidthHz: BANDWIDTH_MAX_HZ }),
    adaptive, quality,
    onBandwidthChange: setBandwidth,
    onThroughputChange: bps => {
      if (Number.isFinite(bps) && bps > 0) setBandwidth(bandwidthForRate(bps, radio));
    },
    onModcodChange: id => {
      const mode = MODCODS.find(mode => mode.id === id);
      if (mode) setRadio(current => ({ ...current, modcod: mode.id }));
    },
    onAdaptiveChange: enabled => {
      if (!enabled) setQuality(config.resolution);
      setAdaptive(enabled);
    },
    onQualityChange: setQuality,
  };
}
