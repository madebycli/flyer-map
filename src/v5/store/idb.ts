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
      return await new Promise((resolve) => {
        const request = db.transaction('state').objectStore('state').get('main');
        request.onsuccess = () => { db.close(); resolve((request.result as Persisted | undefined) ?? null); };
        request.onerror = () => { db.close(); resolve(null); };
      });
    } catch { return null; }
  }

  async save(data: Persisted): Promise<void> {
    try {
      const db = await this.open();
      await new Promise<void>((resolve) => {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(data, 'main');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = tx.onabort = () => { db.close(); resolve(); };
      });
    } catch { /* storage unavailable (private mode): run memory-only */ }
  }
}
