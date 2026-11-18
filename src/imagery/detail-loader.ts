import type { GroundImage } from "../render";
import { contains, coverageMargin, type Bounds } from "./bounds";
import { compareImagery, isAerialImage, resolvesSinglePass, type ImagerySource } from "./lod";
import { planShot, type ShotPlan } from "./plan";
import {
  preparedShot,
  previewShot,
  shotImage,
  type ImageryProgress,
} from "./provider";

export interface DetailView {
  bounds: Bounds;
  desiredPixelM: number;
  sensorSpacingM?: number;
  latitudeDeg: number;
  aerial: boolean;
  satellite: GroundImage;
}
type Providers = {
  prepared: typeof preparedShot;
  overview: typeof previewShot;
  full: typeof shotImage;
};
type Job = { plan: ShotPlan; abort: AbortController; started: number };
// A covering crop at its edge can blend almost entirely into regional
// imagery. Prefer equal-resolution coverage with room for the footprint.
function compareCoverage(a: GroundImage, b: GroundImage, bounds: Bounds, spacing: number) {
  return compareImagery(a, b, spacing) || coverageMargin(b.boundsMercator, bounds) - coverageMargin(a.boundsMercator, bounds);
}
export type PredictedFootprint = { bounds: Bounds; sensorSpacingM: number };
type Prefetch = { pending: boolean; bounds: Bounds; abort: AbortController; done: Promise<void> };
const close = (image: GroundImage) => {
  if ("close" in image.image) image.image.close();
};

/** A small latest-view scheduler. Incomplete geographic coverage never becomes
 * the displayed aerial level; usable work survives minor pass/focal changes. */
export class DetailLoader {
  private view: DetailView | null = null;
  private current: (GroundImage & ImagerySource) | null = null;
  private cache = new Map<string, GroundImage & ImagerySource>();
  private job: Job | null = null;
  private warm: Prefetch | null = null;
  private handoff: GroundImage | null = null;
  private nextMotionRequest = 0;
  private notBefore = 0;
  private retry = { key: "", after: 0, attempts: 0 };
  private disposed = false;
  constructor(
    private publish: (image: GroundImage) => void,
    private report: (progress: ImageryProgress) => void,
    private providers: Providers = {
      prepared: preparedShot,
      overview: previewShot,
      full: shotImage,
    },
    private now: () => number = () => performance.now(),
  ) {}

  hasAerial(bounds: Bounds): boolean {
    return (
      this.current !== null &&
      this.cache.has(this.current.id) &&
      contains(this.current.boundsMercator, bounds)
    );
  }
  private show(image: GroundImage, message?: string, ready = true) {
    if (this.current !== image) {
      if (image === this.handoff) this.handoff = null;
      this.current = image;
      this.publish(image);
    }
    this.trim();
    if (ready)
      this.report({
        state: "ready",
        message: message ?? image.attribution,
        resolutionM: image.sourceResolutionM,
      });
  }
  private trim() {
    let bytes = [...this.cache.values()].reduce(
      (n, item) => n + item.image.width * item.image.height * 4,
      0,
    );
    const ordinaryBytes = 192 * 1024 * 1024;
    const handoffBytes = 320 * 1024 * 1024;
    // A 140 MiB campus bitmap and its 100 MiB successor cannot coexist
    // inside the ordinary cache budget. Allow just this pair until the swap.
    const entries = [...this.cache].sort(([, a], [, b]) =>
      Number(a === this.handoff) - Number(b === this.handoff));
    for (const [key, item] of entries) {
      if (bytes <= ordinaryBytes && this.cache.size <= 3) break;
      if (item === this.current) continue;
      if (item === this.handoff && bytes <= handoffBytes && this.cache.size <= 2) break;
      if (item === this.handoff) this.handoff = null;
      this.cache.delete(key);
      bytes -= item.image.width * item.image.height * 4;
      close(item);
    }
  }
  private remember(image: GroundImage) {
    const old = this.cache.get(image.id);
    if (old && old !== image) close(old);
    this.cache.delete(image.id);
    this.cache.set(image.id, image);
  }
  private cached(bounds: Bounds, sensorSpacingM = 0) {
    return [...this.cache.values()]
      .filter(
        (image) =>
          image.image.width > 0 &&
          contains(image.boundsMercator, bounds),
      )
      .sort((a, b) => compareCoverage(a, b, bounds, sensorSpacingM))[0];
  }
  private displayCandidate(view: DetailView, finest?: GroundImage) {
    if (!finest) return view.satellite;
    // A primary crop entering its edge fade would soften the entire frame.
    // Switch directly to another fully supported crop from the same survey.
    if (!isAerialImage(finest.id) || coverageMargin(finest.boundsMercator, view.bounds) === 1) return finest;
    return [...this.cache.values()]
      .filter(item => item.image.width > 0 && isAerialImage(item.id)
        && item.sourceResolutionM < view.satellite.sourceResolutionM
        && coverageMargin(item.boundsMercator, view.bounds) === 1)
      .sort((a, b) => a.sourceResolutionM - b.sourceResolutionM)[0] ?? finest;
  }
  private cancel() {
    this.job?.abort.abort();
    this.job = null;
  }

