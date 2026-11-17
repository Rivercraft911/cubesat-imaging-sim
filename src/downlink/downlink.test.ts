import { describe, expect, it } from 'vitest'
import { getSensor } from '../sim/catalog'
import { KeyRecovery, LinkTimeline } from './channel'
import { buildStreams, DEFAULT_DOWNLINK_CONFIG } from './types'

describe('video program', () => {
  it('defaults to a 16:9 main stream when the caller omits the sensor ratio', () => {
    expect(buildStreams(DEFAULT_DOWNLINK_CONFIG)).toEqual([
      { id: 'main', width: 1920, height: 1080, bitrateBps: 4_000_000 },
    ])
  })

  it('encodes the square IMX676 main feed and preserves the shared program budget', () => {
    const sensor = getSensor('imx676')
    expect(buildStreams({
      ...DEFAULT_DOWNLINK_CONFIG,
      program: 'both',
      architecture: 'ground',
      mainAspectRatio: sensor.width / sensor.height,
    })).toEqual([
      { id: 'main', width: 1080, height: 1080, bitrateBps: 2_000_000 },
      { id: 'wideA', width: 1080, height: 1080, bitrateBps: 1_000_000 },
      { id: 'wideB', width: 1080, height: 1080, bitrateBps: 1_000_000 },
    ])
  })

  it('rounds a custom main encode width to the nearest even pixel', () => {
    expect(buildStreams({ ...DEFAULT_DOWNLINK_CONFIG, mainAspectRatio: 1001 / 1080 })).toEqual([
      { id: 'main', width: 1002, height: 1080, bitrateBps: 4_000_000 },
    ])
  })

  it('allocates one panoramic stream for onboard stitching', () => {
    expect(buildStreams({ ...DEFAULT_DOWNLINK_CONFIG, program: '360', resolution: 2160 })).toEqual([
      { id: 'panorama', width: 4320, height: 2160, bitrateBps: 4_000_000 },
    ])
    expect(buildStreams({ ...DEFAULT_DOWNLINK_CONFIG, program: 'both', resolution: 720 })).toEqual([
      { id: 'main', width: 1280, height: 720, bitrateBps: 2_000_000 },
      { id: 'panorama', width: 1440, height: 720, bitrateBps: 2_000_000 },
    ])
  })

  it('splits the 360 budget between the two eyes for ground stitching', () => {
    const config = { ...DEFAULT_DOWNLINK_CONFIG, architecture: 'ground' as const }
    expect(buildStreams({ ...config, program: '360' })).toEqual([
      { id: 'wideA', width: 1080, height: 1080, bitrateBps: 2_000_000 },
      { id: 'wideB', width: 1080, height: 1080, bitrateBps: 2_000_000 },
    ])
    expect(buildStreams({ ...config, program: 'both', videoBitrateBps: 4_000_001 })).toEqual([
      { id: 'main', width: 1920, height: 1080, bitrateBps: 2_000_000 },
      { id: 'wideA', width: 1080, height: 1080, bitrateBps: 1_000_000 },
      { id: 'wideB', width: 1080, height: 1080, bitrateBps: 1_000_001 },
    ])
  })
})

const options = { linkBitrateBps: 800_000, propagationMs: 10, maxQueueMs: 50 }

