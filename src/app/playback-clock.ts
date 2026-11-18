export const PASS_END_S = 360;
const NORMAL_HZ = 30;
const FAST_FORWARD_HZ = 60;

/** Computes playhead time from a monotonic wall-clock anchor and publishes at most one sample per slot. */
export class PlaybackClock {
  #anchorTimeS: number;
  #anchorWallMs: number | null;
  #lastSlot = 0;
  readonly #speed: number;

  constructor(timeS: number, speed: number, wallMs: number) {
    this.#anchorTimeS = timeS;
    this.#anchorWallMs = wallMs;
    this.#speed = speed;
  }

  timeAt(wallMs: number): number {
    const elapsedMs = this.#anchorWallMs === null ? 0 : Math.max(0, wallMs - this.#anchorWallMs);
    return Math.min(PASS_END_S, this.#anchorTimeS + elapsedMs * this.#speed / 1_000);
  }

  sample(wallMs: number): number | null {
    if (this.#anchorWallMs === null) return null;
    const timeS = this.timeAt(wallMs);
    const displayHz = this.#speed > 1 ? FAST_FORWARD_HZ : NORMAL_HZ;
    // rAF timestamps can round either side of an exact refresh boundary.
    const slot = Math.floor((wallMs - this.#anchorWallMs + 0.1) * displayHz / 1_000);
    if (timeS < PASS_END_S && slot <= this.#lastSlot) return null;
    this.#lastSlot = slot;
    return timeS;
  }

  pause(wallMs: number): void {
    this.#anchorTimeS = this.timeAt(wallMs);
    this.#anchorWallMs = null;
  }

  resume(wallMs: number): void {
    this.#anchorWallMs = wallMs;
    this.#lastSlot = 0;
  }
}
