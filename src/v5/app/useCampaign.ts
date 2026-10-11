import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeNetworks, type FieldNetwork as Network } from '../engine/index.ts';
import type { MapData } from '../engine/host.ts';
import { FieldStore } from '../store/store.ts';
import { IndexedDbNotePersistence, IndexedDbPersistence } from '../store/idb.ts';
import { IndexedDbNetworkStorage, NetworkCache } from '../store/networkCache.ts';
import { NoteStore } from '../notes/store.ts';
import { NoteSync } from '../notes/sync.ts';
import { Progress, type ProgressSnapshot } from '../store/progress.ts';
import { SyncClient } from '../store/syncClient.ts';
import { V5ApiError, buildPackFor, fetchMeta, fetchPack, httpNoteTransport, httpTransport, type Meta } from './api.ts';
import { fetchPickups, type Pickup } from './pickups.ts';
import { EngineClient } from './engineClient.ts';
import { packPlan } from '../engine/index.ts';
import { mapLimit } from './pool.ts';
import { diag } from '../diag/index.ts';

/** What one Area cost on this start and what the street engine made of it (shown per Area in the diagnostics). */
type AreaBoot = { n: number; source: 'cache' | 'server' | 'none'; packBytes: number | null; fetchMs: number; deriveMs: number | null; detail: Record<string, number> | null; houses: number; segments: number; diagnostics: unknown };

export type Phase =
  | { kind: 'loading'; label: string }
  | { kind: 'needs-pack'; areas: Meta['areas']; canBuild: boolean }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; status?: number };

const partIndexOf = (unitId: string) => Number(unitId.slice(unitId.lastIndexOf('~') + 1));

export type CampaignState = {
  phase: Phase;
  meta: Meta | null;
  network: Network | null;
  /** The engine holding the geometry (tiles, snapping) and what the map should load from it. */
  engine: EngineClient | null;
  mapData: MapData | null;
  areaOf: Map<string, string>;
  store: FieldStore | null;
  notes: NoteStore | null;
  pickups: Pickup[];
  progress: ProgressSnapshot | null;
  sync: { state: 'idle' | 'syncing' | 'offline'; pending: number; lastOkAt: number | null; lastError: string | null };
  /** Areas that are shown without data yet (some other Areas already work). */
  missingAreas: Meta['areas'];
  /** Fetch the map data of the Areas that have none. Resolves with a message for the person when it did not work (nothing blocks the screen then). */
  buildMissing(): Promise<string | null>;
  /** A data fetch started by `buildMissing` is running. */
  building: boolean;
  /** Parts of a big Gebiet fetched so far while `building` (null for a small Gebiet or when idle). */
  buildProgress: { done: number; total: number } | null;
  /** Re-fetch Areas, packs and status (after an Area was created or reshaped). */
  reload(): Promise<void>;
  /** Light refresh of roles, claims and Rooms only (no map rebuild, no loading screen). */
  refreshMeta(): Promise<void>;
  /** Keys in the local progress that the derived map no longer has (empty while an Area is missing, so nothing is judged by half the data). */
  orphans(): string[];
  /** Run a sync round right now (the overview's button); a no-op while one is running. */
  syncNow(): void;
};

