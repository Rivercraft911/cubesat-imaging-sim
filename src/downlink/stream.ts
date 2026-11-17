import { KeyRecovery } from './channel'
import type { SupportedStream } from './codec'
import type { StreamStats } from './types'

const MAX_ENCODER_REQUESTS = 2
const MAX_ENCODER_IN_FLIGHT = 6
const MAX_DECODER_REQUESTS = 4
const ENCODER_STALL_MS = 2_000
const KEY_RETRY_US = 250_000

export interface StreamPacket {
  stream: DownlinkStream
  chunk: EncodedVideoChunk
  decoderConfig?: VideoDecoderConfig
  restart: boolean
}

type Counters = Pick<StreamStats,
  'framesCaptured' | 'chunksEncoded' | 'chunksDelivered' | 'framesDecoded' | 'encodedBytes'
  | 'deliveredBytes' | 'sourceDrops' | 'queueDrops' | 'outageDrops' | 'dependencyDrops' | 'decoderDrops'>

interface StreamCallbacks {
  send: (packet: StreamPacket, bytes: number) => 'accepted' | 'queue' | 'outage'
  decoded: (frame: VideoFrame) => void
  fatal: (error: Error) => void
}

class RateWindow {
  readonly #samples: { time: number; amount: number }[] = []
  #amount = 0

  add(time: number, amount: number): void {
    this.read(time)
    this.#samples.push({ time, amount })
    this.#amount += amount
  }

  read(time: number): number {
    while (this.#samples.length > 0 && this.#samples[0].time <= time - 1_000) {
      this.#amount -= this.#samples.shift()!.amount
    }
    return this.#amount
  }
}

export class DownlinkStream {
  readonly spec: SupportedStream
  readonly #callbacks: StreamCallbacks
  readonly #encoder: VideoEncoder
  readonly #sender = new KeyRecovery()
  readonly #encoded = new RateWindow()
  readonly #delivered = new RateWindow()
  readonly #decoded = new RateWindow()
  readonly #keyIntervalUs: number
  readonly #encoding = new Set<number>()
  readonly counters: Counters = {
    framesCaptured: 0, chunksEncoded: 0, chunksDelivered: 0, framesDecoded: 0, encodedBytes: 0,
    deliveredBytes: 0, sourceDrops: 0, queueDrops: 0, outageDrops: 0, dependencyDrops: 0, decoderDrops: 0,
  }
  #closed = false
  #lastKeyRequestUs = -Infinity
  #lastDecodedUs = -Infinity
  #outgoingConfig?: VideoDecoderConfig
  #receiverConfig?: VideoDecoderConfig
  #decoder?: VideoDecoder
  #decoderFailures = 0

