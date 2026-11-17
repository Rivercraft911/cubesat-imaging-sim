import type { DownlinkConfig, LinkOutage } from '../downlink/types';
import { PASS_END_S } from './playback-clock';

export function linkOptions({ linkBitrateBps, propagationMs, maxQueueMs }: DownlinkConfig) {
  return { linkBitrateBps, propagationMs, maxQueueMs };
}

function sameOutages(left: readonly LinkOutage[] = [], right: readonly LinkOutage[] = []): boolean {
  return left === right || left.length === right.length && left.every(({ startMs, endMs }, i) => (
    startMs === right[i].startMs && endMs === right[i].endMs
  ));
}

export function sameSessionSettings(left: DownlinkConfig, right: DownlinkConfig): boolean {
  return left.program === right.program
    && left.architecture === right.architecture
    && left.codec === right.codec
    && left.resolution === right.resolution
    && left.mainAspectRatio === right.mainAspectRatio
    && left.fps === right.fps
    && left.videoBitrateBps === right.videoBitrateBps
    && left.keyIntervalMs === right.keyIntervalMs
    && sameOutages(left.outages, right.outages);
}

export class EncoderChanges {
  #requested: DownlinkConfig;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(initial: DownlinkConfig) {
    this.#requested = initial;
  }

  request(next: DownlinkConfig, current: DownlinkConfig | undefined, restart: (config: DownlinkConfig) => void) {
    if (sameSessionSettings(next, this.#requested)) return 'unchanged';
    this.#requested = next;
    this.cancel();
    if (current && sameSessionSettings(next, current)) return 'current';
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      restart(next);
    }, 250);
    return 'scheduled';
  }

  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

/** Session PTS values share the same monotonic time origin across encoder restarts. */
export class LiveCaptureClock {
  readonly #startUs: number;
  #firstPtsUs?: number;
  #lastPtsUs?: number;

  constructor(startS: number) {
    this.#startUs = Math.round(startS * 1_000_000);
  }

  capture(ptsUs: number): { captureUs: number; advanced: boolean } {
    this.#firstPtsUs ??= ptsUs;
    const advanced = this.#lastPtsUs === undefined || ptsUs > this.#lastPtsUs;
    if (advanced) this.#lastPtsUs = ptsUs;
    return {
      captureUs: Math.min(PASS_END_S * 1_000_000, this.#startUs + this.#lastPtsUs! - this.#firstPtsUs),
      advanced,
    };
  }
}
