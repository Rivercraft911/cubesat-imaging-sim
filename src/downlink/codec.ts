import { codecCandidates } from './codec-levels'
import { buildStreams, type DownlinkConfig, type StreamSpec } from './types'

export interface SupportedStream extends StreamSpec {
  codecString: string
  encoderConfig: VideoEncoderConfig
}

export type DownlinkSupport =
  | { supported: true; streams: readonly SupportedStream[] }
  | { supported: false; reason: string }

const PROBE_TIMEOUT_MS = 5_000
const MAX_ENCODE_DIMENSION = 8_192
const MAX_ENCODE_PIXELS = 16_777_216

/** Bound the GPU capture/readback and I420 probe frame before querying a codec. */
export function downlinkFrameSizeError({ id, width, height }: Pick<StreamSpec, 'id' | 'width' | 'height'>): string | undefined {
  if (![width, height].every(value => Number.isInteger(value) && value >= 2 && value % 2 === 0)) {
    return `${id} encode dimensions must be positive even pixel counts.`
  }
  if (width > MAX_ENCODE_DIMENSION || height > MAX_ENCODE_DIMENSION || width * height > MAX_ENCODE_PIXELS) {
    return `${id} ${width} × ${height} exceeds the downlink limit of 8,192 px per side or 16,777,216 px per frame. Select a lower encode height or a different sensor aspect ratio.`
  }
}

function describe(spec: SupportedStream): string {
  return `${spec.id} ${spec.width}×${spec.height} ${spec.codecString}`
}

function configFor(stream: StreamSpec, codecString: string, fps: number): SupportedStream {
  return {
    ...stream,
    codecString,
    encoderConfig: {
      codec: codecString,
      width: stream.width,
      height: stream.height,
      bitrate: stream.bitrateBps,
      framerate: fps,
      bitrateMode: 'variable',
      latencyMode: 'realtime',
    },
  }
}

function probeFrame(spec: StreamSpec): VideoFrame {
  const pixels = spec.width * spec.height
  const data = new Uint8Array(pixels * 3 / 2).fill(128)
  data.fill(40, 0, pixels / 2)
  data.fill(180, pixels / 2, pixels)
  return new VideoFrame(data, {
    format: 'I420',
    codedWidth: spec.width,
    codedHeight: spec.height,
    timestamp: 0,
  })
}

interface Probe {
  encoder?: VideoEncoder
  decoder?: VideoDecoder
  chunks: EncodedVideoChunk[]
  decoderConfig?: VideoDecoderConfig
  error?: Error
  decoded: boolean
}

