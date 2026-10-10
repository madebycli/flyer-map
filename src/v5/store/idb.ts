import type { NotePersisted, NotePersistence } from '../notes/types.ts';
import type { Persisted, Persistence } from './types.ts';
import { diag } from '../diag/index.ts';

/** An IndexedDB failure is the one that loses offline work: it is always logged, with the browser's error name (QuotaExceededError, …). */
const failure = (what: string, error: unknown) => {
  const name = (error as { name?: string } | null)?.name ?? 'Error';
  diag.error('store', `${what} failed`, { kind: name, message: (error as { message?: string } | null)?.message });
  diag.inc(`idb.failed.${what}`);
};

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
    const done = diag.start('idb.load_ms');
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
      done();
      if (!box || box.version !== 1) return null;
      return { ...box, overlay: (overlay as Persisted['overlay'] | undefined) ?? [] };
    } catch (error) { failure('idb load', error); return null; }
  }

  async save(data: Persisted, scope: 'all' | 'outbox'): Promise<void> {
    const done = diag.start(`idb.save.${scope}_ms`);
    try {
      const db = await this.open();
      await new Promise<void>((resolve) => {
        const tx = db.transaction('state', 'readwrite');
        const { overlay, ...outbox } = data;
        tx.objectStore('state').put(outbox, 'outbox');
        if (scope === 'all') tx.objectStore('state').put(overlay, 'overlay');
        tx.oncomplete = () => { db.close(); done(); diag.inc(`idb.saved.${scope}`); if (scope === 'all') diag.set('idb.overlayEntries', overlay.length); diag.set('idb.pending', outbox.pending.length); resolve(); };
        tx.onerror = tx.onabort = () => { failure(`idb save ${scope}`, tx.error); db.close(); resolve(); };
      });
    } catch (error) { failure(`idb save ${scope}`, error); /* storage unavailable (private mode): run memory-only */ }
  }
}

/** Notes live in the same database (record `notes`), so one origin-local store per Aktion holds everything offline. */
export class IndexedDbNotePersistence implements NotePersistence {
  constructor(private readonly name: string) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`vf-v5-${this.name}`, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load(): Promise<NotePersisted | null> {
    try {
      const db = await this.open();
      const value = await new Promise<unknown>((resolve) => {
        const request = db.transaction('state').objectStore('state').get('notes');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      });
      db.close();
      const saved = value as NotePersisted | undefined;
      return saved && saved.version === 1 ? saved : null;
    } catch (error) { failure('idb notes load', error); return null; }
  }

  async save(data: NotePersisted): Promise<void> {
    try {
      const db = await this.open();
      await new Promise<void>((resolve) => {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(data, 'notes');
        tx.oncomplete = () => { db.close(); diag.inc('idb.saved.notes'); resolve(); };
        tx.onerror = tx.onabort = () => { failure('idb notes save', tx.error); db.close(); resolve(); };
      });
    } catch (error) { failure('idb notes save', error); /* memory-only */ }
  }
}