  /** Decode only local coverage in advance. The live view still decides when
   * the image is useful, so zoomed-out views never display a small rectangle. */
  prefetch(bounds: Bounds, sensorSpacingM = 0) {
    if (this.disposed || this.cached(bounds)) return;
    if (this.warm && contains(this.warm.bounds, bounds)) return;
    this.startPrefetch(bounds, signal =>
      this.providers.prepared(bounds, signal, Infinity, { sensorSpacingM, prefetch: true }));
  }

  prefetchMotion(forecast: PredictedFootprint[]) {
    if (!forecast.length || this.disposed || !this.view?.aerial ||
      this.warm?.pending || this.now() < this.nextMotionRequest) return;
    this.startPrefetch(forecast[0].bounds, async signal => {
      for (const { bounds, sensorSpacingM } of forecast) {
        signal.throwIfAborted();
        let standby: GroundImage | undefined;
        const image = await this.providers.prepared(bounds, signal, Infinity, {
          sensorSpacingM, prefetch: true,
          needsSource: source => {
            const cached = this.cached(bounds, sensorSpacingM);
            if (!cached) return true;
            const rank = compareImagery(source, cached, sensorSpacingM);
            if (rank < 0 || (rank === 0 &&
              coverageMargin(source.boundsMercator, bounds) > coverageMargin(cached.boundsMercator, bounds))) return true;
            if (cached !== this.current) standby = cached;
            return false;
          },
        });
        if (image) return image;
        // Keep the nearest transition resident before warming a later one.
        if (standby) {
          this.handoff = standby;
          break;
        }
      }
      return null;
    }, true);
  }

  private startPrefetch(bounds: Bounds, load: (signal: AbortSignal) => Promise<GroundImage | null>, motion = false) {
    this.warm?.abort.abort();
    const abort = new AbortController();
    const done = load(abort.signal)
      .then((image) => {
        if (abort.signal.aborted || this.disposed) {
          if (image) close(image);
          return;
        }
        if (!image) return;
        if (this.cache.has(image.id)) {
          close(image);
          return;
        }
        if (motion) this.handoff = image;
        this.remember(image);
        if (this.view) this.update(this.view);
        this.trim();
      })
      .catch(() => {
        if (motion && !abort.signal.aborted) this.nextMotionRequest = this.now() + 1500;
        // Foreground loading retries independently when the shot is needed.
      })
      .finally(() => {
        if (this.warm?.abort === abort) this.warm.pending = false;
      });
    this.warm = { bounds, abort, done, pending: true };
  }

  /** Apply the current footprint before the next draw without scheduling
   * network work at the frame rate. Pending results now validate against it. */
  track(view: DetailView) {
    this.update(view, false, false);
  }

