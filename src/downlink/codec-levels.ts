import type { StreamSpec, VideoCodec } from './types'

type Picture = Pick<StreamSpec, 'width' | 'height' | 'bitrateBps'>

// Keep level 4 as the floor for the WebCodecs probes. These tables bound the
// requested geometry, cadence and nominal target; they do not check a bitstream.
// For AVC and HEVC use the stricter VCL bitrate limit (before NAL overhead).

// ITU-T H.264 (06/2026), Annex A, Tables A-1 and A-2.
// [level_idc, macroblocks/frame, macroblocks/s, MaxBR]
const AVC = [
  [40, 8_192, 245_760, 20_000],
  [41, 8_192, 245_760, 50_000],
  [42, 8_704, 522_240, 50_000],
  [50, 22_080, 589_824, 135_000],
  [51, 36_864, 983_040, 240_000],
  [52, 36_864, 2_073_600, 240_000],
  [60, 139_264, 4_177_920, 240_000],
  [61, 139_264, 8_355_840, 480_000],
  [62, 139_264, 16_711_680, 800_000],
] as const

// ITU-T H.265 (01/2026), Annex A.4, Tables A.8–A.10, Main profile.
// [general_level_idc, luma samples/frame, luma samples/s, Main Mb/s, High Mb/s]
const HEVC = [
  [120, 2_228_224, 66_846_720, 12, 30],
  [123, 2_228_224, 133_693_440, 20, 50],
  [150, 8_912_896, 267_386_880, 25, 100],
  [153, 8_912_896, 534_773_760, 40, 160],
  [156, 8_912_896, 1_069_547_520, 60, 240],
  [180, 35_651_584, 1_069_547_520, 60, 240],
  [183, 35_651_584, 2_139_095_040, 120, 480],
  [186, 35_651_584, 4_278_190_080, 240, 800],
] as const

// AOM AV1 v1.0.0 with Errata 1, Annex A, Main profile (seq_profile = 0).
// [seq_level_idx, luma samples/frame, display luma samples/s, max width,
//  max height, Main Mb/s, High Mb/s]. Decode rates exceed display rates;
//  use one decoded picture per display frame for this preflight.
const AV1 = [
  [8, 2_359_296, 70_778_880, 6_144, 3_456, 12, 30],
  [9, 2_359_296, 141_557_760, 6_144, 3_456, 20, 50],
  [12, 8_912_896, 267_386_880, 8_192, 4_352, 30, 100],
  [13, 8_912_896, 534_773_760, 8_192, 4_352, 40, 160],
  [14, 8_912_896, 1_069_547_520, 8_192, 4_352, 60, 240],
  [16, 35_651_584, 1_069_547_520, 16_384, 8_704, 60, 240],
  [17, 35_651_584, 2_139_095_040, 16_384, 8_704, 100, 480],
  [18, 35_651_584, 4_278_190_080, 16_384, 8_704, 160, 800],
] as const

// WebM Project, VP9 Levels and Decoder Testing, Profile 0.
// [level × 10, luma samples/frame, luma samples/s, max side, Mb/s]
const VP9 = [
  [40, 2_228_224, 83_558_400, 4_160, 18],
  [41, 2_228_224, 160_432_128, 4_160, 30],
  [50, 8_912_896, 311_951_360, 8_384, 60],
  [51, 8_912_896, 588_251_136, 8_384, 120],
  [52, 8_912_896, 1_176_502_272, 8_384, 180],
  [60, 35_651_584, 1_176_502_272, 16_832, 180],
  [61, 35_651_584, 2_353_004_544, 16_832, 240],
  [62, 35_651_584, 4_706_009_088, 16_832, 480],
] as const

function tierVariants(
  main: number | undefined,
  high: number | undefined,
  format: (level: number, high: boolean) => string,
): readonly (string | undefined)[] {
  if (main === undefined) {
    const required = high === undefined ? undefined : format(high, true)
    return [required, required]
  }
  const preferred = format(main, false)
  return [preferred, high !== undefined && high < main ? format(high, true) : preferred]
}

/** Ordered alternatives, with corresponding profile/tier slots across streams. */
export function codecCandidates(codec: VideoCodec, { width, height, bitrateBps }: Picture, fps: number): readonly (string | undefined)[] {
  const samples = width * height
  const sampleRate = samples * fps
  switch (codec) {
    case 'h264': {
      // Progressive frames are coded in 16 × 16 macroblocks including crop padding.
      const mbWidth = Math.ceil(width / 16)
      const mbHeight = Math.ceil(height / 16)
      const mbCount = mbWidth * mbHeight
      const macroblockLevels = AVC.filter(([, maxFrame, maxRate]) =>
        mbCount <= maxFrame && mbCount * fps <= maxRate && Math.max(mbWidth, mbHeight) ** 2 <= 8 * maxFrame)
      return ([['6400', 1_250], ['42e0', 1_000]] as const).map(([profile, brFactor]) => {
        const level = macroblockLevels.find(([, , , maxBr]) => bitrateBps <= maxBr * brFactor)?.[0]
        return level === undefined ? undefined : `avc1.${profile}${level.toString(16)}`
      })
    }
    case 'h265': {
      // §7.4.3.2.1: coded dimensions are multiples of MinCbSizeY, at least 8.
      const codedWidth = Math.ceil(width / 8) * 8
      const codedHeight = Math.ceil(height / 8) * 8
      const codedSamples = codedWidth * codedHeight
      const levels = HEVC.filter(([, maxFrame, maxRate]) =>
        codedSamples <= maxFrame && codedSamples * fps <= maxRate && Math.max(codedWidth, codedHeight) ** 2 <= 8 * maxFrame)
      const main = levels.find(([, , , max]) => bitrateBps <= max * 1_000_000)?.[0]
      const high = levels.find(([, , , , max]) => bitrateBps <= max * 1_000_000)?.[0]
      return tierVariants(main, high, (level, highTier) => `1.6.${highTier ? 'H' : 'L'}${level}.B0`)
        .flatMap(suffix => ['hvc1', 'hev1'].map(prefix => suffix && `${prefix}.${suffix}`))
    }
    case 'av1': {
      if (width < 16 || height < 16) return []
      const levels = AV1.filter(([, maxFrame, maxRate, maxWidth, maxHeight]) =>
        samples <= maxFrame && sampleRate <= maxRate && width <= maxWidth && height <= maxHeight)
      const main = levels.find(([, , , , , max]) => bitrateBps <= max * 1_000_000)?.[0]
      const high = levels.find(([, , , , , , max]) => bitrateBps <= max * 1_000_000)?.[0]
      return tierVariants(main, high, (level, highTier) => `av01.0.${String(level).padStart(2, '0')}${highTier ? 'H' : 'M'}.08`)
    }
    case 'vp9': {
      const level = VP9.find(([, maxFrame, maxRate, maxSide, maxMb]) =>
        samples <= maxFrame && sampleRate <= maxRate && Math.max(width, height) <= maxSide && bitrateBps <= maxMb * 1_000_000)?.[0]
      return level === undefined ? [] : [`vp09.00.${level}.08`]
    }
  }
}
