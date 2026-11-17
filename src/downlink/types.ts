export type VideoCodec = 'h264' | 'h265' | 'av1' | 'vp9'
export type VideoProgram = 'main' | '360' | 'both'
export type StitchArchitecture = 'onboard' | 'ground'
export type StreamId = 'main' | 'panorama' | 'wideA' | 'wideB'
export type DownlinkResolution = 720 | 1080 | 2160

export interface LinkOutage {
  /** Milliseconds from the start of the session. */
  startMs: number
  endMs: number
}

export interface DownlinkConfig {
  program: VideoProgram
  architecture: StitchArchitecture
  codec: VideoCodec
  resolution: DownlinkResolution
  fps: 15 | 30
  videoBitrateBps: number
  linkBitrateBps: number
  keyIntervalMs: number
  propagationMs: number
  maxQueueMs: number
  outages?: readonly LinkOutage[]
}

export const DEFAULT_DOWNLINK_CONFIG: Readonly<DownlinkConfig> = Object.freeze({
  program: 'main',
  architecture: 'onboard',
  codec: 'h264',
  resolution: 1080,
  fps: 15,
  videoBitrateBps: 4_000_000,
  linkBitrateBps: 6_000_000,
  keyIntervalMs: 1_000,
  propagationMs: 10,
  maxQueueMs: 500,
})

export interface StreamSpec {
  id: StreamId
  width: number
  height: number
  bitrateBps: number
}

export function buildStreams(config: DownlinkConfig): StreamSpec[] {
  const height = config.resolution
  const total = config.videoBitrateBps
  const main = config.program === 'both' ? Math.floor(total / 2) : total
  const spherical = config.program === 'both' ? total - main : total
  const streams: StreamSpec[] = []
  if (config.program !== '360') {
    streams.push({ id: 'main', width: Math.round(height * 16 / 9), height, bitrateBps: main })
  }
  if (config.program !== 'main') {
    if (config.architecture === 'onboard') {
      streams.push({ id: 'panorama', width: height * 2, height, bitrateBps: spherical })
    } else {
      const wideA = Math.floor(spherical / 2)
      streams.push(
        { id: 'wideA', width: height, height, bitrateBps: wideA },
        { id: 'wideB', width: height, height, bitrateBps: spherical - wideA },
      )
    }
  }
  return streams
}

export interface StreamStats extends StreamSpec {
  codecString: string
  framesCaptured: number
  chunksEncoded: number
  chunksDelivered: number
  framesDecoded: number
  encodedBytes: number
  deliveredBytes: number
  encodedBitrateBps: number
  deliveredBitrateBps: number
  decodedFps: number
  sourceDrops: number
  queueDrops: number
  outageDrops: number
  dependencyDrops: number
  decoderDrops: number
  waitingForKeyframe: boolean
  lastFrameAgeMs: number | null
}

export interface DownlinkStats {
  elapsedMs: number
  streams: readonly StreamStats[]
  /** Encoded payload rate over the trailing second. */
  encodedBitrateBps: number
  /** Received payload and decoder description rate over the trailing second. */
  deliveredBitrateBps: number
  /** Bytes retained in the modeled link, including propagation. */
  queuedBytes: number
  /** Time since enqueue for the oldest chunk still waiting for or undergoing serialization. */
  queueAgeMs: number
  queuedServiceMs: number
  inOutage: boolean
  sourceDrops: number
  channelDrops: number
  dependencyDrops: number
  decoderDrops: number
}

export interface DownlinkCallbacks {
  /** Return an exact-size frame with the supplied capture timestamp in µs. Ownership transfers. */
  getFrame: (stream: StreamSpec, ptsUs: number) => Promise<VideoFrame | null> | VideoFrame | null
  /** The frame is borrowed until this callback returns. Clone it to retain it. */
  onDecoded: (stream: StreamSpec, frame: VideoFrame) => void
  onStats?: (stats: DownlinkStats) => void
  onError?: (error: Error) => void
}
