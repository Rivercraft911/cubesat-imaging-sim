import { expect, it, vi } from "vitest";
import { imagerySlot } from "./request-slots";

it("bounds overview plus tile work to four slots and removes cancelled queued work", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const task = vi.fn(async () => {
    await gate;
  });
  const signal = new AbortController().signal;
  const running = Array.from({ length: 4 }, () => imagerySlot(signal, task));
  await Promise.resolve();
  expect(task).toHaveBeenCalledTimes(4);
  const abort = new AbortController(),
    queuedTask = vi.fn(async () => {});
  const queued = imagerySlot(abort.signal, queuedTask);
  const cancelled = expect(queued).rejects.toThrow("Obsolete");
  abort.abort(new Error("Obsolete"));
  await cancelled;
  expect(queuedTask).not.toHaveBeenCalled();
  release();
  await Promise.all(running);
  const next = vi.fn(async () => {});
  await imagerySlot(signal, next);
  expect(next).toHaveBeenCalledOnce();
});
