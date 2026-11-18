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

it("publishes fast full imagery without waiting for an overview, and closes a late coarse result", async () => {
  const preview = deferred<GroundImage>();
  let plan!: ShotPlan, previewSignal!: AbortSignal;
  const publish = vi.fn(),
    report = vi.fn();
  const loader = new DetailLoader(
    publish,
    report,
    {
      prepared: async () => null,
      overview: (request, signal) => {
        plan = request;
        previewSignal = signal;
        return preview.promise;
      },
      full: async (request) =>
        image("fast-full", request.bounds, request.sourceResolutionM),
    },
    () => 0,
  );
  loader.update(view([100, 100, 5000, 4000]));
  await settle();
  expect(publish.mock.lastCall?.[0].id).toBe("fast-full");
  expect(report.mock.lastCall?.[0].state).toBe("ready");
  expect(previewSignal.aborted).toBe(true);
  const coarse = image(
    "late-overview",
    plan.bounds,
    plan.sourceResolutionM * 2,
  );
  preview.resolve(coarse);
  await settle();
  expect(publish.mock.lastCall?.[0].id).toBe("fast-full");
  expect((coarse.image as ImageBitmap).close).toHaveBeenCalledOnce();
  loader.dispose();
});

it("an overview failure cannot prevent full refinement", async () => {
  const publish = vi.fn(),
    full = vi.fn(async (plan: ShotPlan) =>
      image("full", plan.bounds, plan.sourceResolutionM),
    );
  const loader = new DetailLoader(
    publish,
    vi.fn(),
    {
      prepared: async () => null,
      overview: async () => {
        throw new Error("Overview timed out");
      },
      full,
    },
    () => 0,
  );
  loader.update(view([100, 100, 5000, 4000]));
  await settle();
  expect(full).toHaveBeenCalledOnce();
  expect(publish.mock.lastCall?.[0].id).toBe("full");
  loader.dispose();
});

it("replaces covering medium imagery with a finer prepared asset without a remote request", async () => {
  const bounds: Bounds = [100, 100, 5000, 4000];
  const medium = image("medium-local", bounds, 7),
    fine = image("fine-local", bounds, 1.5);
  const prepared = vi
    .fn()
    .mockResolvedValueOnce(medium)
    .mockResolvedValueOnce(fine);
  const publish = vi.fn(),
    overview = vi.fn(),
    full = vi.fn();
  const loader = new DetailLoader(
    publish,
    vi.fn(),
    { prepared, overview, full },
    () => 0,
  );
  loader.update({ ...view(bounds), desiredPixelM: 8 });
  await settle();
  expect(publish.mock.lastCall?.[0]).toBe(medium);
  loader.update({ ...view(bounds), desiredPixelM: 2 });
  await settle();
  expect(prepared).toHaveBeenCalledTimes(2);
  expect(prepared.mock.lastCall?.[2]).toBe(7);
  expect(publish.mock.lastCall?.[0]).toBe(fine);
  expect(overview).not.toHaveBeenCalled();
  expect(full).not.toHaveBeenCalled();
  loader.dispose();
});

it("warms a prepared image without showing its edges and publishes it immediately at zoom", async () => {
  const zoomed: Bounds = [100, 100, 900, 900];
  const wider: Bounds = [0, 0, 1000, 1000];
  const warm = deferred<GroundImage>();
  const patch = image("prepared", zoomed, 0.6);
  const prepared = vi.fn<typeof import("./provider").preparedShot>(() => warm.promise),
    full = vi.fn(),
    overview = vi.fn(),
    publish = vi.fn();
  const loader = new DetailLoader(
    publish,
    vi.fn(),
    { prepared, overview, full },
    () => 0,
  );
  loader.update({ ...view(wider), aerial: false });
  loader.prefetch(zoomed);
  loader.prefetch(zoomed);
  expect(prepared).toHaveBeenCalledOnce();
  expect(prepared.mock.lastCall?.[3]).toMatchObject({ prefetch: true });
  warm.resolve(patch);
  await settle();
  expect(publish.mock.calls).toEqual([[satellite]]);
  loader.update(view(zoomed), true);
  expect(publish.mock.lastCall?.[0]).toBe(patch);
  loader.update(view(wider), true);
  expect(publish.mock.lastCall?.[0]).toBe(satellite);
  expect(overview).not.toHaveBeenCalled();
  expect(full).not.toHaveBeenCalled();
  loader.dispose();
});

