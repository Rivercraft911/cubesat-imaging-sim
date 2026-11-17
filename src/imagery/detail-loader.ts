import type { GroundImage } from "../render";
import { contains, type Bounds } from "./bounds";
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
const close = (image: GroundImage) => {
  if ("close" in image.image) image.image.close();
};

/** A small latest-view scheduler. Incomplete geographic coverage never becomes
 * the displayed aerial level; usable work survives minor pass/focal changes. */
export class DetailLoader {
  private view: DetailView | null = null;
  private current: GroundImage | null = null;
  private cache = new Map<string, GroundImage>();
  private job: Job | null = null;
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
    for (const [key, item] of this.cache) {
      if (bytes <= 192 * 1024 * 1024 && this.cache.size <= 3) break;
      if (item === this.current) continue;
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
  private cached(bounds: Bounds, spacing = Infinity) {
    return [...this.cache.values()]
      .filter(
        (image) =>
          image.image.width > 0 &&
          contains(image.boundsMercator, bounds) &&
          image.sourceResolutionM <= spacing,
      )
      .sort((a, b) => a.sourceResolutionM - b.sourceResolutionM)[0];
  }
  private cancel() {
    this.job?.abort.abort();
    this.job = null;
  }

  update(view: DetailView, geometryChanged = false) {
    if (this.disposed) return;
    this.view = view;
    if (geometryChanged) this.notBefore = this.now() + 180;
    if (!view.aerial) {
      this.cancel();
      this.show(view.satellite);
      return;
    }
    const plan = planShot(view.bounds, view.desiredPixelM, view.latitudeDeg);
    const suitable = this.cached(view.bounds, plan.sourceResolutionM * 1.05);
    if (suitable) {
      this.cancel();
      this.retry = { key: "", after: 0, attempts: 0 };
      this.show(suitable, `${suitable.attribution} · cached`);
      return;
    }
    // Remove a now-too-small aerial rectangle immediately, even during debounce
    // or an outstanding network request. The fallback covers the complete view.
    if (!this.hasAerial(view.bounds))
      this.show(this.cached(view.bounds) ?? view.satellite, undefined, false);
    if (this.job) {
      if (
        contains(this.job.plan.bounds, view.bounds) &&
        this.job.plan.mercatorPixelM <= plan.mercatorPixelM * 1.01
      )
        return;
      this.cancel();
    }
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
    this.remember(image);
    this.show(
      image,
      `${label} · ${((this.now() - job.started) / 1000).toFixed(1)} s`,
    );
    return true;
  }
  private async load(job: Job) {
    const { plan, abort } = job;
    const loading = (message: string) => {
      if (this.job === job && !abort.signal.aborted)
        this.report({
          state: "loading",
          message,
          resolutionM: this.current?.sourceResolutionM,
        });
    };
    try {
      loading("Opening whole-footprint aerial imagery…");
      if (!this.hasAerial(this.view!.bounds)) {
        const prepared = await this.providers.prepared(
          this.view!.bounds,
          abort.signal,
        );
        if (prepared) {
          if (!this.accept(job, prepared, "Prepared aerial image")) return;
          if (prepared.sourceResolutionM <= plan.sourceResolutionM * 1.05)
            return;
        } else {
          const overview = await this.providers.overview(plan, abort.signal);
          if (!this.accept(job, overview, "Whole-footprint aerial overview"))
            return;
          if (overview.sourceResolutionM <= plan.sourceResolutionM * 1.05)
            return;
        }
      }
      loading(`Refining aerial imagery · 0/${plan.tiles.length} tiles`);
      const image = await this.providers.full(
        plan,
        abort.signal,
        (complete, total) => {
          loading(
            `Refining aerial imagery · ${complete}/${total} tiles · ${((this.now() - job.started) / 1000).toFixed(1)} s`,
          );
        },
      );
      if (
        this.accept(
          job,
          image,
          `${image.attribution} · ${plan.tiles.length} tiles`,
        )
      )
        this.retry = { key: "", after: 0, attempts: 0 };
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
      if (this.job === job) this.job = null;
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    for (const image of this.cache.values()) close(image);
    this.cache.clear();
  }
}
