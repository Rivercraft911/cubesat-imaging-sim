import { describe, expect, it } from 'vitest'
import { LinkTimeline } from './channel'

const initial = { linkBitrateBps: 8_000, propagationMs: 100, maxQueueMs: 10_000 }

describe('live FIFO reconfiguration', () => {
  it('preserves in-flight arrivals and counts only remaining bits of a partial packet', () => {
    const link = new LinkTimeline<string>(initial)
    link.enqueue('flight', 100, 0)
    link.enqueue('partial', 100, 0)
    link.enqueue('queued', 100, 0)
    expect(link.setOptions({ ...initial, linkBitrateBps: 16_000, propagationMs: 10 }, 150)).toEqual([])
    // First AU finished at100; second has50B left; third remains100B.
    expect(link.drain(199)).toEqual([])
    expect(link.drain(200).map(p => [p.payload, p.finishedAtMs, p.arrivesAtMs])).toEqual([
      ['flight', 100, 200], ['partial', 175, 200],
    ])
    expect(link.drain(235).map(p => [p.payload, p.finishedAtMs])).toEqual([['queued', 225]])
    expect(link.backlog(235).bytes).toBe(0)
  })

  it('conserves fractional bits across repeated rate changes without reserializing', () => {
    const link = new LinkTimeline<number>(initial)
    link.enqueue(1, 1_000, 0)
    // 100ms×8kb/s +200ms×4kb/s +50ms×16kb/s =2400bits sent.
    link.setOptions({ ...initial, linkBitrateBps: 4_000 }, 100)
    link.setOptions({ ...initial, linkBitrateBps: 16_000 }, 300)
    link.setOptions({ ...initial, linkBitrateBps: 8_000 }, 350)
    expect(link.backlog(350).serviceMs).toBeCloseTo(700)
    expect(link.drain(1_149)).toEqual([])
    expect(link.drain(1_150)[0].finishedAtMs).toBeCloseTo(1_050)
  })

  it('keeps original propagation for sent data and applies longer delay to unsent data', () => {
    const link = new LinkTimeline<string>(initial)
    link.enqueue('sent', 100, 0)
    link.enqueue('partial', 100, 0)
    link.setOptions({ ...initial, propagationMs: 500 }, 150)
    expect(link.drain(200).map(p => p.payload)).toEqual(['sent'])
    expect(link.drain(699)).toEqual([])
    expect(link.drain(700).map(p => p.payload)).toEqual(['partial'])
  })

  it('tail-drops over-budget access units while keeping flight and retained dependency prefixes', () => {
    const link = new LinkTimeline<string>(initial)
    for (const name of ['flight', 'retained', 'lost', 'dependent']) link.enqueue(name, 100, 0)
    const losses = link.setOptions({ ...initial, linkBitrateBps: 4_000, maxQueueMs: 200 }, 150)
    expect(losses.map(l => [l.delivery.payload, l.reason])).toEqual([
      ['lost', 'queue'], ['dependent', 'queue'],
    ])
    expect(link.backlog(150)).toEqual({ bytes: 200, ageMs: 150, serviceMs: 100 })
    expect(link.drain(350).map(p => p.payload)).toEqual(['flight', 'retained'])
    expect(link.backlog(350).bytes).toBe(0)
  })

  it('drops a newly intersected outage window without moving in-flight packets', () => {
    const link = new LinkTimeline<string>({ ...initial, outages: [{ startMs: 300, endMs: 500 }] })
    link.enqueue('flight', 100, 0)
    link.enqueue('partial', 100, 0)
    expect(link.setOptions({ ...initial, linkBitrateBps: 2_000 }, 150).map(l => l.reason)).toEqual(['outage'])
    expect(link.drain(200).map(p => p.payload)).toEqual(['flight'])
    expect(link.enqueue('after', 25, 500)).toMatchObject({ accepted: true, delivery: { finishedAtMs: 600 } })
  })

  it('cannot reorder a new packet ahead of an older in-flight packet after shortening delay', () => {
    const link = new LinkTimeline<string>({ ...initial, propagationMs: 1_000 })
    link.enqueue('old', 100, 0)
    link.setOptions({ ...initial, propagationMs: 0 }, 200)
    link.enqueue('new', 10, 200)
    expect(link.drain(1_099)).toEqual([])
    expect(link.drain(1_100).map(p => p.payload)).toEqual(['old', 'new'])
  })

  it('retains the chunk-count bound and snapshots caller options across capacity updates', () => {
    const options = { ...initial, propagationMs: 1_000_000 }
    const link = new LinkTimeline<number>(options)
    for (let i = 0; i < 256; i++) expect(link.enqueue(i, 1, 0).accepted).toBe(true)
    link.setOptions(options, 100)
    options.linkBitrateBps = 1
    expect(link.enqueue(256, 1, 100)).toEqual({ accepted: false, reason: 'queue' })
    expect(link.backlog(100).serviceMs).toBeCloseTo(156)
    expect(() => link.setOptions({ ...initial, linkBitrateBps: NaN }, 100)).toThrow()
    expect(link.backlog(100).bytes).toBe(256)
  })
})
