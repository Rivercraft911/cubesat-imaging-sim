import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DownlinkStream } from './stream'

class FakeEncoder {
  state: CodecState = 'unconfigured'
  configure(): void { this.state = 'configured' }
  close(): void { this.state = 'closed' }
}

class FakeDecoder extends FakeEncoder {
  decodeQueueSize = 0
  decode(): void { this.decodeQueueSize++ }
  override close(): void {
    this.decodeQueueSize = 0
    super.close()
  }
}

beforeEach(() => {
  vi.stubGlobal('VideoEncoder', FakeEncoder)
  vi.stubGlobal('VideoDecoder', FakeDecoder)
})
afterEach(() => vi.unstubAllGlobals())

it.each([['key', 4], ['delta', 5]] as const)(
  'counts the four queued frames discarded before a %s access unit',
  (nextType, expectedDrops) => {
    const codec = 'avc1.640028'
    const stream = new DownlinkStream({
      id: 'main', width: 1080, height: 1080, bitrateBps: 4_000_000,
      codecString: codec, encoderConfig: { codec, width: 1080, height: 1080 },
    }, 1_000, {
      send: () => 'accepted',
      decoded: () => {},
      fatal: error => { throw error },
    })

    const receive = (timestamp: number, type: 'key' | 'delta') => {
      stream.receive({
        stream,
        chunk: { type, timestamp, duration: null, byteLength: 100, copyTo: () => {} },
        restart: timestamp === 0,
        decoderConfig: timestamp === 0 ? { codec } : undefined,
      }, 100, timestamp)
    }

    receive(0, 'key')
    for (let i = 1; i < 4; i++) receive(i, 'delta')
    expect(stream.counters.decoderDrops).toBe(0)
    receive(4, nextType)
    expect(stream.counters.decoderDrops).toBe(expectedDrops)
    stream.close()
  },
)
