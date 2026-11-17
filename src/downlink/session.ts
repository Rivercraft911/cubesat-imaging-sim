import { LinkTimeline } from './channel'
import { probeDownlink, type DownlinkSupport, type SupportedStream } from './codec'
import { DownlinkStream, type StreamPacket } from './stream'
import type { DownlinkCallbacks, DownlinkConfig, DownlinkStats, StreamSpec } from './types'

const STATS_INTERVAL_MS = 250
type Timer = ReturnType<typeof setTimeout>

class ActiveDownlink {
  readonly #clockStart = performance.now()
  readonly #link: LinkTimeline<StreamPacket>
  readonly #streams: DownlinkStream[] = []
  readonly #frameIntervalMs: number
  readonly #callbacks: DownlinkCallbacks
  #active = true
  #lastOutage = false
  #nextIndex = 0
  #captureTimer?: Timer
  #deliveryTimer?: Timer
  #statsTimer?: Timer

  constructor(config: DownlinkConfig, specs: readonly SupportedStream[], callbacks: DownlinkCallbacks) {
    this.#frameIntervalMs = 1_000 / config.fps
    this.#link = new LinkTimeline(config)
    this.#callbacks = callbacks
    try {
      for (const spec of specs) {
        this.#streams.push(new DownlinkStream(spec, config.keyIntervalMs, {
          send: (packet, bytes) => this.#send(packet, bytes),
          decoded: frame => callbacks.onDecoded(spec, frame),
          fatal: error => this.#fatal(error),
        }))
      }
    } catch (error) {
      this.close()
      throw error
    }
  }

  start(outage: boolean): void {
    this.setOutage(outage)
    this.#scheduleCapture()
    this.#publishStats()
  }

  setOutage(active: boolean): void {
    if (!this.#active) return
    const now = performance.now()
    for (const packet of this.#link.setOutage(active, this.#relative(now))) {
      packet.payload.stream.recordOutageLoss()
    }
    this.#trackOutage(now)
    this.#scheduleDelivery()
  }

  snapshot(): DownlinkStats {
    const now = performance.now()
    const elapsedMs = this.#relative(now)
    const streams = this.#streams.map(stream => stream.snapshot(now))
    const backlog = this.#link.backlog(elapsedMs)
    return {
      elapsedMs,
      streams,
      encodedBitrateBps: streams.reduce((sum, stream) => sum + stream.encodedBitrateBps, 0),
      deliveredBitrateBps: streams.reduce((sum, stream) => sum + stream.deliveredBitrateBps, 0),
      queuedBytes: backlog.bytes,
      queueAgeMs: backlog.ageMs,
      queuedServiceMs: backlog.serviceMs,
      inOutage: this.#link.isOutage(elapsedMs),
      sourceDrops: streams.reduce((sum, stream) => sum + stream.sourceDrops, 0),
      channelDrops: streams.reduce((sum, stream) => sum + stream.queueDrops + stream.outageDrops, 0),
      dependencyDrops: streams.reduce((sum, stream) => sum + stream.dependencyDrops, 0),
      decoderDrops: streams.reduce((sum, stream) => sum + stream.decoderDrops, 0),
    }
  }

  close(): void {
    this.#active = false
    clearTimeout(this.#captureTimer)
    clearTimeout(this.#deliveryTimer)
    clearTimeout(this.#statsTimer)
    this.#link.clear()
    for (const stream of this.#streams) stream.close()
  }

  #relative(now = performance.now()): number {
    return now - this.#clockStart
  }

  #trackOutage(now: number): void {
    const outage = this.#link.isOutage(this.#relative(now))
    if (this.#lastOutage && !outage) {
      for (const stream of this.#streams) stream.requestKeyframe()
    }
    this.#lastOutage = outage
  }

  #scheduleCapture(): void {
    if (!this.#active) return
    const wait = Math.max(0, this.#nextIndex * this.#frameIntervalMs - this.#relative())
    this.#captureTimer = setTimeout(() => void this.#capture(), wait)
  }

  async #capture(): Promise<void> {
    if (!this.#active) return
    const now = performance.now()
    const dueIndex = Math.floor(this.#relative(now) / this.#frameIntervalMs)
    if (dueIndex < this.#nextIndex) {
      this.#scheduleCapture()
      return
    }
    const missed = dueIndex - this.#nextIndex
    this.#nextIndex = dueIndex + 1
    this.#trackOutage(now)
    const ptsUs = Math.round(now * 1_000)
    try {
      for (const stream of this.#streams) {
        if (!this.#active) return
        stream.counters.sourceDrops += missed
        if (!stream.canCapture(ptsUs)) {
          stream.counters.sourceDrops++
          continue
        }
        const frame = await this.#callbacks.getFrame(stream.spec, ptsUs)
        if (frame) {
          try {
            if (this.#active) stream.encode(frame, ptsUs)
          } finally {
            frame.close()
          }
        } else if (this.#active) {
          stream.counters.sourceDrops++
        }
      }
    } catch (error) {
      this.#fatal(error)
    } finally {
      this.#scheduleCapture()
    }
  }

  #send(packet: StreamPacket, bytes: number): 'accepted' | 'queue' | 'outage' {
    const now = performance.now()
    this.#receiveDue(now)
    if (!this.#active) return 'outage'
    const result = this.#link.enqueue(packet, bytes, this.#relative(now))
    this.#scheduleDelivery()
    return result.accepted ? 'accepted' : result.reason
  }

  #receiveDue(now: number): void {
    for (const packet of this.#link.drain(this.#relative(now))) {
      if (!this.#active) return
      packet.payload.stream.receive(packet.payload, packet.bytes, now)
    }
  }

  #scheduleDelivery(): void {
    clearTimeout(this.#deliveryTimer)
    const next = this.#link.nextArrivalMs
    if (!this.#active || next === undefined) return
    this.#deliveryTimer = setTimeout(() => {
      this.#receiveDue(performance.now())
      this.#scheduleDelivery()
    }, Math.max(0, next - this.#relative()))
  }

  #publishStats(): void {
    if (!this.#active) return
    this.#trackOutage(performance.now())
    try {
      this.#callbacks.onStats?.(this.snapshot())
    } catch (error) {
      this.#fatal(error)
    }
    if (this.#active) this.#statsTimer = setTimeout(() => this.#publishStats(), STATS_INTERVAL_MS)
  }

  #fatal(error: unknown): void {
    if (!this.#active) return
    this.close()
    this.#callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
  }
}

export class DownlinkSession {
  readonly #callbacks: DownlinkCallbacks
  #active?: ActiveDownlink
  #probe?: AbortController
  #manualOutage = false
  #capturePending = false

  constructor(callbacks: DownlinkCallbacks) {
    this.#callbacks = callbacks
  }

  get stats(): DownlinkStats | null {
    return this.#active?.snapshot() ?? null
  }

  async start(config: DownlinkConfig): Promise<DownlinkSupport> {
    this.stop()
    const probe = new AbortController()
    this.#probe = probe
    const settings = { ...config, outages: config.outages?.map(outage => ({ ...outage })) }
    try {
      if (!Number.isFinite(settings.keyIntervalMs) || settings.keyIntervalMs <= 0) {
        throw new RangeError('Keyframe interval must be positive and finite.')
      }
      const support = await probeDownlink(settings, probe.signal)
      probe.signal.throwIfAborted()
      if (!support.supported) return support
      const run = new ActiveDownlink(settings, support.streams, {
        ...this.#callbacks,
        getFrame: (stream, ptsUs) => this.#getFrame(stream, ptsUs),
        onError: error => {
          if (this.#active !== run) return
          this.#active = undefined
          this.#callbacks.onError?.(error)
        },
      })
      this.#active = run
      run.start(this.#manualOutage)
      return support
    } catch (error) {
      probe.signal.throwIfAborted()
      this.#active?.close()
      this.#active = undefined
      return { supported: false, reason: error instanceof Error ? error.message : String(error) }
    } finally {
      if (this.#probe === probe) this.#probe = undefined
    }
  }

  update(config: DownlinkConfig): Promise<DownlinkSupport> {
    return this.start(config)
  }

  setOutage(active: boolean): void {
    this.#manualOutage = active
    this.#active?.setOutage(active)
  }

  stop(): void {
    this.#probe?.abort()
    this.#probe = undefined
    this.#active?.close()
    this.#active = undefined
  }

  async #getFrame(stream: StreamSpec, ptsUs: number): Promise<VideoFrame | null> {
    if (this.#capturePending) return null
    this.#capturePending = true
    try {
      return await this.#callbacks.getFrame(stream, ptsUs)
    } finally {
      this.#capturePending = false
    }
  }
}
