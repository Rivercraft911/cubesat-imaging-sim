/** One global bound includes overview and refinement requests. Queued obsolete
 * requests leave immediately when their owning view is cancelled. */
const LIMIT = 4;
let active = 0;
const waiting: { start(): void }[] = [];
function pump() {
  while (active < LIMIT && waiting.length) waiting.shift()!.start();
}

export function imagerySlot<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const entry = {
      start: () => {
        signal.removeEventListener("abort", cancel);
        active++;
        void Promise.resolve()
          .then(operation)
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      },
    };
    const cancel = () => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal.reason);
    };
    waiting.push(entry);
    signal.addEventListener("abort", cancel, { once: true });
    pump();
  });
}