it("reuses a pending prefetch after the zoom and discards a prefetch from a replaced aim", async () => {
  const oldBounds: Bounds = [100, 100, 900, 900];
  const newBounds: Bounds = [1400, 1400, 2200, 2200];
  const old = deferred<GroundImage>();
  const next = deferred<GroundImage>();
  const prepared = vi
    .fn<typeof import("./provider").preparedShot>()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise);
  const full = vi.fn(), publish = vi.fn();
  const loader = new DetailLoader(
    publish,
    vi.fn(),
    { prepared, overview: vi.fn(), full },
    () => 300,
  );
  loader.prefetch(oldBounds);
  loader.prefetch(newBounds);
  expect(prepared.mock.calls[0][1].aborted).toBe(true);
  loader.update(view(newBounds));
  const obsolete = image("obsolete", oldBounds, 0.6);
  const nearby = image("nearby", newBounds, 0.6);
  old.resolve(obsolete);
  next.resolve(nearby);
  await settle();
  expect((obsolete.image as ImageBitmap).close).toHaveBeenCalledOnce();
  expect(publish.mock.calls).toEqual([[satellite], [nearby]]);
  expect(prepared).toHaveBeenCalledTimes(2);
  expect(full).not.toHaveBeenCalled();
  loader.dispose();
});

it("prefers adequate single-pass coverage over finer imagery with acquisition seams", async () => {
  const bounds: Bounds = [100, 100, 49000, 49000];
  const samePass = { ...image("same-pass", bounds, 10), singlePass: true };
  const fine = image("finer", bounds, 7);
  const prepared = vi.fn<typeof import("./provider").preparedShot>()
    .mockResolvedValueOnce(samePass)
    .mockResolvedValueOnce(fine);
  const full = vi.fn(), publish = vi.fn();
  const loader = new DetailLoader(
    publish,
    vi.fn(),
    { prepared, overview: vi.fn(), full },
    () => 0,
  );
  const wider = { ...view(bounds), sensorSpacingM: 11, desiredPixelM: 7.33 };
  loader.prefetch(bounds, wider.sensorSpacingM);
  await settle();
  loader.update(wider);
  expect(publish.mock.lastCall?.[0]).toBe(samePass);

  loader.update({ ...wider, sensorSpacingM: 9, desiredPixelM: 6 });
  await settle();
  expect(publish.mock.lastCall?.[0]).toBe(fine);

  loader.update(wider);
  expect(publish.mock.lastCall?.[0]).toBe(samePass);
  expect(prepared).toHaveBeenCalledTimes(2);
  expect(full).not.toHaveBeenCalled();
  loader.dispose();
});

it("withdraws uncovered imagery before the next network poll", async () => {
  const zoomed: Bounds = [100, 100, 900, 900];
  const wider: Bounds = [0, 0, 5000, 5000];
  const local = { ...image("local", zoomed, 7), singlePass: true };
  const publish = vi.fn();
  const full = vi.fn();
  const loader = new DetailLoader(
    publish,
    vi.fn(),
    { prepared: async () => local, overview: vi.fn(), full },
    () => 0,
  );
  loader.update({ ...view(zoomed), desiredPixelM: 8 });
  await settle();
  expect(publish.mock.lastCall?.[0]).toBe(local);
  loader.track(view(wider));
  expect(publish.mock.lastCall?.[0]).toBe(satellite);
  expect(full).not.toHaveBeenCalled();
  loader.dispose();
});

