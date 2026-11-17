import { afterEach, describe, expect, it, vi } from 'vitest'
import { codecCandidates } from './codec-levels'
import { probeDownlink } from './codec'
import { DEFAULT_DOWNLINK_CONFIG, type VideoCodec } from './types'

function firstCodec(codec: VideoCodec, width: number, height: number, fps: number, mbps = 4) {
  return codecCandidates(codec, { width, height, bitrateBps: mbps * 1_000_000 }, fps)[0]
}

describe('downlink codec levels', () => {
  it.each([
    ['h264', 'avc1.640028', 'avc1.640033', 'avc1.640034'],
    ['h265', 'hvc1.1.6.L120.B0', 'hvc1.1.6.L150.B0', 'hvc1.1.6.L180.B0'],
    ['av1', 'av01.0.08M.08', 'av01.0.12M.08', 'av01.0.16M.08'],
    ['vp9', 'vp09.00.40.08', 'vp09.00.50.08', 'vp09.00.60.08'],
  ] as const)('fits the common 1080p, UHD and panoramic presets for %s', (codec, hd, uhd, pano) => {
    expect(firstCodec(codec, 1920, 1080, 30)).toBe(hd)
    expect(firstCodec(codec, 3840, 2160, 30)).toBe(uhd)
    expect(firstCodec(codec, 4320, 2160, 30)).toBe(pano)
  })

  it('uses AVC level 6 for the 63,855 macroblocks of a wide 2160p feed', () => {
    expect(firstCodec('h264', 7560, 2160, 15)).toBe('avc1.64003c')
  })

  it('raises the AVC level when the frame rate exceeds the macroblock processing limit', () => {
    expect(firstCodec('h264', 2400, 2160, 15)).toBe('avc1.640032')
    expect(firstCodec('h264', 2400, 2160, 30)).toBe('avc1.640033')
  })

  it('applies distinct limits for AVC High and Constrained Baseline', () => {
    expect(codecCandidates('h264', { width: 1080, height: 1080, bitrateBps: 25_000_000 }, 15))
      .toEqual(['avc1.640028', 'avc1.42e029'])
  })

  it('checks AV1 width separately from area', () => {
    expect(firstCodec('av1', 6144, 240, 30)).toBe('av01.0.08M.08')
    expect(firstCodec('av1', 6146, 240, 30)).toBe('av01.0.12M.08')
  })

  it('raises AV1 and VP9 levels for a 50 Mb/s square 1080p stream', () => {
    expect(codecCandidates('av1', { width: 1080, height: 1080, bitrateBps: 50_000_000 }, 15))
      .toEqual(['av01.0.14M.08', 'av01.0.09H.08'])
    expect(firstCodec('vp9', 1080, 1080, 15, 50)).toBe('vp09.00.50.08')
  })
})

describe('codec level preflight', () => {
  afterEach(() => vi.unstubAllGlobals())

  function encoderQueries() {
    const query = vi.fn(async (_config: VideoEncoderConfig) => ({ supported: false }))
    vi.stubGlobal('VideoEncoder', { isConfigSupported: query })
    vi.stubGlobal('VideoDecoder', class {})
    vi.stubGlobal('VideoFrame', class {})
    return query
  }

  it('queries only bitrate-compatible HEVC candidates for a 50 Mb/s square 1080p stream', async () => {
    const query = encoderQueries()
    await probeDownlink({ ...DEFAULT_DOWNLINK_CONFIG, codec: 'h265', mainAspectRatio: 1, videoBitrateBps: 50_000_000 })
    expect(query.mock.calls.map(([config]) => config)).toEqual([
      'hvc1.1.6.L156.B0', 'hev1.1.6.L156.B0', 'hvc1.1.6.H123.B0', 'hev1.1.6.H123.B0',
    ].map(codec => expect.objectContaining({ codec, width: 1080, height: 1080, bitrate: 50_000_000 })))
  })

  it('rejects a target beyond the modeled levels before asking for browser support', async () => {
    const query = encoderQueries()
    const result = await probeDownlink({ ...DEFAULT_DOWNLINK_CONFIG, codec: 'vp9', videoBitrateBps: 500_000_000 })
    expect(result).toMatchObject({ supported: false, reason: expect.stringContaining('500 Mb/s') })
    expect(query).not.toHaveBeenCalled()
  })
})
