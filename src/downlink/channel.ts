import type { LinkOutage } from './types'

export interface LinkOptions {
  linkBitrateBps: number
  propagationMs: number
  maxQueueMs: number
  outages?: readonly LinkOutage[]
}

export interface LinkDelivery<T> {
  payload: T
  bytes: number
  enqueuedAtMs: number
  finishedAtMs: number
  arrivesAtMs: number
}

export type LinkAdmission<T> =
  | { accepted: true; delivery: LinkDelivery<T> }
  | { accepted: false; reason: 'queue' | 'outage' }

const MAX_BUFFERED_CHUNKS = 256

/** Single FIFO for all streams. Callers supply monotonic time in milliseconds for live runs or deterministic replay. */
export class LinkTimeline<T> {
  readonly #options: LinkOptions
  readonly #outages: readonly LinkOutage[]
  readonly #pending: LinkDelivery<T>[] = []
  #manualOutage = false
  #bufferedBytes = 0

  constructor(options: LinkOptions) {
    if (!Number.isFinite(options.linkBitrateBps) || options.linkBitrateBps <= 0) {
      throw new RangeError('Link rate must be positive and finite.')
    }
    if (!Number.isFinite(options.propagationMs) || options.propagationMs < 0) {
      throw new RangeError('Propagation delay must be nonnegative and finite.')
    }
    if (!Number.isFinite(options.maxQueueMs) || options.maxQueueMs <= 0) {
      throw new RangeError('Queue service limit must be positive and finite.')
    }
    this.#options = { ...options }
    this.#outages = (options.outages ?? [])
      .map(outage => {
        if (!Number.isFinite(outage.startMs) || !Number.isFinite(outage.endMs)
          || outage.startMs < 0 || outage.endMs <= outage.startMs) {
          throw new RangeError('Each outage must have a finite, positive duration and nonnegative start.')
        }
        return { ...outage }
      })
      .sort((a, b) => a.startMs - b.startMs)
  }

  get nextArrivalMs(): number | undefined {
    return this.#pending[0]?.arrivesAtMs
  }

  isOutage(nowMs: number): boolean {
    return this.#manualOutage
      || this.#outages.some(outage => outage.startMs <= nowMs && nowMs < outage.endMs)
  }

  /** Starting a manual outage cuts queued or partly serialized chunks. Already-sent data stays in flight. */
  setOutage(active: boolean, nowMs: number): LinkDelivery<T>[] {
    this.#manualOutage = active
    if (!active) return []

    const firstPending = this.#pending.findIndex(packet => packet.finishedAtMs > nowMs)
    if (firstPending === -1) return []
    const dropped = this.#pending.splice(firstPending)
    for (const packet of dropped) this.#bufferedBytes -= packet.bytes
    return dropped
  }

  enqueue(payload: T, bytes: number, nowMs: number): LinkAdmission<T> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      throw new RangeError('A link chunk must contain a positive integer number of bytes.')
    }
    if (this.isOutage(nowMs)) return { accepted: false, reason: 'outage' }

    const startsAtMs = Math.max(nowMs, this.#pending.at(-1)?.finishedAtMs ?? nowMs)
    const finishedAtMs = startsAtMs + bytes * 8_000 / this.#options.linkBitrateBps
    if (finishedAtMs - nowMs > this.#options.maxQueueMs || this.#pending.length >= MAX_BUFFERED_CHUNKS) {
      return { accepted: false, reason: 'queue' }
    }
    // An uninterrupted service window is required for a complete encoded chunk.
    if (this.#outages.some(outage => outage.startMs < finishedAtMs && startsAtMs < outage.endMs)) {
      return { accepted: false, reason: 'outage' }
    }
    const delivery: LinkDelivery<T> = {
      payload,
      bytes,
      enqueuedAtMs: nowMs,
      finishedAtMs,
      arrivesAtMs: finishedAtMs + this.#options.propagationMs,
    }
    this.#pending.push(delivery)
    this.#bufferedBytes += bytes
    return { accepted: true, delivery }
  }

  drain(nowMs: number): LinkDelivery<T>[] {
    const due: LinkDelivery<T>[] = []
    while (this.#pending.length > 0 && this.#pending[0].arrivesAtMs <= nowMs) {
      const packet = this.#pending.shift()!
      this.#bufferedBytes -= packet.bytes
      due.push(packet)
    }
    return due
  }

  clear(): void {
    this.#pending.length = 0
    this.#bufferedBytes = 0
  }

  backlog(nowMs: number): { bytes: number; ageMs: number; serviceMs: number } {
    const oldest = this.#pending.find(packet => packet.finishedAtMs > nowMs)
    return {
      bytes: this.#bufferedBytes,
      ageMs: oldest ? nowMs - oldest.enqueuedAtMs : 0,
      serviceMs: Math.max(0, (this.#pending.at(-1)?.finishedAtMs ?? nowMs) - nowMs),
    }
  }
}

/** A rejected access unit breaks its stream until a key unit is accepted. */
export class KeyRecovery {
  #waitingForKeyframe = true

  get waitingForKeyframe(): boolean {
    return this.#waitingForKeyframe
  }

  allows(type: 'key' | 'delta'): boolean {
    return !this.waitingForKeyframe || type === 'key'
  }

  accept(type: 'key' | 'delta'): boolean {
    const restart = this.waitingForKeyframe && type === 'key'
    if (restart) this.#waitingForKeyframe = false
    return restart
  }

  lose(): void {
    this.#waitingForKeyframe = true
  }
}
