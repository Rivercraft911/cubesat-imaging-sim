import { describe, expect, it } from 'vitest'
import { closePair, FramePairs } from './frame-pairs'

class FakeFrame {
  closed = false
  copies: FakeFrame[] = []
  constructor(readonly timestamp: number, readonly displayWidth = 1080, readonly displayHeight = 1080) {}
  clone(): FakeFrame {
    const copy = new FakeFrame(this.timestamp, this.displayWidth, this.displayHeight)
    this.copies.push(copy)
    return copy
  }
  close(): void {
    expect(this.closed).toBe(false)
    this.closed = true
  }
}

describe('decoded fisheye pairing', () => {
  it.each([1080, 2160])('keeps output moving when one %ipx eye lags by three frames', size => {
    const queue = new FramePairs<FakeFrame>()
    const inputs: FakeFrame[] = []
    const delivered: number[] = []
    for (let i = 0; i < 300; i++) {
      const a = new FakeFrame(Math.round(i * 1e6 / 15), size, size)
      inputs.push(a)
      queue.add('wideA', a)
      if (i >= 3) {
        const b = new FakeFrame(Math.round((i - 3) * 1e6 / 15), size, size)
        inputs.push(b)
        queue.add('wideB', b)
      }
      const pair = queue.takeLatest()
      if (pair) {
        expect(pair.wideA.timestamp).toBe(pair.wideB.timestamp)
        delivered.push(pair.timestamp)
        closePair(pair)
      }
      expect(queue.retainedBytes).toBeLessThanOrEqual(queue.maxBytes)
    }
    expect(delivered).toHaveLength(297)
    queue.clear()
    expect(queue.retainedBytes).toBe(0)
    expect(inputs.every(frame => !frame.closed)).toBe(true)
    expect(inputs.flatMap(frame => frame.copies).every(frame => frame.closed)).toBe(true)
  })

  it('presents the latest complete pair without mixing timestamps or regressing', () => {
    const queue = new FramePairs<FakeFrame>()
    const old = new FakeFrame(10)
    queue.add('wideA', old)
    queue.add('wideB', old)
    const fresh = new FakeFrame(20)
    queue.add('wideA', fresh)
    queue.add('wideB', fresh)
    const pair = queue.takeLatest()!
    expect(pair.timestamp).toBe(20)
    expect(old.copies.every(frame => frame.closed)).toBe(true)
    queue.add('wideB', old)
    expect(old.copies).toHaveLength(2)
    expect(queue.takeLatest()).toBeUndefined()
    closePair(pair)
    expect(queue.retainedBytes).toBe(0)
  })

  it('bounds a missing eye by retained bytes and capture time, then recovers', () => {
    const queue = new FramePairs<FakeFrame>(4 * 1080 * 1080 * 4)
    const frames = Array.from({ length: 120 }, (_, i) => new FakeFrame(i * 10_000))
    for (const frame of frames) {
      queue.add('wideA', frame)
      expect(queue.retainedBytes).toBeLessThanOrEqual(queue.maxBytes)
    }
    queue.add('wideB', frames[0])
    expect(frames[0].copies).toHaveLength(1)
    queue.add('wideB', frames.at(-1)!)
    const pair = queue.takeLatest()!
    expect(pair.timestamp).toBe(frames.at(-1)!.timestamp)
    closePair(pair)
    queue.clear()
    expect(frames.flatMap(frame => frame.copies).every(frame => frame.closed)).toBe(true)
  })

  it('releases replaced clones and refuses frames larger than the budget', () => {
    const queue = new FramePairs<FakeFrame>(1024)
    const frame = new FakeFrame(0, 8, 8)
    queue.add('wideA', frame)
    queue.add('wideA', frame)
    expect(frame.copies[0].closed).toBe(true)
    expect(queue.retainedBytes).toBe(256)
    const oversized = new FakeFrame(1)
    queue.add('wideB', oversized)
    expect(oversized.copies).toHaveLength(0)
    queue.clear()
    expect(frame.copies[1].closed).toBe(true)
  })
})
