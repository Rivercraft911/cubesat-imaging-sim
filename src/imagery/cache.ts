const NAME = 'field-of-view-imagery-v1';
const LIMIT = 120 * 1024 * 1024;
type Row = { key: string; blob: Blob; used: number };

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cachedImage(key: string): Promise<Blob | null> {
  try {
    const db = await database();
    return await new Promise(resolve => {
      const req = db.transaction('images').objectStore('images').get(key);
      req.onsuccess = () => { resolve((req.result as Row | undefined)?.blob ?? null); db.close(); };
      req.onerror = () => { resolve(null); db.close(); };
    });
  } catch { return null; }
}

export async function cacheImage(key: string, blob: Blob): Promise<void> {
  if (blob.size > LIMIT / 2) return;
  try {
    const db = await database();
    const rows = await new Promise<Row[]>(resolve => {
      const req = db.transaction('images').objectStore('images').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
    const tx = db.transaction('images', 'readwrite'), store = tx.objectStore('images');
    let size = rows.filter(r => r.key !== key).reduce((sum, r) => sum + r.blob.size, blob.size);
    for (const row of rows.sort((a, b) => a.used - b.used)) {
      if (size <= LIMIT) break;
      if (row.key !== key) { store.delete(row.key); size -= row.blob.size; }
    }
    store.put({ key, blob, used: Date.now() } satisfies Row);
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
    db.close();
  } catch { /* Browser storage is optional; network imagery remains usable. */ }
}
