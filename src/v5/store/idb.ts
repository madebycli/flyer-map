import type { Persisted, Persistence } from './types.ts';

/** Single-record IndexedDB persistence; every failure degrades to "no persistence". */
export class IndexedDbPersistence implements Persistence {
  constructor(private readonly name: string) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`vf-v5-${this.name}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load(): Promise<Persisted | null> {
    try {
      const db = await this.open();
      const read = (key: string) => new Promise<unknown>((resolve) => {
        const request = db.transaction('state').objectStore('state').get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      });
      const [overlay, outbox] = await Promise.all([read('overlay'), read('outbox')]);
      db.close();
      const box = outbox as Omit<Persisted, 'overlay'> | undefined;
      if (!box || box.version !== 1) return null;
      return { ...box, overlay: (overlay as Persisted['overlay'] | undefined) ?? [] };
    } catch { return null; }
  }

  async save(data: Persisted, scope: 'all' | 'outbox'): Promise<void> {
    try {
      const db = await this.open();
      await new Promise<void>((resolve) => {
        const tx = db.transaction('state', 'readwrite');
        const { overlay, ...outbox } = data;
        tx.objectStore('state').put(outbox, 'outbox');
        if (scope === 'all') tx.objectStore('state').put(overlay, 'overlay');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = tx.onabort = () => { db.close(); resolve(); };
      });
    } catch { /* storage unavailable (private mode): run memory-only */ }
  }
}
