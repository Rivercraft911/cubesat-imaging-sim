const NAME = "field-of-view-imagery-v1";
const DISK_LIMIT = 120 * 1024 * 1024;
const MEMORY_LIMIT = 32 * 1024 * 1024;
type Metadata = { key: string; size: number; used: number };
const memory = new Map<string, Blob>();
let connection: Promise<IDBDatabase> | undefined;

function remember(key: string, blob: Blob) {
  memory.delete(key);
  memory.set(key, blob);
  let bytes = [...memory.values()].reduce((sum, item) => sum + item.size, 0);
  for (const [oldKey, item] of memory) {
    if (bytes <= MEMORY_LIMIT) break;
    memory.delete(oldKey);
    bytes -= item.size;
  }
}
function database(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("images"))
        db.createObjectStore("images", { keyPath: "key" });
      else request.transaction!.objectStore("images").clear();
      if (!db.objectStoreNames.contains("metadata"))
        db.createObjectStore("metadata", { keyPath: "key" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
  });
  return connection;
}

export async function cachedImage(key: string): Promise<Blob | null> {
  const resident = memory.get(key);
  if (resident) {
    remember(key, resident);
    return resident;
  }
  try {
    const db = await database();
    return await new Promise((resolve) => {
      const tx = db.transaction(["images", "metadata"], "readwrite");
      const request = tx.objectStore("images").get(key);
      request.onsuccess = () => {
        const blob: Blob | undefined = request.result?.blob;
        if (blob) {
          remember(key, blob);
          tx.objectStore("metadata").put({
            key,
            size: blob.size,
            used: Date.now(),
          } satisfies Metadata);
        }
        resolve(blob ?? null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Eviction reads small metadata rows, never clones all cached image blobs. */
export async function cacheImage(key: string, blob: Blob): Promise<void> {
  if (blob.size > DISK_LIMIT / 2) return;
  remember(key, blob);
  try {
    const db = await database();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(["images", "metadata"], "readwrite");
      const images = tx.objectStore("images"),
        metadata = tx.objectStore("metadata");
      const request = metadata.getAll();
      request.onsuccess = () => {
        const rows = request.result as Metadata[];
        let size = rows
          .filter((row) => row.key !== key)
          .reduce((sum, row) => sum + row.size, blob.size);
        for (const row of rows.sort((a, b) => a.used - b.used)) {
          if (size <= DISK_LIMIT) break;
          if (row.key !== key) {
            images.delete(row.key);
            metadata.delete(row.key);
            size -= row.size;
          }
        }
        images.put({ key, blob });
        metadata.put({
          key,
          size: blob.size,
          used: Date.now(),
        } satisfies Metadata);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => resolve();
    });
  } catch {
    /* Persistent browser storage is optional. */
  }
}
