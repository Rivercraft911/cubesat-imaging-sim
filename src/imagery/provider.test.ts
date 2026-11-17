import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bounds } from "./bounds";

const bounds: Bounds = [20, 20, 80, 80];
const manifestUrl = "/cubesat-imaging-sim/assets/shots/manifest.json";
const rasterUrl = "/cubesat-imaging-sim/assets/shots/prepared.webp";
const entry = {
  id: "prepared",
  file: "prepared.webp",
  width: 100,
  height: 100,
  boundsMercator: [0, 0, 100, 100],
  sourceResolutionM: 1,
  attribution: "prepared",
  transparentPixels: 0,
};
let preparedShot: typeof import("./provider").preparedShot;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("BASE_URL", "/cubesat-imaging-sim/");
  ({ preparedShot } = await import("./provider"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stalledResponse(signal: AbortSignal, onRead?: () => void): Response {
  return new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
    pull: onRead,
  }, { highWaterMark: 0 }));
}

it.each([
  { failure: "an HTTP error", fetch: async () => new Response(null, { status: 503 }) },
  {
    failure: "a network error",
    fetch: async () => {
      throw new TypeError("Network request failed");
    },
  },
  { failure: "invalid JSON", fetch: async () => new Response("not JSON") },
  { failure: "a non-array response", fetch: async () => Response.json({}) },
])("retries the prepared index after $failure", async ({ fetch }) => {
  const request = vi.fn<typeof globalThis.fetch>()
    .mockImplementationOnce(fetch)
    .mockResolvedValueOnce(Response.json([entry]))
    .mockImplementation(async () => new Response());
  const bitmap = { width: 72, height: 72, close: vi.fn() };
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  const signal = new AbortController().signal;

  await expect(preparedShot(bounds, signal)).resolves.toBeNull();
  await expect(preparedShot(bounds, signal)).resolves.toMatchObject({ image: bitmap });
  await expect(preparedShot(bounds, signal)).resolves.toMatchObject({ image: bitmap });

  expect(request.mock.calls.map(([url]) => url)).toEqual([
    manifestUrl,
    manifestUrl,
    rasterUrl,
    rasterUrl,
  ]);
});

it("falls back when the manifest times out and can retry", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
  const request = vi.fn<typeof fetch>()
    .mockImplementationOnce(async (_url, init) => stalledResponse(init!.signal!))
    .mockResolvedValueOnce(Response.json([]));
  vi.stubGlobal("fetch", request);
  const signal = new AbortController().signal;

  const first = preparedShot(bounds, signal);
  expect(timeout).toHaveBeenCalledWith(3000);
  expect(request).toHaveBeenCalledWith(manifestUrl, { signal: deadline.signal });
  deadline.abort(new DOMException("Request timed out", "TimeoutError"));
  await expect(first).resolves.toBeNull();
  await expect(preparedShot(bounds, signal)).resolves.toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});

it("lets one waiting view cancel without aborting the shared manifest", async () => {
  let resolveManifest!: (response: Response) => void;
  const manifest = new Promise<Response>((resolve) => {
    resolveManifest = resolve;
  });
  const request = vi.fn<typeof fetch>(() => manifest);
  vi.stubGlobal("fetch", request);
  const cancelled = new AbortController();
  const active = new AbortController();

  const obsolete = preparedShot(bounds, cancelled.signal);
  const current = preparedShot(bounds, active.signal);
  cancelled.abort();
  await expect(obsolete).rejects.toBe(cancelled.signal.reason);
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false);

  resolveManifest(Response.json([]));
  await expect(current).resolves.toBeNull();
  await expect(preparedShot(bounds, active.signal)).resolves.toBeNull();
  expect(request).toHaveBeenCalledOnce();
});

it.each(["timeout", "caller cancellation"])(
  "can retry a stalled prepared raster after %s",
  async (failure) => {
    const deadline = new AbortController();
    const caller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(new AbortController().signal)
      .mockReturnValueOnce(deadline.signal);
    let beginRead!: () => void;
    const reading = new Promise<void>((resolve) => {
      beginRead = resolve;
    });
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([entry]))
      .mockImplementationOnce(async (_url, init) => stalledResponse(init!.signal!, beginRead))
      .mockResolvedValueOnce(new Response());
    const decode = vi.fn().mockResolvedValue({ width: 72, height: 72, close: vi.fn() });
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("createImageBitmap", decode);

    const first = preparedShot(bounds, caller.signal);
    await reading;
    expect(timeout).toHaveBeenLastCalledWith(20_000);
    const source = failure === "timeout" ? deadline : caller;
    source.abort();
    await expect(first).rejects.toBe(source.signal.reason);
    expect(decode).not.toHaveBeenCalled();

    await expect(preparedShot(bounds, new AbortController().signal)).resolves.toMatchObject({
      id: "prepared:14:14:86:86",
    });
    expect(request.mock.calls.map(([url]) => url)).toEqual([manifestUrl, rasterUrl, rasterUrl]);
  },
);
