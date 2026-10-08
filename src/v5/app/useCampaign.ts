import { useEffect, useRef, useState } from 'react';
import { mergeNetworks, type Network } from '../engine/index.ts';
import { FieldStore } from '../store/store.ts';
import { IndexedDbNotePersistence, IndexedDbPersistence } from '../store/idb.ts';
import { IndexedDbNetworkStorage, NetworkCache } from '../store/networkCache.ts';
import { NoteStore } from '../notes/store.ts';
import { NoteSync } from '../notes/sync.ts';
import { Progress, type ProgressSnapshot } from '../store/progress.ts';
import { SyncClient } from '../store/syncClient.ts';
import { V5ApiError, buildPack, fetchMeta, fetchPack, httpNoteTransport, httpTransport, type Meta } from './api.ts';
import { derive, type WorkerResponse } from './network.worker.ts';

export type Phase =
  | { kind: 'loading'; label: string }
  | { kind: 'needs-pack'; areas: Meta['areas']; canBuild: boolean }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; status?: number };

export type CampaignState = {
  phase: Phase;
  meta: Meta | null;
  network: Network | null;
  areaOf: Map<string, string>;
  store: FieldStore | null;
  notes: NoteStore | null;
  progress: ProgressSnapshot | null;
  sync: { state: 'idle' | 'syncing' | 'offline'; pending: number };
  /** Areas that are shown without data yet (some other Areas already work). */
  missingAreas: Meta['areas'];
  buildMissing(): Promise<void>;
  /** Re-fetch Areas, packs and status (after an Area was created or reshaped). */
  reload(): Promise<void>;
};

function deriveInWorker(areaId: string, pack: Uint8Array, ring: [number, number][]): Promise<Network> {
  if (typeof Worker === 'undefined') return derive({ areaId, pack, ring });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./network.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if ('error' in event.data) reject(new Error(event.data.error)); else resolve(event.data.network);
    };
    worker.onerror = () => { worker.terminate(); derive({ areaId, pack, ring }).then(resolve, reject); };
    worker.postMessage({ areaId, pack, ring });
  });
}