  constructor(spec: SupportedStream, keyIntervalMs: number, callbacks: StreamCallbacks) {
    this.spec = spec
    this.#callbacks = callbacks
    this.#keyIntervalUs = keyIntervalMs * 1_000
    this.#encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        try {
          this.#onEncoded(chunk, metadata)
        } catch (error) {
          this.#fatal(error)
        }
      },
      error: error => this.#fatal(error),
    })
    try {
      this.#encoder.configure(spec.encoderConfig)
    } catch (error) {
      this.#encoder.close()
      throw error
    }
  }

  canCapture(ptsUs: number): boolean {
    const oldest = this.#encoding.values().next().value
    if (oldest !== undefined && ptsUs - oldest > ENCODER_STALL_MS * 1_000) {
      this.#fatal(new Error('Encoder stopped producing frames.'))
      return false
    }
    return !this.#closed && this.#encoder.encodeQueueSize < MAX_ENCODER_REQUESTS
      && this.#encoding.size < MAX_ENCODER_IN_FLIGHT
  }

  encode(frame: VideoFrame, ptsUs: number): void {
    if (frame.timestamp !== ptsUs || frame.displayWidth !== this.spec.width || frame.displayHeight !== this.spec.height) {
      throw new Error(`${this.spec.id} source returned the wrong dimensions or capture timestamp.`)
    }
    const interval = this.#sender.waitingForKeyframe ? Math.min(this.#keyIntervalUs, KEY_RETRY_US) : this.#keyIntervalUs
    const keyFrame = ptsUs - this.#lastKeyRequestUs >= interval
    if (keyFrame) this.#lastKeyRequestUs = ptsUs
    this.#encoder.encode(frame, { keyFrame })
    this.#encoding.add(ptsUs)
    this.counters.framesCaptured++
  }

  recordOutageLoss(): void {
    this.counters.outageDrops++
    this.#sender.lose()
  }

  requestKeyframe(): void {
    this.#sender.lose()
    this.#lastKeyRequestUs = -Infinity
  }

  receive(packet: StreamPacket, bytes: number, now: number): void {
    if (this.#closed) return
    this.counters.chunksDelivered++
    this.counters.deliveredBytes += bytes
    this.#delivered.add(now, bytes)
    if (packet.decoderConfig) this.#receiverConfig = packet.decoderConfig
    if (packet.restart || (this.#decoder?.decodeQueueSize ?? 0) >= MAX_DECODER_REQUESTS) {
      this.#resetDecoder()
    }
    if (!this.#decoder && packet.chunk.type !== 'key') {
      this.counters.decoderDrops++
      this.#sender.lose()
      return
    }
    try {
      if (!this.#decoder) this.#openDecoder()
      this.#decoder!.decode(packet.chunk)
    } catch (error) {
      this.#decoderError(error)
    }
  }

  snapshot(now: number): StreamStats {
    const { id, width, height, bitrateBps, codecString } = this.spec
    return {
      id, width, height, bitrateBps, codecString,
      ...this.counters,
      encodedBitrateBps: this.#encoded.read(now) * 8,
      deliveredBitrateBps: this.#delivered.read(now) * 8,
      decodedFps: this.#decoded.read(now),
      waitingForKeyframe: this.#sender.waitingForKeyframe || !this.#decoder,
      lastFrameAgeMs: Number.isFinite(this.#lastDecodedUs) ? now - this.#lastDecodedUs / 1_000 : null,
    }
  }

  close(): void {
    this.#closed = true
    if (this.#encoder.state !== 'closed') this.#encoder.close()
    this.#resetDecoder()
    this.#encoding.clear()
  }

  #onEncoded(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    if (this.#closed) return
    for (const ptsUs of this.#encoding) {
      if (ptsUs <= chunk.timestamp) this.#encoding.delete(ptsUs)
    }
    this.counters.chunksEncoded++
    this.counters.encodedBytes += chunk.byteLength
    this.#encoded.add(performance.now(), chunk.byteLength)

    if (metadata?.decoderConfig) {
      this.#outgoingConfig = { ...metadata.decoderConfig, optimizeForLatency: true }
      this.#sender.lose()
    }
    if (!this.#sender.allows(chunk.type)) {
      this.counters.dependencyDrops++
      return
    }
    if (!this.#outgoingConfig) {
      this.#fatal(new Error('Encoder emitted no decoder configuration.'))
      return
    }
    const restart = this.#sender.waitingForKeyframe
    const decoderConfig = restart ? this.#outgoingConfig : undefined
    const bytes = chunk.byteLength + (decoderConfig?.description?.byteLength ?? 0)
    const result = this.#callbacks.send({ stream: this, chunk, decoderConfig, restart }, bytes)
    if (result === 'accepted') {
      this.#sender.accept(chunk.type)
    } else if (result === 'outage') {
      this.recordOutageLoss()
    } else {
      this.counters.queueDrops++
      this.#sender.lose()
    }
  }

  #openDecoder(): void {
    const config = this.#receiverConfig
    if (!config) throw new Error('Receiver has no codec configuration.')
    const decoder = new VideoDecoder({
      output: frame => {
        try {
          if (this.#closed || decoder !== this.#decoder || frame.timestamp <= this.#lastDecodedUs) return
          this.#decoderFailures = 0
          this.#lastDecodedUs = frame.timestamp
          this.counters.framesDecoded++
          this.#decoded.add(performance.now(), 1)
          this.#callbacks.decoded(frame)
        } catch (error) {
          this.#fatal(error)
        } finally {
          frame.close()
        }
      },
      error: error => {
        if (decoder === this.#decoder) this.#decoderError(error)
      },
    })
    this.#decoder = decoder
    decoder.configure(config)
  }

  #resetDecoder(): void {
    if (this.#decoder && this.#decoder.state !== 'closed') this.#decoder.close()
    this.#decoder = undefined
  }

  #decoderError(error: unknown): void {
    this.counters.decoderDrops++
    this.#resetDecoder()
    this.requestKeyframe()
    if (++this.#decoderFailures >= 3) this.#fatal(error)
  }

  #fatal(error: unknown): void {
    if (!this.#closed) {
      const detail = error instanceof Error ? error.message : String(error)
      this.#callbacks.fatal(new Error(`${this.spec.id} downlink: ${detail}`))
    }
  }
}