it("closes a pending mosaic when the frame advances outside it between polls", async () => {
  const original = view([100, 100, 900, 900]);
  const newView = view([100000, 100000, 101000, 101000]);
  const remote = deferred<GroundImage>();
  const full = vi.fn<typeof import("./provider").shotImage>(() => remote.promise);
  const publish = vi.fn();
  const loader = new DetailLoader(
    publish,
    vi.fn(),
    { prepared: async () => null, overview: vi.fn(async () => { throw Error(); }), full },
    () => 0,
  );
  loader.update(original);
  await settle();
  expect(full).toHaveBeenCalledOnce();
  loader.track(newView);
  expect(full.mock.calls[0][1].aborted).toBe(true);
  const stale = image("stale", original.bounds, 1);
  remote.resolve(stale);
  await settle();
  expect((stale.image as ImageBitmap).close).toHaveBeenCalledOnce();
  expect(publish.mock.calls).toEqual([[satellite]]);
  expect(full).toHaveBeenCalledOnce();
  loader.dispose();
});

it("uses the covering crop with more margin when cached sources have the same resolution", async () => {
  const left = image("left", [0, 0, 1200, 2000], 1);
  const right = image("right", [600, 0, 2200, 2000], 1);
  const prepared = vi.fn().mockResolvedValueOnce(left).mockResolvedValueOnce(right);
  const publish = vi.fn();
  const loader = new DetailLoader(publish, vi.fn(), { prepared, overview: vi.fn(), full: vi.fn() });
  loader.update(view([100, 400, 500, 800]));
  await settle();
  loader.update(view([1600, 400, 2000, 800]));
  await settle();
  // Both crops cover the footprint. Its east edge touches the older crop.
  loader.track(view([800, 400, 1200, 800]));
  expect(publish.mock.lastCall?.[0]).toBe(right);
  loader.dispose();
});

it("warms the next local crop during playback while remote refinement is unavailable", async () => {
  const outgoing = image("outgoing", [0, 0, 1200, 1200], 1.5);
  const incoming = image("incoming", [-500, -500, 2000, 2000], 1.5);
  const decode = deferred<GroundImage>();
  const prepared = vi.fn<typeof import("./provider").preparedShot>()
    .mockResolvedValueOnce(outgoing)
    .mockReturnValueOnce(decode.promise);
  const failed = vi.fn(async () => { throw new Error("offline"); });
  const publish = vi.fn();
  const loader = new DetailLoader(publish, vi.fn(), { prepared, full: failed, overview: failed });
  const opening = view([100, 100, 900, 900]);
  loader.update(opening);
  await settle();
  expect(publish.mock.lastCall?.[0]).toBe(outgoing);
  const predicted: Bounds = [100, 100, 1250, 1250];
  loader.prefetchMotion([{ bounds: predicted, sensorSpacingM: 1 }]);
  loader.prefetchMotion([{ bounds: [90, 90, 1300, 1300], sensorSpacingM: 1 }]);
  expect(prepared).toHaveBeenCalledTimes(2);
  expect(prepared.mock.lastCall?.[2]).toBe(Infinity);
  expect(prepared.mock.lastCall?.[1].aborted).toBe(false);
  loader.track(view([100, 100, 1100, 1100]));
  expect(publish.mock.lastCall?.[0]).toBe(outgoing);
  decode.resolve(incoming);
  await settle();
  loader.track(view([100, 100, 1195, 1195]));
  loader.track(view(predicted));
  expect(publish.mock.calls.map(([raster]) => raster.id)).toEqual(["satellite", "outgoing", "incoming"]);
  loader.dispose();
});

it("warms finer inbound coverage even when coarse imagery covers the entire pass", async () => {
  const broad = image("broad", [-5000, -5000, 5000, 5000], 10);
  const fine = image("fine", [-500, -500, 500, 500], 1);
  const publish = vi.fn();
  let now = 0;
  const prepared = vi.fn<typeof import("./provider").preparedShot>()
    .mockResolvedValueOnce(broad)
    .mockImplementation(async (_bounds, _signal, _spacing, options) =>
      options?.needsSource?.(fine) ? fine : null);
  const failed = vi.fn(async () => { throw new Error("offline"); });
  const loader = new DetailLoader(publish, vi.fn(), { prepared, full: failed, overview: failed }, () => now);
  loader.update(view([-1000, -1000, 1000, 1000]));
  await settle();
  const ahead: Bounds = [-200, -200, 200, 200];
  loader.prefetchMotion([{ bounds: ahead, sensorSpacingM: 1 }]);
  await settle();
  loader.track(view(ahead));
  expect(publish.mock.lastCall?.[0]).toBe(fine);
  now = 1000;
  loader.prefetchMotion([{ bounds: ahead, sensorSpacingM: 1 }]);
  await settle();
  expect(prepared.mock.lastCall?.[3]?.needsSource?.(fine)).toBe(false);
  loader.dispose();
});

