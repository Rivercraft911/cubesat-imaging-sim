import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DownlinkSession } from './session'
import { probeDownlink, type DownlinkSupport } from './codec'
import { DEFAULT_DOWNLINK_CONFIG } from './types'

vi.mock('./codec', () => ({ probeDownlink: vi.fn() }))
const support: DownlinkSupport = { supported: true, streams: [{
  id: 'main', width: 1080, height: 1080, bitrateBps: 4_000_000,
  codecString: 'avc1.640028', encoderConfig: { codec: 'avc1.640028', width: 1080, height: 1080 },
}] }
class FakeEncoder {
  static instances: FakeEncoder[] = []
  state: CodecState = 'unconfigured'
  encodeQueueSize = 0
  requests: boolean[] = []
  constructor(readonly callbacks: VideoEncoderInit) { FakeEncoder.instances.push(this) }
  configure(): void { this.state = 'configured' }
  close(): void { this.state = 'closed' }
  encode(_frame: VideoFrame, options: VideoEncoderEncodeOptions): void { this.requests.push(!!options.keyFrame) }
  emit(type: 'key' | 'delta', timestamp: number, bytes = 100): void {
    this.callbacks.output({ type, timestamp, byteLength: bytes, duration: null, copyTo() {} },
      type === 'key' ? { decoderConfig: { codec: 'avc1.640028' } } : undefined)
  }
}
class FakeDecoder {
  state: CodecState = 'unconfigured'
  decodeQueueSize = 0
  configure(): void { this.state = 'configured' }
  close(): void { this.state = 'closed' }
  decode(): void {}
}
let session: DownlinkSession
const options = { linkBitrateBps: 8_000, propagationMs: 100, maxQueueMs: 10_000 }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  vi.stubGlobal('VideoEncoder', FakeEncoder)
  vi.stubGlobal('VideoDecoder', FakeDecoder)
  FakeEncoder.instances = []
  vi.mocked(probeDownlink).mockResolvedValue(support)
  session = new DownlinkSession({ getFrame: (stream, timestamp) => ({
    timestamp, displayWidth: stream.width, displayHeight: stream.height, close() {},
  }) as VideoFrame, onDecoded() {} })
})
afterEach(() => { session.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('updates a live partial transmission, counts tail loss and requests a key without replacing the codec', async () => {
  await session.start({ ...DEFAULT_DOWNLINK_CONFIG, ...options })
  const encoder = FakeEncoder.instances[0]
  encoder.emit('key', 0)
  encoder.emit('delta', 1)
  encoder.emit('delta', 2)
  await vi.advanceTimersByTimeAsync(150)
  session.setLinkOptions({ ...options, linkBitrateBps: 4_000, maxQueueMs: 100 })
  expect(session.stats).toMatchObject({ channelDrops: 1, queuedBytes: 200, queuedServiceMs: 100 })
  expect(session.stats!.streams[0]).toMatchObject({ queueDrops: 1, waitingForKeyframe: true })
  const requests = encoder.requests.length
  await vi.advanceTimersByTimeAsync(51)
  expect(encoder.requests[requests]).toBe(true)
  expect(FakeEncoder.instances).toHaveLength(1)
  expect(encoder.state).toBe('configured')
  expect(session.stats!.streams[0].chunksDelivered).toBe(1)
  await vi.advanceTimersByTimeAsync(149)
  expect(session.stats!.streams[0].chunksDelivered).toBe(2)
  // Pending delta output after the cut is rejected until a new key arrives.
  encoder.emit('delta', 350_000)
  expect(session.stats!.dependencyDrops).toBe(1)
  session.setLinkOptions({ ...options, linkBitrateBps: 80_000 })
  encoder.emit('key', 350_001)
  await vi.advanceTimersByTimeAsync(110)
  expect(session.stats!.streams[0]).toMatchObject({ chunksDelivered: 3, waitingForKeyframe: false })
})

it('uses the newest transport settings when an asynchronous codec probe finishes', async () => {
  let finish!: (value: DownlinkSupport) => void
  vi.mocked(probeDownlink).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const config = { ...DEFAULT_DOWNLINK_CONFIG, ...options }
  const starting = session.start(config)
  const update = { ...options, linkBitrateBps: 16_000, propagationMs: 20 }
  session.setLinkOptions(update)
  update.linkBitrateBps = 1
  finish(support)
  await starting
  FakeEncoder.instances[0].emit('key', 0)
  expect(session.stats!.queuedServiceMs).toBe(50)
  expect(config.linkBitrateBps).toBe(8_000)
  await vi.advanceTimersByTimeAsync(70)
  expect(session.stats!.streams[0].chunksDelivered).toBe(1)
})

it('reports a failed startup if the initial stats callback throws', async () => {
  session = new DownlinkSession({
    getFrame: () => null,
    onDecoded() {},
    onStats() { throw new Error('Cannot display downlink statistics') },
  })

  await expect(session.start(DEFAULT_DOWNLINK_CONFIG)).resolves.toEqual({
    supported: false, reason: 'Cannot display downlink statistics',
  })
  expect(session.stats).toBeNull()
  expect(FakeEncoder.instances[0].state).toBe('closed')
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects startup if the initial stats callback stops the session', async () => {
  session = new DownlinkSession({
    getFrame: () => null,
    onDecoded() {},
    onStats() { session.stop() },
  })

  await expect(session.start(DEFAULT_DOWNLINK_CONFIG)).rejects.toMatchObject({ name: 'AbortError' })
  expect(session.stats).toBeNull()
  expect(FakeEncoder.instances[0].state).toBe('closed')
  expect(vi.getTimerCount()).toBe(0)
})
