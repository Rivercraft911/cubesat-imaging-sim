import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeComparisonFrame } from './lens-comparison-codec';
import { DEFAULT_DOWNLINK_CONFIG } from '../downlink/types';

vi.mock('../downlink/codec', () => ({ probeDownlink: vi.fn(async () => ({ supported: true, streams: [{ width: 1080, height: 1080, codecString: 'test-codec', encoderConfig: {} }] })) }));
const frameClose = vi.fn();
const encoderClose = vi.fn();
const decoderClose = vi.fn();
const draw = vi.fn();
function mocks() {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: draw }) }) });
  vi.stubGlobal('VideoFrame', class { close = frameClose; });
  vi.stubGlobal('VideoEncoder', class {
    state = 'configured';
    constructor(private callbacks: VideoEncoderInit) {}
    configure() {}
    encode(_frame: VideoFrame, options: VideoEncoderEncodeOptions) {
      expect(options.keyFrame).toBe(true);
      this.callbacks.output({ type: 'key', byteLength: 1200 } as EncodedVideoChunk, { decoderConfig: { codec: 'test-codec', description: new Uint8Array(20) } });
    }
    async flush() {}
    close() { this.state = 'closed'; encoderClose(); }
  });
  vi.stubGlobal('VideoDecoder', class {
    state = 'configured';
    constructor(private callbacks: VideoDecoderInit) {}
    configure() {}
    decode() { this.callbacks.output({ displayWidth: 1080, displayHeight: 1080, close: frameClose } as unknown as VideoFrame); }
    async flush() {}
    close() { this.state = 'closed'; decoderClose(); }
  });
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('frozen keyframe comparison', () => {
  it('encodes and decodes actual frame objects and applies modeled serialization including decoder description', async () => {
    mocks();
    const result = await decodeComparisonFrame({} as ImageBitmap, { ...DEFAULT_DOWNLINK_CONFIG }, new AbortController().signal);
    expect(result.image).toMatchObject({ width: 1080, height: 1080 });
    expect(result.bytes).toBe(1220);
    expect(result.arrivalMs).toBeCloseTo(1220 * 8000 / DEFAULT_DOWNLINK_CONFIG.linkBitrateBps + DEFAULT_DOWNLINK_CONFIG.propagationMs);
    expect(frameClose).toHaveBeenCalledTimes(2);
    expect(encoderClose).toHaveBeenCalledOnce();
    expect(decoderClose).toHaveBeenCalledOnce();
  });
  it('reports queue rejection without pretending that a frame was decoded', async () => {
    mocks();
    const result = await decodeComparisonFrame({} as ImageBitmap, { ...DEFAULT_DOWNLINK_CONFIG, linkBitrateBps: 1 }, new AbortController().signal);
    expect(result.dropped).toBe('queue');
    expect(result.image).toBeUndefined();
    expect(decoderClose).not.toHaveBeenCalled();
    expect(frameClose).toHaveBeenCalledOnce();
    expect(encoderClose).toHaveBeenCalledOnce();
  });
  it('does no capture work after cancellation during the codec probe', async () => {
    mocks();
    const cancel = new AbortController(); cancel.abort();
    await expect(decodeComparisonFrame({} as ImageBitmap, { ...DEFAULT_DOWNLINK_CONFIG }, cancel.signal)).rejects.toThrow();
    expect(draw).not.toHaveBeenCalled();
  });
});
