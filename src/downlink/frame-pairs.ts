type Eye = 'wideA' | 'wideB'
interface Frame<T> {
  timestamp: number
  displayWidth: number
  displayHeight: number
  clone(): T
  close(): void
}
type Pair<T> = Partial<Record<Eye, T>>

export function closePair<T extends Frame<T>>(pair: Pair<T>): void {
  pair.wideA?.close()
  pair.wideB?.close()
}

/** Keep exact capture pairs across decoder skew; bound latency and retained pixels. */
export class FramePairs<T extends Frame<T>> {
  readonly #pairs = new Map<number, Pair<T>>()
  #bytes = 0
  #newest = -Infinity
  #presented = -Infinity

  constructor(
    readonly maxBytes = 128 * 1024 * 1024,
    readonly maxSkewUs = 500_000,
  ) {}

  get retainedBytes(): number { return this.#bytes }

  #size(frame: T): number {
    // Conservative RGBA-equivalent budget even for YUV decoder surfaces.
    return frame.displayWidth * frame.displayHeight * 4
  }

  #remove(timestamp: number, close = true): void {
    const pair = this.#pairs.get(timestamp)!
    for (const frame of Object.values(pair) as T[]) this.#bytes -= this.#size(frame)
    if (close) closePair(pair)
    this.#pairs.delete(timestamp)
  }

  /** Borrow the input; retain a clone only while its matching eye may arrive. */
  add(eye: Eye, frame: T): void {
    const timestamp = frame.timestamp
    if (timestamp <= this.#presented || timestamp < this.#newest - this.maxSkewUs) return
    const bytes = this.#size(frame)
    if (bytes > this.maxBytes) return
    const copy = frame.clone()
    this.#newest = Math.max(this.#newest, timestamp)
    const pair = this.#pairs.get(timestamp) ?? {}
    if (pair[eye]) {
      this.#bytes -= this.#size(pair[eye])
      pair[eye].close()
    }
    pair[eye] = copy
    this.#bytes += bytes
    this.#pairs.set(timestamp, pair)
    for (const pts of this.#pairs.keys()) {
      if (pts < this.#newest - this.maxSkewUs) this.#remove(pts)
    }
    // Also cap tiny/custom frames by count: no unbounded timestamp bookkeeping.
    while (this.#bytes > this.maxBytes || this.#pairs.size > 16) {
      this.#remove(Math.min(...this.#pairs.keys()))
    }
  }

  /** Transfer ownership of the newest complete pair; release superseded frames. */
  takeLatest(): { timestamp: number; wideA: T; wideB: T } | undefined {
    const ready = [...this.#pairs.entries()]
      .filter(([, pair]) => pair.wideA && pair.wideB)
      .sort(([a], [b]) => b - a)[0]
    if (!ready) return
    const [timestamp, pair] = ready
    this.#presented = timestamp
    for (const pts of this.#pairs.keys()) {
      if (pts <= timestamp) this.#remove(pts, pts !== timestamp)
    }
    return { timestamp, wideA: pair.wideA!, wideB: pair.wideB! }
  }

  clear(): void {
    for (const pts of this.#pairs.keys()) this.#remove(pts)
  }
}