function actorId(): string {
  try {
    const existing = localStorage.getItem('vf-v5-actor');
    if (existing) return existing;
    const created = `d${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('vf-v5-actor', created);
    return created;
  } catch { return `d${Math.random().toString(36).slice(2, 8)}`; }
}

export function useCampaign(campaignId: string, kind?: 'collection'): CampaignState {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', label: 'Aktion wird geladen …' });
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<{ done: number; total: number } | null>(null);
  const buildingRef = useRef(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const [engineState, setEngineState] = useState<{ client: EngineClient; mapData: MapData } | null>(null);
  const [areaOf, setAreaOf] = useState<Map<string, string>>(new Map());
  const [store, setStore] = useState<FieldStore | null>(null);
  const [notes, setNotes] = useState<NoteStore | null>(null);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const loadPickups = useCallback(async (m: Meta) => { setPickups(m.kind === 'collection' && m.pickupRights.view ? await fetchPickups(campaignId) : []); }, [campaignId]);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [sync, setSync] = useState<CampaignState['sync']>({ state: 'idle', pending: 0, lastOkAt: null, lastError: null });
  const [missingAreas, setMissingAreas] = useState<Meta['areas']>([]);
  const reload = useRef<(options?: { quiet?: boolean }) => Promise<void>>(async () => {});
  const syncRef = useRef<SyncClient | null>(null);
  /** What `orphans()` judges by: always the newest derivation, also right after `reload()` and before React re-rendered. */
  const liveRef = useRef<{ store: FieldStore; areaOf: Map<string, string>; missing: number } | null>(null);
  const missingRef = useRef<Meta['areas']>([]);
  const metaKindRef = useRef<Meta['kind']>('distribution');
  const canBuildRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let client: SyncClient | null = null;
    let progressTracker: Progress | null = null;
    let hydrated = false;
    let engine: EngineClient | null = null;
    /** The engine a quiet reload replaces; disposed once the new one serves the map, or adopted again if the reload fails. */
    let retired: EngineClient | null = null;
    const fieldStore = new FieldStore(actorId(), new IndexedDbPersistence(campaignId));
    const noteStore = new NoteStore(actorId(), new IndexedDbNotePersistence(campaignId), () => Date.now());
    let notesHydrated = false;
    const cache = new NetworkCache(campaignId, typeof indexedDB === 'undefined' ? null : new IndexedDbNetworkStorage());

    let bootSummary: { timing: Record<string, number>; areas: AreaBoot[]; role: string | null; kind: string | null; houses: number; segments: number; missing: number; at: number } | null = null;
    const stopProbe = diag.probe('campaign', () => ({ ...bootSummary, store: fieldStore.describe(), notesPending: noteStore.pendingNotes().length, orphans: liveRef.current ? [...liveRef.current.store.entries()].filter(([key, entry]) => entry.status !== 'open' && !liveRef.current!.areaOf.has(key)).length : null }));

    /** `quiet`: an admin change re-reads the Aktion while the person keeps looking at it, so the open sheet and its scroll position stay; only the first start shows the loading steps. */
    const boot = async ({ quiet = false }: { quiet?: boolean } = {}) => {
      const loading = (label: string) => { if (!quiet) setPhase({ kind: 'loading', label }); };
      const t0 = performance.now();
      diag.info('boot', 'boot start', { collection: kind === 'collection' });
      diag.inc('boot.n');
      try {
        loading('Aktion wird geladen …');
        // The engine (worker + wasm instantiation) starts while the Aktion's meta data is still on its way.
        // A quiet reload keeps the running engine until the new one is in place: the map keeps asking it for tiles meanwhile.
        const previous = engine;
        if (!quiet) previous?.dispose();
        engine = null;
        retired = quiet ? previous : null;
        const enginePromise = EngineClient.create({ forceTs: new URLSearchParams(location.search).get('engine') === 'ts' });
        enginePromise.catch(() => {});
        // A Worker that was started but never adopted (the meta request failed, or the view was closed meanwhile) must not live on.
        const discard = () => { void enginePromise.then((client) => client.dispose(), () => {}); };
        let loaded: Awaited<ReturnType<typeof fetchMeta>>;
        try { loaded = await fetchMeta(campaignId, kind); } catch (error) { discard(); throw error; }
        if (cancelled) { discard(); return; }
        diag.info('boot', 'meta loaded', { role: loaded.role, kind: loaded.kind, areas: loaded.areas.length, teams: loaded.teams.length, canBuild: loaded.canBuildPack, basemap: !!loaded.basemap, ms: Math.round(performance.now() - t0) });
        setMeta(loaded); metaKindRef.current = loaded.kind;
        void loadPickups(loaded);
        canBuildRef.current = loaded.canBuildPack;
        // The engine (Rust/WASM in a Worker, TypeScript fallback) keeps every Area's geometry; the app only gets coordinate-free data.
        engine = await enginePromise;
        if (cancelled) { engine.dispose(); return; }
        const useBlobs = engine.kind === 'wasm';
        // Per Area: the cached snapshot when pack, polygon and engine are unchanged; otherwise download (all in parallel —
        // the slow part on mobile data) and derive one after another.
        loading('Kartendaten werden geladen …');
        const timing: Record<string, number> = { meta: Math.round(performance.now() - t0), wasm: useBlobs ? 1 : 0 };
        const areaBoots: AreaBoot[] = [];
        // A big Gebiet is several units (its parts, see `packPlan`), each with its own pack and its own cached network; a small one is one unit.
        const units = loaded.areas.flatMap((area) => {
          const ring = area.geometry.coordinates[0] as [number, number][];
          const plan = packPlan(ring);
          return plan.parts.map((part) => ({ area, ring, part, single: plan.single, id: plan.single ? area.id : `${area.id}~${part.index}` }));
        });
        if (units.length > loaded.areas.length) diag.info('boot', 'big Gebiet: loaded in parts', { areas: loaded.areas.length, parts: units.length });
        let fetched = 0;
        const resolved = await mapLimit(units, 6, async (unit) => {
          const { area } = unit;
          const tArea = performance.now();
          const key = NetworkCache.keyFor({ id: unit.id, packVersion: area.packVersion, updatedAt: area.updatedAt });
          const blob = key && useBlobs ? await cache.load(key) : null;
          const pack = !blob && area.packVersion ? await fetchPack(campaignId, area.id, unit.single ? null : unit.part.index) : null;
          if (units.length > 8) { fetched++; loading(`Kartendaten werden geladen … ${fetched}/${units.length}`); }
          return { areaId: area.id, unitId: unit.id, cell: unit.part.cell, packVersion: area.packVersion, ring: unit.ring, blob, key, pack, packBytes: blob?.byteLength ?? pack?.byteLength ?? null, fetchMs: Math.round(performance.now() - tArea) };
        });
        if (cancelled) return;
        timing.packs = Math.round(performance.now() - t0) - timing.meta;
        timing.cacheHits = resolved.filter((r) => r.blob).length;
        diag.info('boot', 'packs ready', { areas: resolved.length, cacheHits: timing.cacheHits, downloaded: resolved.filter((r) => r.pack).length, withoutPack: resolved.filter((r) => !r.blob && !r.pack).length, ms: timing.packs });
        await engine.reset();
        const parts: { areaId: string; network: Network }[] = [];
        const missing: Meta['areas'] = [];
        let derivedUnits = 0;
        for (const item of resolved) {
          let result: Awaited<ReturnType<EngineClient['area']>> | null = null;
          let source: AreaBoot['source'] = item.blob ? 'cache' : item.pack ? 'server' : 'none';
          if (item.blob) {
            try { result = await engine.area({ areaId: item.unitId, ring: item.ring, cell: item.cell, blob: item.blob }); }
            catch (error) { diag.warn('cache', 'a cached network could not be loaded: downloading the pack again', { error: error instanceof Error ? error.message : String(error) }); void cache.forget(item.unitId); item.pack = await fetchPack(campaignId, item.areaId, item.cell ? partIndexOf(item.unitId) : null); timing.cacheHits--; source = item.pack ? 'server' : 'none'; }
          }
          if (!result) {
            if (!item.pack) { const gone = loaded.areas.find((a) => a.id === item.areaId)!; if (!missing.includes(gone)) missing.push(gone); diag.info('boot', 'an Area has no map data yet', { index: areaBoots.length + missing.length }); areaBoots.push({ n: areaBoots.length + 1, source: 'none', packBytes: null, fetchMs: item.fetchMs, deriveMs: null, detail: null, houses: 0, segments: 0, diagnostics: null }); continue; }
            loading(resolved.length > 8 ? `Straßen und Häuser werden berechnet … ${++derivedUnits}/${resolved.length}` : 'Straßen und Häuser werden berechnet …');
            result = await engine.area({ areaId: item.unitId, ring: item.ring, cell: item.cell, pack: item.pack, wantBlob: useBlobs });
            if (item.key && result.blob) void cache.store(item.key, result.blob);
          }
          if (result.detail) for (const [k, v] of Object.entries(result.detail)) timing[`w_${k}`] = (timing[`w_${k}`] ?? 0) + v;
          timing.engineMs = (timing.engineMs ?? 0) + result.ms;
          diag.observe(source === 'cache' ? 'derive.fromCache_ms' : 'derive.fromPack_ms', result.ms);
          areaBoots.push({ n: areaBoots.length + 1, source, packBytes: item.packBytes, fetchMs: item.fetchMs, deriveMs: result.ms, detail: result.detail ?? null, houses: result.network.houses.length, segments: result.network.segments.length, diagnostics: result.network.diagnostics });
          diag.info('boot', `area ${areaBoots.length} derived`, { source, ms: result.ms, houses: result.network.houses.length, segments: result.network.segments.length, waysIn: result.network.diagnostics.waysIn, buildingsIn: result.network.diagnostics.buildingsIn, orphanHouses: result.network.diagnostics.orphanHouses });
          parts.push({ areaId: item.areaId, network: result.network });
          if (cancelled) return;
        }
        missingRef.current = missing;
        setMissingAreas(missing);
        liveRef.current = null; // set again below, once the new derivation is in place
        timing.derive = Math.round(performance.now() - t0) - timing.meta - timing.packs;
        const tMerge = performance.now();
        const merged = mergeNetworks(parts);
        diag.observe('derive.merge_ms', performance.now() - tMerge);
        fieldStore.setAreaResolver((key) => merged.areaOf.get(key));
        if (!hydrated) { await Promise.all([fieldStore.hydrate(), noteStore.hydrate()]); hydrated = true; notesHydrated = true; }
        if (cancelled) return; // a boot cancelled while hydrating must not create clients nobody disposes
        // Only prune when every Area was derived; a missing pack must never cost queued edits.
        if (!missing.length) fieldStore.reconcilePending((key) => merged.areaOf.has(key));
        progressTracker?.dispose();
        progressTracker = new Progress(merged.network, fieldStore);
        progressTracker.onChange(setProgress);
        setProgress(progressTracker.snapshot());
        const mapData = await engine.mapData();
        setEngineState({ client: engine, mapData });
        if (retired && retired !== engine) { const old = retired; retired = null; setTimeout(() => old.dispose(), 2000); }
        liveRef.current = { store: fieldStore, areaOf: merged.areaOf, missing: missing.length };
        setNetwork(merged.network); setAreaOf(merged.areaOf); setStore(fieldStore); setNotes(noteStore);
        client?.dispose();
        client = syncRef.current = new SyncClient(fieldStore, httpTransport(campaignId), 100, (state, pending, info) => setSync({ state, pending, ...info }), [new NoteSync(noteStore, httpNoteTransport(campaignId))]);
        // Show the screen once the first pull settled (or after 4 s on a slow link), so a fresh device does not
        // flash 0 % before the shared progress arrives.
        if (parts.length) loading('Fortschritt wird geladen …');
        await Promise.race([client.run(), new Promise((resolve) => setTimeout(resolve, 4000))]);
        if (cancelled) return;
        timing.ready = Math.round(performance.now() - t0);
        (window as unknown as { __v5Boot?: Record<string, number> }).__v5Boot = timing;
        bootSummary = { timing, areas: areaBoots, role: loaded.role, kind: loaded.kind, houses: merged.network.houses.length, segments: merged.network.segments.length, missing: missing.length, at: Date.now() };
        diag.observe('boot.ready_ms', timing.ready);
        diag.info('boot', 'ready', { ...timing, houses: merged.network.houses.length, segments: merged.network.segments.length, missing: missing.length });
        if (timing.ready > 8000) diag.warn('boot', 'start took long', { ms: timing.ready });
        if (location.search.includes('debug')) console.info('[v5 boot ms]', JSON.stringify(timing));
        // Nothing derived at all: the blocking overlay. Some Areas derived: the map works, the rest is offered separately.
        // A collection Aktion is useful without any map data yet: helpers see the Areas and take one first; its pack is built on taking it.
        setPhase(quiet || parts.length || loaded.kind === 'collection' || !loaded.areas.length ? { kind: 'ready' } : { kind: 'needs-pack', areas: missing, canBuild: loaded.canBuildPack });
      } catch (error) {
        if (!cancelled) diag.error('boot', 'start failed', { message: error instanceof Error ? error.message : String(error), status: error instanceof V5ApiError ? error.status : undefined, ms: Math.round(performance.now() - t0) });
        if (retired && !engine) { engine = retired; retired = null; }
        if (quiet && !cancelled && engine) { diag.warn('boot', 'quiet reload failed; the previous state stays', { error }); throw error; }
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
    // The poll idles while the page is hidden and never stacks requests on a slow link.
    let metaBusy = false;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void client?.run();
      if (metaBusy || !(kind === 'collection' || metaKindRef.current === 'collection')) return;
      metaBusy = true;
      void fetchMeta(campaignId, kind).then((m) => { if (!cancelled) { setMeta(m); void loadPickups(m); } }, () => {}).finally(() => { metaBusy = false; });
    }, 15_000);
    return () => {
      cancelled = true; stopProbe(); syncRef.current = null; client?.dispose(); progressTracker?.dispose(); engine?.dispose(); retired?.dispose();
      window.removeEventListener('online', online); window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden); document.removeEventListener('visibilitychange', visible);
      window.clearInterval(poll);
      if (notesHydrated) void noteStore.persistNow();
      void fieldStore.persistNow(); // a no-op unless this store finished hydrating
    };
  }, [campaignId, kind]);

  return {
    phase, meta, network, engine: engineState?.client ?? null, mapData: engineState?.mapData ?? null, areaOf, store, notes, pickups, progress, sync, missingAreas,
    reload: () => reload.current({ quiet: true }),
    syncNow: () => { void syncRef.current?.run(); },
    orphans: () => { const live = liveRef.current; return live && !live.missing ? [...live.store.entries()].filter(([key, entry]) => entry.status !== 'open' && !live.areaOf.has(key)).map(([key]) => key) : []; },
    async refreshMeta() { const m = await fetchMeta(campaignId, kind); setMeta(m); await loadPickups(m); },
    building, buildProgress,
    async buildMissing() {
      if (!canBuildRef.current || buildingRef.current) return null;
      buildingRef.current = true; setBuilding(true);
      // On the first start (nothing derived yet) the loading screen carries the wait; otherwise the map stays usable.
      const overlay = phaseRef.current.kind === 'needs-pack';
      if (overlay) setPhase({ kind: 'loading', label: 'Kartendaten werden geladen …' });
      try {
        // Only Areas this caller may build right now (a collector: the ones their Room holds), judged on fresh server state.
        const fresh = await fetchMeta(campaignId, kind);
        const wanted = new Set(missingRef.current.map((a) => a.id));
        const buildable = fresh.areas.filter((a) => wanted.has(a.id) && (a.writable || fresh.role === 'admin'));
        for (const area of buildable) await buildPackFor(campaignId, area, (done, total) => { setBuildProgress({ done, total }); if (overlay) setPhase({ kind: 'loading', label: `Kartendaten werden geladen … ${done}/${total}` }); });
        await reload.current({ quiet: !overlay });
        return null;
      } catch (error) {
        // A refusal (the one-minute pause, the data source down) is a message, not a dead end: the screen comes back as it was.
        if (overlay) setPhase({ kind: 'needs-pack', areas: missingRef.current, canBuild: canBuildRef.current });
        return error instanceof Error ? error.message : 'Kartendaten konnten nicht geladen werden';
      } finally { buildingRef.current = false; setBuilding(false); setBuildProgress(null); }
    },
  };
}
