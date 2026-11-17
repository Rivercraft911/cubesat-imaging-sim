import { expect, it, vi } from "vitest";
import type { GroundImage } from "../render";
import { DetailLoader, type DetailView } from "./detail-loader";
import type { Bounds } from "./bounds";
import type { ShotPlan } from "./plan";

const image = (id: string, bounds: Bounds, spacing: number): GroundImage => ({
  id,
  boundsMercator: bounds,
  sourceResolutionM: spacing,
  attribution: id,
  image: { width: 256, height: 256, close: vi.fn() } as unknown as ImageBitmap,
});
const satellite = image("satellite", [-1e8, -1e8, 1e8, 1e8], 19);
const view = (bounds: Bounds): DetailView => ({
  bounds,
  satellite,
  aerial: true,
  desiredPixelM: 1,
  latitudeDeg: 0,
});
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("immediately removes a too-small patch and reuses it when the user returns", async () => {
  const small: Bounds = [100, 100, 900, 900],
    patch = image("prepared", small, 0.6);
  const publish = vi.fn(),
    prepared = vi.fn(async () => patch);
  const loader = new DetailLoader(
    publish,
    vi.fn(),
    {
      prepared,
      overview: vi.fn(),
      full: vi.fn(),
    },
    () => 0,
  );
  loader.update(view(small));
  await settle();
  expect(publish).toHaveBeenLastCalledWith(patch);
  loader.update(view([100, 100, 5000, 4000]), true);
  expect(publish).toHaveBeenLastCalledWith(satellite);
  loader.update(view(small), true);
  expect(publish).toHaveBeenLastCalledWith(patch);
  expect(prepared).toHaveBeenCalledOnce();
  loader.dispose();
});
it("deduplicates compatible work and cancels obsolete work without stale publication", async () => {
  const pending = deferred<GroundImage>();
  let requested!: ShotPlan, signal!: AbortSignal;
  const publish = vi.fn(),
    report = vi.fn();
  const full = vi.fn((plan: ShotPlan, abort: AbortSignal) => {
    requested = plan;
    signal = abort;
    return pending.promise;
  });
  const loader = new DetailLoader(
    publish,
    report,
    {
      prepared: async () => null,
      overview: async (plan) =>
        image("preview", plan.bounds, plan.sourceResolutionM * 2),
      full,
    },
    () => 0,
  );
  loader.update(view([100, 100, 5000, 4000]));
  await settle();
  const reports = report.mock.calls.length,
    publications = publish.mock.calls.length;
  for (let i = 0; i < 10; i++) loader.update(view([150, 150, 5050, 4050]));
  expect(report).toHaveBeenCalledTimes(reports);
  expect(publish).toHaveBeenCalledTimes(publications);
  expect(report.mock.lastCall?.[0].state).toBe("loading");
  expect(full).toHaveBeenCalledOnce();
  expect(signal.aborted).toBe(false);
  loader.update(view([1e6, 1e6, 1e6 + 5000, 1e6 + 4000]), true);
  expect(signal.aborted).toBe(true);
  expect(publish).toHaveBeenLastCalledWith(satellite);
  const stale = image("stale", requested.bounds, requested.sourceResolutionM);
  pending.resolve(stale);
  await settle();
  expect(publish).not.toHaveBeenCalledWith(stale);
  expect((stale.image as ImageBitmap).close).toHaveBeenCalledOnce();
  loader.dispose();
});
it("retries a failed refinement while retaining its whole-footprint overview", async () => {
  let now = 0;
  const full = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary service failure"))
    .mockImplementation(async (plan: ShotPlan) =>
      image("complete", plan.bounds, plan.sourceResolutionM),
    );
  const publish = vi.fn(),
    report = vi.fn();
  const loader = new DetailLoader(
    publish,
    report,
    {
      prepared: async () => null,
      overview: async (plan) =>
        image("overview", plan.bounds, plan.sourceResolutionM * 2),
      full,
    },
    () => now,
  );
  const shot = view([100, 100, 5000, 4000]);
  loader.update(shot);
  await settle();
  expect(report.mock.lastCall?.[0].state).toBe("error");
  expect(publish.mock.lastCall?.[0].id).toBe("overview");
  now = 1000;
  loader.update(shot);
  expect(full).toHaveBeenCalledOnce();
  now = 2500;
  loader.update(shot);
  await settle();
  expect(full).toHaveBeenCalledTimes(2);
  expect(publish.mock.lastCall?.[0].id).toBe("complete");
  loader.dispose();
});
