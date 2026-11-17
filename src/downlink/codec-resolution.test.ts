import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { probeDownlink } from './codec'
import { DEFAULT_DOWNLINK_CONFIG, type DownlinkResolution } from './types'

const isConfigSupported = vi.fn(async () => ({ supported: false }))

beforeEach(() => {
  isConfigSupported.mockClear()
  vi.stubGlobal('VideoEncoder', { isConfigSupported })
  vi.stubGlobal('VideoDecoder', class {})
  vi.stubGlobal('VideoFrame', class {})
})

afterEach(() => vi.unstubAllGlobals())

it.each([144, 240, 360, 480, 720, 1080, 1440, 2160] as const)(
  'probes a square %ip main preset and its 2:1 panorama at the selected height',
  async resolution => {
    await probeDownlink({ ...DEFAULT_DOWNLINK_CONFIG, program: 'both', mainAspectRatio: 1, resolution })
    expect(isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({ width: resolution, height: resolution }))
    expect(isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({ width: resolution * 2, height: resolution }))
  },
)

it('rejects an unsupported height before asking for an encoder', async () => {
  const result = await probeDownlink({ ...DEFAULT_DOWNLINK_CONFIG, resolution: 145 as DownlinkResolution })
  expect(result).toMatchObject({ supported: false, reason: expect.stringContaining('144p and 2160p') })
  expect(isConfigSupported).not.toHaveBeenCalled()
})
