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

export type MutableLinkOptions = Pick<LinkOptions, 'linkBitrateBps' | 'propagationMs' | 'maxQueueMs'>
export interface LinkLoss<T> {
  delivery: LinkDelivery<T>
  reason: 'queue' | 'outage'
}

interface ScheduledDelivery<T> extends LinkDelivery<T> {
  /** Remaining bits at startsAtMs, rebased whenever the capacity changes. */
  remainingBits: number
  startsAtMs: number
}

export function validateLinkOptions(options: MutableLinkOptions): void {
  if (!Number.isFinite(options.linkBitrateBps) || options.linkBitrateBps <= 0)
    throw new RangeError('Link rate must be positive and finite.')
  if (!Number.isFinite(options.propagationMs) || options.propagationMs < 0)
    throw new RangeError('Propagation delay must be nonnegative and finite.')
  if (!Number.isFinite(options.maxQueueMs) || options.maxQueueMs <= 0)
    throw new RangeError('Queue service limit must be positive and finite.')
}

const MAX_BUFFERED_CHUNKS = 256

/** Single FIFO for all streams. Callers supply monotonic time in milliseconds for live runs or deterministic replay. */
export class LinkTimeline<T> {
  #options: MutableLinkOptions
  readonly #outages: readonly LinkOutage[]
  readonly #pending: ScheduledDelivery<T>[] = []
  #manualOutage = false
  #bufferedBytes = 0

  constructor(options: LinkOptions) {
    validateLinkOptions(options)
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

  /** Capacity changes apply only to unsent bits. Propagating access units retain
   * their original timing. Delivery remains ordered if propagation is reduced.
   * Tail-drop keeps every retained stream's decoder dependency prefix intact. */
  setOptions(options: MutableLinkOptions, nowMs: number): LinkLoss<T>[] {
    validateLinkOptions(options)
    if (!Number.isFinite(nowMs) || nowMs < 0)
      throw new RangeError('Link update time must be nonnegative and finite.')
    const previousRate = this.#options.linkBitrateBps
    let finish = nowMs, arrival = nowMs
    let dropReason: LinkLoss<T>['reason'] | undefined
    const dropped: LinkLoss<T>[] = []
    let retained = 0
    for (const packet of this.#pending) {
      if (packet.finishedAtMs <= nowMs) {
        arrival = Math.max(arrival, packet.arrivesAtMs)
        this.#pending[retained++] = packet
        continue
      }
      // This calculation happens before rebasing, so rapid rate changes never
      // serialize a previously sent bit a second time.
      const remaining = Math.max(0, packet.remainingBits
        - Math.max(0, nowMs - packet.startsAtMs) * previousRate / 1_000)
      const nextFinish = finish + remaining * 1_000 / options.linkBitrateBps
      if (!dropReason) {
        if (this.isOutage(nowMs) || this.#outages.some(outage =>
          outage.startMs < nextFinish && finish < outage.endMs)) dropReason = 'outage'
        else if (nextFinish - nowMs > options.maxQueueMs) dropReason = 'queue'
      }
      if (dropReason) {
        dropped.push({ delivery: packet, reason: dropReason })
        this.#bufferedBytes -= packet.bytes
        continue
      }
      packet.remainingBits = remaining
      packet.startsAtMs = finish
      packet.finishedAtMs = nextFinish
      packet.arrivesAtMs = Math.max(arrival, nextFinish + options.propagationMs)
      finish = nextFinish
      arrival = packet.arrivesAtMs
      this.#pending[retained++] = packet
    }
    this.#pending.length = retained
    this.#options = { ...options }
    return dropped
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
    const delivery: ScheduledDelivery<T> = {
      startsAtMs,
      remainingBits: bytes * 8,
      payload,
      bytes,
      enqueuedAtMs: nowMs,
      finishedAtMs,
      arrivesAtMs: Math.max(finishedAtMs + this.#options.propagationMs,
        this.#pending.at(-1)?.arrivesAtMs ?? nowMs),
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
