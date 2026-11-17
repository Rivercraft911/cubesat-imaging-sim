import { buildStreams, type DownlinkConfig, type StreamSpec, type VideoCodec } from './types'

export interface SupportedStream extends StreamSpec {
  codecString: string
  encoderConfig: VideoEncoderConfig
}

export type DownlinkSupport =
  | { supported: true; streams: readonly SupportedStream[] }
  | { supported: false; reason: string }

const PROBE_TIMEOUT_MS = 5_000

// ITU-T H.264 (08/2024), Table A-1. These levels cover the supported presets and frame rates.
function avcLevel({ width, height }: StreamSpec, fps: number): string {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  const rate = blocks * fps
  if (blocks <= 8_192 && rate <= 245_760) return '28'
  if (blocks <= 22_080 && rate <= 589_824) return '32'
  return rate <= 983_040 ? '33' : '34'
}

// H.265 Table A.1 and WebM VP9 levels share these frame-size breakpoints.
function pixelLevel({ width, height }: StreamSpec, level4Size = 2_228_224): number {
  const pixels = width * height
  if (pixels <= level4Size) return 4
  return pixels <= 8_912_896 ? 5 : 6
}

// Profile and tier are explicit. The presets satisfy the selected levels' frame-rate limits.
const PROFILES: Record<VideoCodec, readonly ((stream: StreamSpec, fps: number) => string)[]> = {
  h264: [
    (stream, fps) => `avc1.6400${avcLevel(stream, fps)}`,
    (stream, fps) => `avc1.42e0${avcLevel(stream, fps)}`,
  ],
  h265: [
    stream => `hvc1.1.6.L${pixelLevel(stream) * 30}.B0`,
    stream => `hev1.1.6.L${pixelLevel(stream) * 30}.B0`,
  ],
  av1: [stream => `av01.0.${String((pixelLevel(stream, 2_359_296) - 2) * 4).padStart(2, '0')}M.08`],
  vp9: [stream => `vp09.00.${pixelLevel(stream) * 10}.08`],
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
  const specs = buildStreams(config)
  if (!specs.every(stream => Number.isSafeInteger(stream.bitrateBps) && stream.bitrateBps > 0)) {
    return { supported: false, reason: 'Encoder targets must be positive integer bit rates for every selected stream.' }
  }
  const reasons: string[] = []
  for (const profile of PROFILES[config.codec]) {
    signal?.throwIfAborted()
    const streams = specs.map(stream => configFor(stream, profile(stream, config.fps), config.fps))
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