function actorId(): string {
  try {
    const existing = localStorage.getItem('vf-v5-actor');
    if (existing) return existing;
    const created = `d${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('vf-v5-actor', created);
    return created;
  } catch { return `d${Math.random().toString(36).slice(2, 8)}`; }
}

export function useCampaign(campaignId: string): CampaignState {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', label: 'Aktion wird geladen …' });
  const [meta, setMeta] = useState<Meta | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const [areaOf, setAreaOf] = useState<Map<string, string>>(new Map());
  const [store, setStore] = useState<FieldStore | null>(null);
  const [notes, setNotes] = useState<NoteStore | null>(null);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [sync, setSync] = useState<CampaignState['sync']>({ state: 'idle', pending: 0 });
  const [missingAreas, setMissingAreas] = useState<Meta['areas']>([]);
  const reload = useRef<() => Promise<void>>(async () => {});
  const missingRef = useRef<Meta['areas']>([]);
  const canBuildRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let client: SyncClient | null = null;
    let progressTracker: Progress | null = null;
    let hydrated = false;
    const fieldStore = new FieldStore(actorId(), new IndexedDbPersistence(campaignId));
    const noteStore = new NoteStore(actorId(), new IndexedDbNotePersistence(campaignId), () => Date.now());
    let notesHydrated = false;
    const cache = new NetworkCache(campaignId, typeof indexedDB === 'undefined' ? null : new IndexedDbNetworkStorage());

    const boot = async () => {
      const t0 = performance.now();
      try {
        setPhase({ kind: 'loading', label: 'Aktion wird geladen …' });
        const loaded = await fetchMeta(campaignId);
        if (cancelled) return;
        setMeta(loaded);
        canBuildRef.current = loaded.canBuildPack;
        // Per Area: the cached derived network when pack, polygon and engine are unchanged; otherwise download (all in
        // parallel — the slow part on mobile data) and derive one after another.
        setPhase({ kind: 'loading', label: 'Kartendaten werden geladen …' });
        const timing: Record<string, number> = { meta: Math.round(performance.now() - t0) };
        const resolved = await Promise.all(loaded.areas.map(async (area) => {
          const key = NetworkCache.keyFor(area);
          const cached = key ? await cache.load(key) : null;
          if (cached) return { areaId: area.id, ring: area.geometry.coordinates[0], pack: null as Uint8Array | null, cached, key };
          return { areaId: area.id, ring: area.geometry.coordinates[0], pack: area.packVersion ? await fetchPack(campaignId, area.id) : null, cached: null as Network | null, key };
        }));
        if (cancelled) return;
        timing.packs = Math.round(performance.now() - t0) - timing.meta;
        timing.cacheHits = resolved.filter((r) => r.cached).length;
        const missing = loaded.areas.filter((a) => { const r = resolved.find((p) => p.areaId === a.id); return !r?.pack && !r?.cached; });
        missingRef.current = missing;
        setMissingAreas(missing);
        const parts: { areaId: string; network: Network }[] = [];
        for (const item of resolved) {
          if (item.cached) { parts.push({ areaId: item.areaId, network: item.cached }); continue; }
          if (!item.pack) continue;
          setPhase({ kind: 'loading', label: 'Straßen und Häuser werden berechnet …' });
          const network = await deriveInWorker(item.areaId, item.pack, item.ring);
          parts.push({ areaId: item.areaId, network });
          if (item.key) void cache.store(item.key, network);
          if (cancelled) return;
        }
        timing.derive = Math.round(performance.now() - t0) - timing.meta - timing.packs;
        const merged = mergeNetworks(parts);
        fieldStore.setAreaResolver((key) => merged.areaOf.get(key));
        if (!hydrated) { await Promise.all([fieldStore.hydrate(), noteStore.hydrate()]); hydrated = true; notesHydrated = true; }
        if (cancelled) return; // a boot cancelled while hydrating must not create clients nobody disposes
        // Only prune when every Area was derived; a missing pack must never cost queued edits.
        if (!missing.length) fieldStore.reconcilePending((key) => merged.areaOf.has(key));
        progressTracker?.dispose();
        progressTracker = new Progress(merged.network, fieldStore);
        progressTracker.onChange(setProgress);
        setProgress(progressTracker.snapshot());
        setNetwork(merged.network); setAreaOf(merged.areaOf); setStore(fieldStore); setNotes(noteStore);
        client?.dispose();
        client = new SyncClient(fieldStore, httpTransport(campaignId), 100, (state, pending) => setSync({ state, pending }), [new NoteSync(noteStore, httpNoteTransport(campaignId))]);
        // Show the screen once the first pull settled (or after 4 s on a slow link), so a fresh device does not
        // flash 0 % before the shared progress arrives.
        if (parts.length) setPhase({ kind: 'loading', label: 'Fortschritt wird geladen …' });
        await Promise.race([client.run(), new Promise((resolve) => setTimeout(resolve, 4000))]);
        if (cancelled) return;
        timing.ready = Math.round(performance.now() - t0);
        (window as unknown as { __v5Boot?: Record<string, number> }).__v5Boot = timing;
        if (location.search.includes('debug')) console.info('[v5 boot ms]', JSON.stringify(timing));
        // Nothing derived at all: the blocking overlay. Some Areas derived: the map works, the rest is offered separately.
        setPhase(parts.length ? { kind: 'ready' } : { kind: 'needs-pack', areas: missing, canBuild: loaded.canBuildPack });
      } catch (error) {
        if (!cancelled) setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Unbekannter Fehler', status: error instanceof V5ApiError ? error.status : undefined });
      }
    };
    reload.current = boot;
    void boot();
    const online = () => void client?.run();
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    const visible = () => { if (document.visibilityState === 'visible') void client?.run(); };
    const flush = () => { void fieldStore.persistNow(); void noteStore.persistNow(); };
    window.addEventListener('online', online);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('visibilitychange', visible);
    const poll = window.setInterval(() => void client?.run(), 15_000);
    return () => {
      cancelled = true; client?.dispose(); progressTracker?.dispose();
      window.removeEventListener('online', online); window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden); document.removeEventListener('visibilitychange', visible);
      window.clearInterval(poll);
      if (notesHydrated) void noteStore.persistNow();
      void fieldStore.persistNow(); // a no-op unless this store finished hydrating
    };
  }, [campaignId]);

  return {
    phase, meta, network, areaOf, store, notes, progress, sync, missingAreas,
    reload: () => reload.current(),
    async buildMissing() {
      const areas = missingRef.current;
      if (!areas.length || !canBuildRef.current) return;
      setPhase({ kind: 'loading', label: 'Kartendaten werden geladen …' });
      try { for (const area of areas) await buildPack(campaignId, area.id); await reload.current(); }
      catch (error) { setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Kartendaten konnten nicht geladen werden', status: error instanceof V5ApiError ? error.status : undefined }); }
    },
  };
}