it("keeps one large standby raster until its outgoing predecessor is released", async () => {
  const opening = view([0, 0, 1000, 1000]);
  const next = view([1500, 1500, 2500, 2500]);
  const outgoing = image("large-outgoing", [-500, -500, 1300, 1300], 1);
  const incoming = image("large-incoming", [1100, 1100, 3000, 3000], 1);
  for (const item of [outgoing, incoming])
    Object.assign(item.image, { width: 6000, height: 6000 });
  const prepared = vi.fn<typeof import("./provider").preparedShot>()
    .mockResolvedValueOnce(outgoing).mockResolvedValueOnce(incoming);
  const publish = vi.fn();
  const loader = new DetailLoader(publish, vi.fn(), { prepared, overview: vi.fn(), full: vi.fn() });
  loader.update(opening);
  await settle();
  loader.prefetchMotion([{ bounds: next.bounds, sensorSpacingM: 1 }]);
  await settle();
  expect((incoming.image as ImageBitmap).close).not.toHaveBeenCalled();
  loader.track(next);
  expect(publish.mock.lastCall?.[0]).toBe(incoming);
  expect((outgoing.image as ImageBitmap).close).toHaveBeenCalledOnce();
  loader.dispose();
});

it("switches between overlapping NAIP resolutions before their whole-frame edge fade", async () => {
  const campus = image("cdfw-naip-2022-campus", [0, 0, 1000, 1000], 0.6);
  const wider = image("cdfw-naip-2022-wider", [-300, -300, 1600, 1600], 1.5);
  const prepared = vi.fn().mockResolvedValueOnce(campus).mockResolvedValueOnce(wider);
  const full = vi.fn();
  const publish = vi.fn();
  const loader = new DetailLoader(publish, vi.fn(), { prepared, overview: vi.fn(), full });
  const centered = view([250, 250, 750, 750]);
  loader.update(centered);
  await settle();
  loader.prefetchMotion([{ bounds: [0, 0, 1100, 1100], sensorSpacingM: 0.8 }]);
  await settle();
  // The campus image still covers every ray, but its east edge would blur the entire frame.
  loader.track(view([150, 150, 985, 850]));
  loader.track(centered);
  expect(publish.mock.calls.map(([item]) => item.id)).toEqual([
    "satellite", campus.id, wider.id, campus.id,
  ]);
  expect(full).not.toHaveBeenCalled();
  loader.dispose();
});

it("warms the nearest missing crop before a farther source at fast playback", async () => {
  const a = image("a", [-300, -300, 1100, 1100], 0.6);
  const b = image("b", [-300, -300, 1600, 1600], 1.5);
  const c = image("c", [-300, -300, 4000, 4000], 7);
  const decoded: string[] = [];
  const prepared: typeof import("./provider").preparedShot = async (bounds, _signal, finerThan = Infinity, options) => {
    const source = [a, b, c].find(item => item.boundsMercator[2] >= bounds[2])!;
    if (source.sourceResolutionM >= finerThan || options?.needsSource?.(source) === false) return null;
    decoded.push(source.id);
    return source;
  };
  const loader = new DetailLoader(vi.fn(), vi.fn(), { prepared, overview: vi.fn(), full: vi.fn() });
  const opening = view([0, 0, 900, 900]);
  const near = view([0, 0, 1400, 1400]);
  const far = view([0, 0, 2200, 2200]);
  const forecast = [opening, near, far].map(({ bounds }) => ({ bounds, sensorSpacingM: 1 }));
  loader.update(opening);
  await settle();
  loader.prefetchMotion(forecast);
  await settle();
  loader.prefetchMotion(forecast);
  await settle();
  expect(decoded).toEqual(["a", "b"]);
  loader.track(near);
  loader.prefetchMotion(forecast.slice(1));
  await settle();
  expect(decoded).toEqual(["a", "b", "c"]);
  loader.dispose();
});