  update(view: DetailView, geometryChanged = false, allowRequests = true) {
    if (this.disposed) return;
    this.view = view;
    if (geometryChanged) this.notBefore = this.now() + 180;
    if (!view.aerial) {
      this.cancel();
      this.show(view.satellite);
      return;
    }
    const plan = planShot(view.bounds, view.desiredPixelM, view.latitudeDeg);
    const finest = this.cached(view.bounds, view.sensorSpacingM);
    const best = this.displayCandidate(view, finest);
    if (finest && (finest.sourceResolutionM <= plan.sourceResolutionM * 1.05 ||
      resolvesSinglePass(finest, view.sensorSpacingM ?? 0))) {
      this.cancel();
      this.retry = { key: "", after: 0, attempts: 0 };
      this.show(best, `${best.attribution} · cached`);
      return;
    }
    // Remove a now-too-small aerial rectangle immediately, even during debounce
    // or an outstanding network request. The fallback covers the complete view.
    if (best !== this.current) this.show(best);
    if (this.job) {
      if (
        contains(this.job.plan.bounds, view.bounds) &&
        this.job.plan.mercatorPixelM <= plan.mercatorPixelM * 1.01
      )
        return;
      this.cancel();
    }
    if (!allowRequests) return;
    if (this.now() < this.notBefore) {
      this.report({
        state: "loading",
        message: "Preparing whole-footprint aerial imagery…",
        resolutionM: this.current?.sourceResolutionM,
      });
      return;
    }
    if (this.retry.key === plan.key && this.now() < this.retry.after) return;
    const job: Job = {
      plan,
      abort: new AbortController(),
      started: this.now(),
    };
    this.job = job;
    void this.load(job);
  }
  private useful(job: Job, image: GroundImage): boolean {
    return (
      !this.disposed &&
      this.job === job &&
      !job.abort.signal.aborted &&
      this.view !== null &&
      this.view.aerial &&
      contains(image.boundsMercator, this.view.bounds)
    );
  }
  private accept(job: Job, image: GroundImage, label: string) {
    if (!this.useful(job, image)) {
      close(image);
      return false;
    }
    // Preserve adequate single-pass coverage and reject late coarse overviews.
    if (
      this.hasAerial(this.view!.bounds) &&
      compareCoverage(this.current!, image, this.view!.bounds, this.view!.sensorSpacingM ?? 0) <= 0
    ) {
      close(image);
      return false;
    }
    this.remember(image);
    const draw = this.displayCandidate(this.view!, this.cached(this.view!.bounds, this.view!.sensorSpacingM));
    this.show(draw, draw === image ? `${label} · ${((this.now() - job.started) / 1000).toFixed(1)} s` : draw.attribution);
    return true;
  }
  private async load(job: Job) {
    const { plan, abort } = job;
    const previewAbort = new AbortController();
    const previewSignal = AbortSignal.any([abort.signal, previewAbort.signal]);
    let complete = 0;
    const loading = (message: string) => {
      if (this.job === job && !abort.signal.aborted)
        this.report({
          state: "loading",
          message,
          resolutionM: this.current?.sourceResolutionM,
        });
    };
    const refinement = () =>
      loading(
        `Refining aerial imagery · ${complete}/${plan.tiles.length} tiles · ${((this.now() - job.started) / 1000).toFixed(1)} s`,
      );
    try {
      loading("Opening whole-footprint aerial imagery…");
      // Even a covering medium-resolution raster may have a finer bundled
      // replacement. Check local assets before spending time on remote tiles.
      const warm = this.warm;
      if (warm && contains(warm.bounds, this.view!.bounds)) {
        await warm.done;
        abort.signal.throwIfAborted();
      }
      let prepared: GroundImage | null = null;
      try {
        prepared = await this.providers.prepared(
          this.view!.bounds,
          abort.signal,
          this.hasAerial(this.view!.bounds)
            ? this.current!.sourceResolutionM
            : Infinity,
          { sensorSpacingM: this.view!.sensorSpacingM },
        );
      } catch (error) {
        abort.signal.throwIfAborted(); /* Continue with remote imagery. */
      }
      if (
        prepared &&
        this.accept(job, prepared, "Prepared aerial image") &&
        (prepared.sourceResolutionM <= plan.sourceResolutionM * 1.05 ||
          resolvesSinglePass(prepared, this.view!.sensorSpacingM ?? 0))
      )
        return;
      abort.signal.throwIfAborted();
      if (!this.hasAerial(this.view!.bounds)) {
        // Do not await an overview: cached or fast full-resolution tiles can
        // finish first, and an overview service failure cannot block them.
        void this.providers
          .overview(plan, previewSignal)
          .then((image) => {
            if (previewSignal.aborted) {
              close(image);
              return;
            }
            if (this.accept(job, image, "Whole-footprint aerial overview"))
              refinement();
          })
          .catch(() => {
            /* The independent refinement remains authoritative. */
          });
      }
      refinement();
      const image = await this.providers.full(plan, abort.signal, (count) => {
        complete = count;
        refinement();
      });
      if (
        this.accept(
          job,
          image,
          `${image.attribution} · ${plan.tiles.length} tiles`,
        )
      )
        this.retry = { key: "", after: 0, attempts: 0 };
      else if (this.job === job && !abort.signal.aborted && this.current)
        this.show(this.current);
    } catch (error) {
      if (this.job === job && !abort.signal.aborted) {
        const attempts =
          this.retry.key === plan.key ? this.retry.attempts + 1 : 1;
        const delay = Math.min(30_000, 2000 * 2 ** (attempts - 1));
        this.retry = { key: plan.key, after: this.now() + delay, attempts };
        this.report({
          state: "error",
          message: `Aerial detail unavailable; retrying in ${delay / 1000}s. ${String(error)}`,
          resolutionM: this.current?.sourceResolutionM,
        });
      }
    } finally {
      previewAbort.abort();
      if (this.job === job) this.job = null;
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.warm?.abort.abort();
    for (const image of this.cache.values()) close(image);
    this.cache.clear();
    this.handoff = null;
  }
}
