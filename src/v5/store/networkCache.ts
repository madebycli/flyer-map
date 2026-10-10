import { ENGINE_VERSION } from '../engine/index.ts';
import { diag } from '../diag/index.ts';

/** What a derived network was built from. Any change in these makes the cached copy unusable. */
export type NetworkKey = { areaId: string; packVersion: number; updatedAt: string; engine: string };
/** The engine's own binary snapshot of an Area (geometry included): one ArrayBuffer, no object graph to clone. */
type Entry = { key: NetworkKey; blob: Uint8Array };

export interface NetworkStorage {
  get(id: string): Promise<Entry | undefined>;
  put(id: string, entry: Entry): Promise<void>;
  delete(id: string): Promise<void>;
}

export const sameKey = (a: NetworkKey, b: NetworkKey) => a.areaId === b.areaId && a.packVersion === b.packVersion && a.updatedAt === b.updatedAt && a.engine === b.engine;

/**
 * Derived Area snapshots kept on the device. Re-opening an Aktion then skips the pack download and the derivation
 * — the two slowest steps of a cold start — and only pays for Areas whose pack, polygon or engine version changed.
 */
export class NetworkCache {
  constructor(private readonly campaignId: string, private readonly storage: NetworkStorage | null) {}

  private id(areaId: string) { return `${this.campaignId}:${areaId}`; }

  static keyFor(area: { id: string; packVersion: number | null; updatedAt: string }): NetworkKey | null {
    return area.packVersion === null ? null : { areaId: area.id, packVersion: area.packVersion, updatedAt: area.updatedAt, engine: ENGINE_VERSION };
  }

  async load(key: NetworkKey): Promise<Uint8Array | null> {
    const done = diag.start('cache.load_ms');
    try {
      const entry = await this.storage?.get(this.id(key.areaId));
      const hit = entry && sameKey(entry.key, key) ? entry.blob : null;
      if (hit) { diag.inc('cache.hit'); diag.observe('cache.hit.bytes', hit.byteLength); }
      else { diag.inc('cache.miss'); diag.debug('cache', entry ? 'cached network is stale (pack, polygon or engine changed)' : 'no cached network', { stale: !!entry }); }
      return hit;
    } catch (error) { diag.inc('cache.load.failed'); diag.warn('cache', 'reading the network cache failed', { error }); return null; } finally { done(); }
  }

  async store(key: NetworkKey, blob: Uint8Array): Promise<void> {
    const done = diag.start('cache.store_ms');
    try { await this.storage?.put(this.id(key.areaId), { key, blob }); diag.inc('cache.stored'); diag.observe('cache.store.bytes', blob.byteLength); }
    catch (error) { diag.inc('cache.store.failed'); diag.warn('cache', 'writing the network cache failed (quota or private mode): the next start derives again', { error, bytes: blob.byteLength }); /* quota or private mode: just no cache */ }
    finally { done(); }
  }

  async forget(areaId: string): Promise<void> {
    try { await this.storage?.delete(this.id(areaId)); diag.inc('cache.forgot'); } catch { /* ignore */ }
  }
}

export class MemoryNetworkStorage implements NetworkStorage {
  readonly map = new Map<string, Entry>();
  async get(id: string) { const hit = this.map.get(id); return hit ? structuredClone(hit) : undefined; }
  async put(id: string, entry: Entry) { this.map.set(id, structuredClone(entry)); }
  async delete(id: string) { this.map.delete(id); }
}

export class IndexedDbNetworkStorage implements NetworkStorage {
  private db: Promise<IDBDatabase> | null = null;
  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('vf-v5-networks', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('networks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }
  private async run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('networks', mode);
      const request = fn(tx.objectStore('networks'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  get(id: string) { return this.run('readonly', (s) => s.get(id) as IDBRequest<Entry | undefined>); }
  async put(id: string, entry: Entry) { await this.run('readwrite', (s) => s.put(entry, id)); }
  async delete(id: string) { await this.run('readwrite', (s) => s.delete(id)); }
}