describe('shared link timeline', () => {
  it('serializes streams on one FIFO and adds propagation after serialization', () => {
    const link = new LinkTimeline<string>(options)
    expect(link.enqueue('main', 2_000, 0)).toMatchObject({
      accepted: true,
      delivery: { finishedAtMs: 20, arrivesAtMs: 30 },
    })
    expect(link.enqueue('wideA', 1_000, 2)).toMatchObject({
      accepted: true,
      delivery: { finishedAtMs: 30, arrivesAtMs: 40 },
    })
    expect(link.backlog(8)).toEqual({ bytes: 3_000, ageMs: 8, serviceMs: 22 })
    expect(link.drain(29)).toEqual([])
    expect(link.drain(30).map(packet => packet.payload)).toEqual(['main'])
    expect(link.drain(40).map(packet => packet.payload)).toEqual(['wideA'])
    expect(link.backlog(40)).toEqual({ bytes: 0, ageMs: 0, serviceMs: 0 })
  })

  it('bounds serialization backlog and frees capacity as service completes', () => {
    const link = new LinkTimeline<string>(options)
    expect(link.enqueue('first', 5_000, 0).accepted).toBe(true)
    expect(link.enqueue('overflow', 100, 0)).toEqual({ accepted: false, reason: 'queue' })
    expect(link.enqueue('fits', 100, 1).accepted).toBe(true)
    expect(link.enqueue('oversize', 5_001, 100)).toEqual({ accepted: false, reason: 'queue' })
    expect(link.drain(100).map(packet => packet.payload)).toEqual(['first', 'fits'])
  })

  it('limits buffered chunk count even if time or bytes are inexpensive', () => {
    const link = new LinkTimeline<number>({ ...options, linkBitrateBps: 800_000_000 })
    let accepted = 0
    for (let i = 0; i < 1_000; i++) if (link.enqueue(i, 1, 0).accepted) accepted++
    expect(accepted).toBeGreaterThan(0)
    expect(accepted).toBeLessThan(1_000)
    expect(link.backlog(0).bytes).toBe(accepted)
    expect(link.drain(100)).toHaveLength(accepted)
    expect(link.backlog(100).bytes).toBe(0)
  })

  it('rejects transmissions that overlap a planned outage', () => {
    const link = new LinkTimeline<string>({ ...options, outages: [{ startMs: 25, endMs: 100 }] })
    expect(link.enqueue('finished before interruption', 2_500, 0).accepted).toBe(true)
    expect(link.enqueue('crosses interruption', 100, 1)).toEqual({ accepted: false, reason: 'outage' })
    expect(link.enqueue('during interruption', 100, 99)).toEqual({ accepted: false, reason: 'outage' })
    expect(link.drain(35).map(packet => packet.payload)).toEqual(['finished before interruption'])
    expect(link.enqueue('after interruption', 100, 100).accepted).toBe(true)
  })

  it('drops unfinished transmission on a manual interruption and preserves in-flight data', () => {
    const link = new LinkTimeline<string>(options)
    link.enqueue('in flight', 1_000, 0)
    link.enqueue('partial', 1_000, 0)
    link.enqueue('queued', 1_000, 0)
    expect(link.setOutage(true, 15).map(packet => packet.payload)).toEqual(['partial', 'queued'])
    expect(link.backlog(15)).toEqual({ bytes: 1_000, ageMs: 0, serviceMs: 0 })
    expect(link.enqueue('blocked', 100, 15)).toEqual({ accepted: false, reason: 'outage' })
    expect(link.drain(20).map(packet => packet.payload)).toEqual(['in flight'])
    link.setOutage(false, 30)
    expect(link.enqueue('restored', 100, 30)).toMatchObject({
      accepted: true,
      delivery: { finishedAtMs: 31, arrivesAtMs: 41 },
    })
  })
})

describe('per-stream recovery', () => {
  it('waits for an admitted keyframe and leaves the other stream synchronized', () => {
    const main = new KeyRecovery()
    const wide = new KeyRecovery()
    expect(main.allows('delta')).toBe(false)
    expect(main.accept('key')).toBe(true)
    expect(wide.accept('key')).toBe(true)
    expect(main.allows('delta')).toBe(true)
    main.lose()
    expect(main.allows('delta')).toBe(false)
    expect(wide.allows('delta')).toBe(true)
    expect(main.allows('key')).toBe(true)
    expect(main.waitingForKeyframe).toBe(true)
    expect(main.accept('key')).toBe(true)
    expect(main.accept('key')).toBe(false)
    expect(main.allows('delta')).toBe(true)
  })
})
