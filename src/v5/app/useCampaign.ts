import { useEffect, useRef, useState } from 'react';
import { mergeNetworks, type Network } from '../engine/index.ts';
import { FieldStore } from '../store/store.ts';
import { IndexedDbPersistence } from '../store/idb.ts';
import { Progress, type ProgressSnapshot } from '../store/progress.ts';
import { SyncClient } from '../store/syncClient.ts';
import { V5ApiError, buildPack, fetchMeta, fetchPack, httpTransport, type Meta } from './api.ts';
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
  progress: ProgressSnapshot | null;
  sync: { state: 'idle' | 'syncing' | 'offline'; pending: number };
  buildMissing(): Promise<void>;
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
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [sync, setSync] = useState<CampaignState['sync']>({ state: 'idle', pending: 0 });
  const reload = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    let client: SyncClient | null = null;
    let progressTracker: Progress | null = null;
    const fieldStore = new FieldStore(actorId(), new IndexedDbPersistence(campaignId));

    const boot = async () => {
      try {
        setPhase({ kind: 'loading', label: 'Aktion wird geladen …' });
        const loaded = await fetchMeta(campaignId);
        if (cancelled) return;
        setMeta(loaded);
        const packs: { areaId: string; ring: [number, number][]; pack: Uint8Array | null }[] = [];
        for (const area of loaded.areas) {
          setPhase({ kind: 'loading', label: `Kartendaten: ${area.name}` });
          packs.push({ areaId: area.id, ring: area.geometry.coordinates[0], pack: area.packVersion ? await fetchPack(campaignId, area.id) : null });
        }
        const missing = loaded.areas.filter((a) => !packs.find((p) => p.areaId === a.id)?.pack);
        if (missing.length) { if (!cancelled) setPhase({ kind: 'needs-pack', areas: missing, canBuild: loaded.canBuildPack }); }
        const parts: { areaId: string; network: Network }[] = [];
        for (const item of packs) {
          if (!item.pack) continue;
          setPhase((current) => (current.kind === 'needs-pack' ? current : { kind: 'loading', label: 'Straßen und Häuser werden berechnet …' }));
          parts.push({ areaId: item.areaId, network: await deriveInWorker(item.areaId, item.pack, item.ring) });
        }
        if (cancelled) return;
        const merged = mergeNetworks(parts);
        fieldStore.setAreaResolver((key) => merged.areaOf.get(key));
        await fieldStore.hydrate();
        progressTracker?.dispose();
        progressTracker = new Progress(merged.network, fieldStore);
        progressTracker.onChange(setProgress);
        setProgress(progressTracker.snapshot());
        setNetwork(merged.network); setAreaOf(merged.areaOf); setStore(fieldStore);
        client?.dispose();
        client = new SyncClient(fieldStore, httpTransport(campaignId), 100, (state, pending) => setSync({ state, pending }));
        void client.run();
        if (!missing.length) setPhase({ kind: 'ready' });
        else if (parts.length) setPhase({ kind: 'ready' });
      } catch (error) {
        if (!cancelled) setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Unbekannter Fehler', status: error instanceof V5ApiError ? error.status : undefined });
      }
    };
    reload.current = boot;
    void boot();
    const online = () => void client?.run();
    const visible = () => { if (document.visibilityState === 'visible') void client?.run(); };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    const poll = window.setInterval(() => void client?.run(), 15_000);
    return () => {
      cancelled = true; client?.dispose(); progressTracker?.dispose();
      window.removeEventListener('online', online); document.removeEventListener('visibilitychange', visible); window.clearInterval(poll);
      void fieldStore.persistNow();
    };
  }, [campaignId]);

  return {
    phase, meta, network, areaOf, store, progress, sync,
    async buildMissing() {
      if (phase.kind !== 'needs-pack') return;
      setPhase({ kind: 'loading', label: 'Kartendaten werden geladen …' });
      try { for (const area of phase.areas) await buildPack(campaignId, area.id); await reload.current(); }
      catch (error) { setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Kartendaten konnten nicht geladen werden', status: error instanceof V5ApiError ? error.status : undefined }); }
    },
  };
}