async function withDeadline<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal?.reason ?? new DOMException('Probe cancelled', 'AbortError'))
    timeout = setTimeout(() => reject(new Error('WebCodecs round trip timed out.')), PROBE_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
  try {
    return await Promise.race([operation, cancelled])
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

async function roundTrip(
  streams: readonly SupportedStream[],
  probes: readonly Probe[],
  signal: AbortSignal,
): Promise<void> {
  const support = await Promise.all(streams.map(stream => VideoEncoder.isConfigSupported(stream.encoderConfig)))
  signal.throwIfAborted()
  const unsupported = support.findIndex(result => !result.supported)
  if (unsupported >= 0) throw new Error(`${describe(streams[unsupported])} encoder is unavailable.`)

  for (const [i, stream] of streams.entries()) {
    const probe = probes[i]
    probe.encoder = new VideoEncoder({
      output(chunk, metadata) {
        if (metadata?.decoderConfig) probe.decoderConfig = metadata.decoderConfig
        probe.chunks.push(chunk)
      },
      error(error) { probe.error = error },
    })
    probe.encoder.configure(stream.encoderConfig)
  }

  await Promise.all(streams.map(async (stream, i) => {
    const probe = probes[i]
    const frame = probeFrame(stream)
    try {
      probe.encoder!.encode(frame, { keyFrame: true })
    } finally {
      frame.close()
    }
    try {
      await probe.encoder!.flush()
    } catch (error) {
      throw new Error(`${describe(stream)} encode failed: ${(probe.error ?? error as Error).message}`)
    }
    if (!probe.decoderConfig || probe.chunks[0]?.type !== 'key') {
      throw new Error(`${describe(stream)} emitted no key chunk with decoder configuration.`)
    }
    probe.decoderConfig = { ...probe.decoderConfig, optimizeForLatency: true }
    const support = await VideoDecoder.isConfigSupported(probe.decoderConfig)
    if (!support.supported) throw new Error(`${describe(stream)} emitted an unsupported decoder configuration.`)
  }))
  signal.throwIfAborted()

  for (const [i, stream] of streams.entries()) {
    const probe = probes[i]
    probe.decoder = new VideoDecoder({
      output(frame) {
        probe.decoded ||= frame.timestamp === 0
          && frame.displayWidth === stream.width && frame.displayHeight === stream.height
        frame.close()
      },
      error(error) { probe.error = error },
    })
    probe.decoder.configure(probe.decoderConfig!)
    for (const chunk of probe.chunks) probe.decoder.decode(chunk)
  }
  await Promise.all(streams.map(async (stream, i) => {
    const probe = probes[i]
    try {
      await probe.decoder!.flush()
    } catch (error) {
      throw new Error(`${describe(stream)} decode failed: ${(probe.error ?? error as Error).message}`)
    }
    if (!probe.decoded) throw new Error(`${describe(stream)} produced no decoded frame at the requested dimensions.`)
  }))
}

/** Tests the exact requested program, including concurrently open encoder and decoder contexts. */
export async function probeDownlink(config: DownlinkConfig, signal?: AbortSignal): Promise<DownlinkSupport> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return { supported: false, reason: 'WebCodecs video encoding and decoding require a supported browser and secure context.' }
  }
  if (config.fps !== 15 && config.fps !== 30) {
    return { supported: false, reason: 'Downlink frame rate must be 15 or 30 fps.' }
  }
  if (config.resolution !== 720 && config.resolution !== 1080 && config.resolution !== 2160) {
    return { supported: false, reason: 'Select a 720p, 1080p or 2160p downlink preset.' }
  }
  const mainAspect = config.mainAspectRatio
  if (config.program !== '360' && mainAspect !== undefined && (!Number.isFinite(mainAspect) || mainAspect <= 0)) {
    return { supported: false, reason: 'The main sensor aspect ratio must be positive and finite.' }
  }
  const specs = buildStreams(config)
  for (const stream of specs) {
    const reason = downlinkFrameSizeError(stream)
    if (reason) return { supported: false, reason }
  }
  if (!specs.every(stream => Number.isSafeInteger(stream.bitrateBps) && stream.bitrateBps > 0)) {
    return { supported: false, reason: 'Encoder targets must be positive integer bit rates for every selected stream.' }
  }
  const candidates = specs.map(stream => codecCandidates(config.codec, stream, config.fps))
  const unmatched = candidates.findIndex(options => !options.some(Boolean))
  if (unmatched >= 0) {
    const { id, width, height, bitrateBps } = specs[unmatched]
    return { supported: false, reason: `No modeled ${config.codec.toUpperCase()} level fits ${id} ${width} × ${height} at ${config.fps} fps and ${bitrateBps / 1_000_000} Mb/s. Reduce the size, frame rate, or bitrate.` }
  }
  const tried = new Set<string>()
  const reasons: string[] = []
  for (let variant = 0; variant < candidates[0].length; variant++) {
    signal?.throwIfAborted()
    const codecs = candidates.map(options => options[variant])
    if (codecs.some(codec => codec === undefined)) continue
    const key = codecs.join(',')
    if (tried.has(key)) continue
    tried.add(key)
    const streams = specs.map((stream, i) => configFor(stream, codecs[i]!, config.fps))
    const probes: Probe[] = streams.map(() => ({ chunks: [], decoded: false }))
    const attempt = new AbortController()
    try {
      await withDeadline(roundTrip(streams, probes, attempt.signal), signal)
      signal?.throwIfAborted()
      return { supported: true, streams }
    } catch (error) {
      signal?.throwIfAborted()
      reasons.push(error instanceof Error ? error.message : String(error))
    } finally {
      attempt.abort()
      for (const probe of probes) {
        if (probe.encoder && probe.encoder.state !== 'closed') probe.encoder.close()
        if (probe.decoder && probe.decoder.state !== 'closed') probe.decoder.close()
      }
    }
  }
  return { supported: false, reason: reasons.join(' ') }
}
