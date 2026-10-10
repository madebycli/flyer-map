import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { importLegacyProgress, type FieldHouse as House, type FieldNetwork as Network, type FieldSegment as Segment, type LegacySnapshot } from '../engine/index.ts';
import { FieldMap, type Hit, type Pt, type Theme } from '../map/fieldMap.ts';
import type { Conflict, FieldStore } from '../store/store.ts';
import { houseKey, segmentKey, type EntityKey, type Status } from '../store/types.ts';
import { areaSquareMeters, fromRing } from '../areas/polygon.ts';
import { areaAt } from '../areas/nearest.ts';
import { makeTemplate, parseTemplate, planTemplate, serializeTemplate, templateFileName, type ActionTemplate, type TemplatePlan } from '../areas/template.ts';
import { downloadText } from './download.ts';
import { applyTemplatePlan, type ApplyProgress } from './templateApply.ts';
import { buildPack, createTeam, archiveCollectionArea, deleteArea, deleteTeam, forceReleaseArea, forgetArea, fetchLegacySnapshot, pruneArea, PruneConfirmRequired, renameArea, renameCampaign, setAreaTeam, updateTeam } from './api.ts';
import { AreaEditBar, MAIN_ID, sizeLabel, useAreaTool } from './areas.tsx';
import { FabCaption, MarkFab, type FabPhase } from './fab.tsx';
import { HINTS, LABELS as ALL_LABELS, STATUS_ICON, type Kind } from './labels.ts';
import { buildIndex } from './mark.ts';
import { meters, useMarking } from './marking.tsx';
import { AccessSheet } from './accessSheet.tsx';
import { AreaAdmin, GroupsSheet } from './groupsSheet.tsx';
import { CollectionSetupSheet } from './collectionSetup.tsx';
import { ActivitySheet } from './activitySheet.tsx';
import { HomeSheet, OverviewSheet, SearchSheet, TemplateSheet, type AppTile } from './panels.tsx';
import { PickupBody, PickupForm, pickupFeatures, type PickupDraft } from './pickups.tsx';
import { createPickup, setPickupStatus, snapPoint, validateDraft, PICKUP_LABEL, type Pickup, type PickupStatus } from './pickups.ts';
import { actionErrorText } from './collection.ts';
import { DiagHud, DiagSheet } from './diagSheet.tsx';
import { diagRequested, setObserving, subscribeDiagMode } from '../diag/index.ts';
import { NotesOverview, NotesPane, areaNoteKey, houseNoteKey, noteFeatures, notePosition, segmentNoteKey, useNotesVersion } from './notes.tsx';
import { AreaActions, AreaList, RoomStrip, phaseColor, useActionRunner, useAreaViews, type AreaStats } from './collection.tsx';
import { areaPercent, collectionActions } from './collection.ts';
import { SheetFrame, StatusGroup } from './sheet.tsx';
import { houseStats } from './stats.ts';
import type { SearchHit } from './search.ts';
import { useCampaign } from './useCampaign.ts';
import { Icon, Loader } from '../../ui/index.ts';

const readTheme = (): Theme => { try { return localStorage.getItem('vf-v5-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
const readHand = (): 'left' | 'right' => { try { return localStorage.getItem('vf-v5-hand') === 'left' ? 'left' : 'right'; } catch { return 'right'; } };
const readBase = (): boolean => { try { return localStorage.getItem('vf-v5-base') !== 'off'; } catch { return true; } };

type Tool = 'inspect' | 'areas' | 'pickup';
type Panel = 'diag' | 'home' | 'overview' | 'activity' | 'access' | 'groups' | 'setup' | 'search' | 'notes' | 'conflicts' | 'areas' | 'template';
type Selection = { kind: 'house'; house: House } | { kind: 'segment'; segment: Segment; chunks: Segment[]; houses: House[] };
type Undo = { label: string; revert: () => void };

/** One street piece = several chunks: a single status when they agree, null when they differ ("mixed"). */
function useGroupStatus(store: FieldStore | null, keys: EntityKey[]): Status | null {
  const joined = keys.join('|');
  const snapshot = useSyncExternalStore(
    useCallback((listener) => { const offs = store ? keys.map((k) => store.subscribeKey(k, listener)) : []; return () => offs.forEach((off) => off()); }, [store, joined]), // eslint-disable-line react-hooks/exhaustive-deps
    () => (store ? keys.map((k) => store.statusOf(k)).join(',') : ''),
  );
  const all = snapshot.split(',').filter(Boolean) as Status[];
  return all.length && all.every((s) => s === all[0]) ? all[0] : null;
}

function useStatus(store: FieldStore | null, key: EntityKey | null): Status {
  return useSyncExternalStore(
    useCallback((listener) => (store && key ? store.subscribeKey(key, listener) : () => {}), [store, key]),
    () => (store && key ? store.statusOf(key) : 'open'),
  );
}

/** Bounds of what can be worked on (houses and visible streets); Area polygons only when nothing was derived. */
function workBounds(network: Network, areas: { geometry: { coordinates: [number, number][][] } }[]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const add = (lng: number, lat: number) => { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < s) s = lat; if (lat > n) n = lat; };
  for (const house of network.houses) add(house.center[0], house.center[1]);
  for (const segment of network.segments) if (segment.visible) add(segment.start[0], segment.start[1]);
  if (!Number.isFinite(w)) for (const area of areas) for (const [lng, lat] of area.geometry.coordinates[0]) add(lng, lat);
  return [[w, s], [e, n]];
}

const FIT_PADDING = { top: 120, bottom: 170, left: 28, right: 28 };
const ringBounds = (ring: [number, number][]): [[number, number], [number, number]] => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of ring) { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < s) s = lat; if (lat > n) n = lat; }
  return [[w, s], [e, n]];
};

export function App({ campaignId }: { campaignId: string }) {
  const campaign = useCampaign(campaignId, new URLSearchParams(location.search).get('kind') === 'collection' ? 'collection' : undefined);
  const { phase, meta, network, store, notes } = campaign;
  const isCollection = meta?.kind === 'collection';
  const kind: Kind = isCollection ? 'collection' : 'distribution';
  const LABELS = ALL_LABELS[kind];
  const mapHost = useRef<HTMLDivElement>(null);
  const fieldMap = useRef<FieldMap | null>(null);
  const [tool, setTool] = useState<Tool>('inspect');
  const [fab, setFab] = useState<FabPhase>('idle');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importState, setImportState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [hand, setHand] = useState<'left' | 'right'>(readHand);
  const [baseOn, setBaseOn] = useState(readBase);
  const [rotated, setRotated] = useState(false);
  const [locating, setLocating] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  useEffect(() => { if (!store) return; setConflicts([...store.pendingConflicts]); return store.subscribeConflicts(setConflicts); }, [store]);
  useEffect(() => { if (!conflicts.length && panel === 'conflicts') setPanel(null); }, [conflicts.length, panel]);

  const index = useMemo(() => (network ? buildIndex(network) : null), [network]);
  const canWrite = !!meta?.canWrite;

  const me = useMemo(() => (meta?.collectorId ? { collectorId: meta.collectorId, label: meta.collectorLabel ?? 'Helfer' } : null), [meta?.collectorId, meta?.collectorLabel]);
  const views = useAreaViews(meta, me);
  const runner = useActionRunner(campaign.refreshMeta);
  const actions = useMemo(() => (meta && isCollection ? collectionActions(campaignId, meta) : null), [meta, campaignId, isCollection]);
  /** Übernehmen, and if the Area has no map data yet, fetch it right away so the helper can start. */
  const claimArea = useCallback((areaId: string) => runner.run(async () => {
    await actions!.claim(areaId);
    const area = meta?.areas.find((a) => a.id === areaId);
    if (area && !area.packVersion) { await buildPack(campaignId, areaId); void campaign.reload(); }
  }), [runner, actions, meta, campaignId, campaign]);
  const [pickupId, setPickupId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PickupDraft | null>(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const pickupInFlight = useRef(false);
  const rights = meta?.pickupRights ?? { view: false, create: false, edit: false };
  const [collectionAreaId, setCollectionAreaId] = useState<string | null>(null);
  const writableAreas = useMemo(() => new Set((meta?.areas ?? []).filter((a) => a.writable).map((a) => a.id)), [meta]);
  const mayMark = canWrite && writableAreas.size > 0;
  // Only Areas this person can actually fetch data for: a helper is not nagged about Areas that belong to someone else's Room.
  const buildableMissing = useMemo(() => campaign.missingAreas.filter((a) => meta?.role === 'admin' || writableAreas.has(a.id)), [campaign.missingAreas, meta?.role, writableAreas]);
  const colorFor = useCallback((area: { id: string }) => (isCollection && views.get(area.id) ? phaseColor(views.get(area.id)!) : undefined), [isCollection, views]);
  const areaStatsMap = useMemo(() => {
    const map = new Map<string, AreaStats>();
    if (!network || !store || !isCollection) return map;
    for (const house of network.houses) {
      const id = campaign.areaOf.get(`h:${house.id}`);
      if (!id) continue;
      const status = store.statusOf(`h:${house.id}`);
      if (status === 'not-deliverable') continue;
      const entry = map.get(id) ?? { done: 0, total: 0 };
      entry.total++; if (status === 'completed') entry.done++;
      map.set(id, entry);
    }
    return map;
  }, [network, store, campaign.areaOf, campaign.progress, isCollection]);

  const selectedPickup = campaign.pickups.find((p) => p.id === pickupId) ?? null;
  const guardPickup = async (action: () => Promise<void>) => {
    if (pickupInFlight.current) return;
    pickupInFlight.current = true; setPickupBusy(true); setPickupError(null);
    try { await action(); await campaign.refreshMeta(); }
    catch (e) { setPickupError(actionErrorText(e)); }
    finally { pickupInFlight.current = false; setPickupBusy(false); }
  };
  const savePickup = () => guardPickup(async () => {
    const valid = draft ? validateDraft(draft) : null;
    if (!draft || !valid?.ok) return;
    await createPickup(campaignId, { ...valid.value, position: draft.position, areaId: draft.areaId });
    setDraft(null); setNotice('Sonder-Marker gespeichert.');
  });
  const changePickupStatus = (pickup: Pickup, status: PickupStatus) => guardPickup(() => setPickupStatus(campaignId, pickup, status));
  useEffect(() => {
    const fm = fieldMap.current;
    if (tool !== 'pickup' || !fm) return;
    fm.setDraw({ type: 'FeatureCollection', features: draft ? [{ type: 'Feature', properties: { kind: 'vertex', selected: 1 }, geometry: { type: 'Point', coordinates: draft.position } }] : [] });
    return () => { fm.setDraw({ type: 'FeatureCollection', features: [] }); };
  }, [tool, draft?.position[0], draft?.position[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback((requested: EntityKey[], status: Status, label: string) => {
    if (!store || !canWrite || !requested.length) return 0;
    // The server decides who may write where; mirroring it here keeps a tap on someone else's Area from becoming a phantom edit.
    const keys = requested.filter((key) => { const area = campaign.areaOf.get(key); return !!area && writableAreas.has(area); });
    if (!keys.length) { setNotice(isCollection ? 'Erst das Gebiet übernehmen.' : 'Hier darfst du nichts ändern.'); return 0; }
    // part of a route or lasso may reach into somebody else's Area: say so instead of silently marking less
    if (keys.length < requested.length) setNotice(`${requested.length - keys.length} Einträge liegen in fremden Gebieten und wurden ausgelassen.`);
    const before = keys.map((key) => [key, store.statusOf(key)] as const);
    store.set(keys, status);
    setUndo({ label: `${label} → ${LABELS[status]}`, revert: () => { for (const [key, previous] of before) store.set(key, previous); } });
    return keys.length;
  }, [store, canWrite, campaign.areaOf, writableAreas, isCollection]); // eslint-disable-line react-hooks/exhaustive-deps -- LABELS follows isCollection

  const marking = useMarking({ fieldMap, engine: campaign.engine, index, apply }, fab !== 'idle');
  /** After an outline was changed and the map re-derived: what the old outline held and the new one does not is removed, for everyone. */
  const afterAreaSaved = async (areaId: string, wasEdit: boolean) => {
    if (!wasEdit || meta?.role !== 'admin' || !store) return;
    const keys = campaign.orphans();
    if (!keys.length) return;
    try {
      const result = await pruneArea(campaignId, areaId, keys);
      store.forget(result.keys);
      if (result.removed) setNotice(`${result.removed} Markierungen außerhalb des neuen Umrisses entfernt.`);
    } catch (error) {
      // a clean-up that would wipe most of the Area is never done on its own: the Area sheet offers it with a confirmation
      if (error instanceof PruneConfirmRequired) setNotice('Sehr viele Markierungen liegen außerhalb des neuen Umrisses. Sie wurden nicht entfernt; im Gebiet kann das Bereinigen bestätigt werden.');
      else throw error;
    }
  };
  const areaTool = useAreaTool({ campaignId, fieldMap, meta, network, reload: campaign.reload, colorFor: isCollection ? colorFor : undefined, onSaved: afterAreaSaved, onCollectionDone: () => { setTool('inspect'); setPanel('setup'); } }, tool === 'areas');

  // One click router: whichever tool is active decides what a tap on the map means.
  const hitRef = useRef<(hit: Hit | null, point: Pt) => void>(() => {});
  hitRef.current = (hit, point) => {
    if (tool === 'areas') { areaTool.onMapTap(point); return; }
    if (tool === 'pickup') {
      const at = fieldMap.current?.lngLatAt(point);
      if (!at || !campaign.engine || !meta) return;
      void snapPoint(campaign.engine, at, meta.areas).then((snap) => {
        setPickupError(null);
        setDraft((current) => ({ title: current?.title ?? '', description: current?.description ?? '', address: snap.address ?? current?.address ?? '', position: snap.position, areaId: snap.areaId, snappedTo: snap.snappedTo }));
      }).catch(() => setPickupError('Position konnte nicht bestimmt werden.'));
      return;
    }
    if (fab !== 'idle') { marking.onMapHit(hit); return; }
    if (!index) return;
    if (!hit) {
      setSelection(null); fieldMap.current?.select(null);
      const areaId = isCollection ? fieldMap.current?.hitArea(point) : null;
      if (areaId) { setPanel(null); setCollectionAreaId(areaId); }
      return;
    }
    if (hit.kind === 'note') { openNoteTarget(hit.id); return; }
    if (hit.kind === 'pickup') { closeSelection(); setPanel(null); setPickupError(null); setPickupId(hit.id); const p = campaign.pickups.find((x) => x.id === hit.id); if (p) fieldMap.current?.focus(p.position); return; }
    selectEntity(hit.kind, hit.id);
  };
  const selectEntity = (kind: 'house' | 'segment', id: string) => {
    if (!index) return;
    if (kind === 'house') {
      const house = index.houses.get(id);
      if (house) { setSelection({ kind: 'house', house }); fieldMap.current?.select(houseKey(house.id)); }
    } else {
      // Notes on a street piece are keyed by its junction segment (group), taps by chunk: accept both.
      const segment = index.segments.get(id) ?? index.chunksByGroup.get(id)?.[0];
      if (segment) {
        const chunks = index.chunksByGroup.get(segment.group) ?? [segment];
        setSelection({ kind: 'segment', segment, chunks, houses: chunks.flatMap((c) => index.housesBySegment.get(c.id) ?? []) });
        fieldMap.current?.select(chunks.map((c) => segmentKey(c.id)));
      }
    }
  };
  /** Jump to the place a note belongs to and open it (marker tap or overview row). */
  const openNoteTarget = (key: string) => {
    if (!index || !meta) return;
    const at = notePosition(key, index, meta.areas);
    setPanel(null); setFab('idle');
    if (key.startsWith('a:')) { setSelection(null); fieldMap.current?.select(null); setTool('areas'); areaTool.setSelectedId(key.slice(2)); }
    else { areaTool.setSelectedId(null); setTool('inspect'); selectEntity(key.startsWith('h:') ? 'house' : 'segment', key.slice(2)); }
    if (at) fieldMap.current?.focus(at);
  };
  /** A human name for a status key: the address of a house or the name of a street piece. */
  const keyLabel = (key: string): string => {
    if (!index) return key;
    if (key.startsWith('h:')) { const h = index.houses.get(key.slice(2)); return h ? [h.street, h.number].filter(Boolean).join(' ') || 'Haus' : 'Haus'; }
    const s = index.segments.get(key.slice(2)); return s?.name ?? s?.ref ?? 'Straße';
  };
  const openSearchResult = (entry: SearchHit) => {
    if (!index) return;
    setPanel(null); setFab('idle'); setTool('inspect'); areaTool.setSelectedId(null);
    const at = entry.kind === 'house' ? index.houses.get(entry.id)?.center : index.segments.get(entry.id)?.mid;
    selectEntity(entry.kind === 'house' ? 'house' : 'segment', entry.id);
    if (at) fieldMap.current?.focus(at);
  };
  const fabRef = useRef<FabPhase>('idle');
  fabRef.current = fab;
  const toolRef = useRef<Tool>('inspect');
  toolRef.current = tool;
  const routeModeRef = useRef(false);
  routeModeRef.current = fab !== 'idle' && marking.mode === 'route';

  useEffect(() => {
    if (!mapHost.current || fieldMap.current) return;
    fieldMap.current = new FieldMap({
      container: mapHost.current, theme, onHit: (hit, point) => hitRef.current(hit, point), segmentsOnly: () => routeModeRef.current,
      noteHits: () => toolRef.current === 'inspect' && fabRef.current === 'idle', onRotate: (bearing) => setRotated(Math.abs(bearing) > 0.5),
    });
    return () => { fieldMap.current?.destroy(); fieldMap.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (meta) fieldMap.current?.setBasemap(meta.basemap ?? null); }, [meta?.basemap?.dark, meta?.basemap?.light, !!meta]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fieldMap.current?.setBasemapVisible(baseOn);
    try { localStorage.setItem('vf-v5-base', baseOn ? 'on' : 'off'); } catch { /* private mode */ }
  }, [baseOn]);
  useEffect(() => { fieldMap.current?.setHousesOnly(marking.housesOnly); }, [marking.housesOnly]);

  useEffect(() => {
    const { network, store, engine, mapData } = campaign;
    if (!network || !store || !engine || !mapData || !fieldMap.current) return;
    const map = fieldMap.current;
    void map.loadMapData(mapData, (z, x, y) => engine.tile(z, x, y)).then(() => { map.bind(store); map.fitTo(workBounds(network, meta?.areas ?? []), FIT_PADDING); });
  }, [network, store, campaign.mapData]); // eslint-disable-line react-hooks/exhaustive-deps -- fit only when the geometry changes

  useEffect(() => { fieldMap.current?.setPickups(pickupFeatures(campaign.pickups)); }, [campaign.pickups]);
  useEffect(() => {
    if (!location.search.includes('debug') || !campaign.engine) return;
    const engine = campaign.engine;
    (window as unknown as { __v5Diag?: () => Promise<unknown> }).__v5Diag = async () => ({ engine: await engine.stats(), tiles: fieldMap.current?.debugCounts() ?? null });
  }, [campaign.engine]);
  const notesVersion = useNotesVersion(notes);
  useEffect(() => {
    if (!notes || !index || !meta) return;
    fieldMap.current?.setNotes(noteFeatures(notes.all(), index, meta.areas));
  }, [notes, index, meta, notesVersion]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    fieldMap.current?.setTheme(theme);
    try { localStorage.setItem('vf-v5-theme', theme); } catch { /* private mode */ }
  }, [theme]);
  useEffect(() => { try { localStorage.setItem('vf-v5-hand', hand); } catch { /* private mode */ } }, [hand]);

  useEffect(() => { if (!undo) return; const t = window.setTimeout(() => setUndo(null), 7000); return () => window.clearTimeout(t); }, [undo]);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 9000); return () => window.clearTimeout(t); }, [notice]);

  const closeSelection = () => { setSelection(null); fieldMap.current?.select(null); setCollectionAreaId(null); setPickupId(null); };
  const enter = (next: Tool) => {
    closeSelection(); setPanel(null); setFab('idle'); areaTool.setSelectedId(null); setTool(next);
    if (next === 'areas') void preselectByLocation();
  };
  /** Drawing or editing starts at the Area the person is standing in (only when the position is already allowed, never a prompt). */
  const editingRef = useRef(false);
  const selectedAreaRef = useRef<string | null>(null);
  const preselectByLocation = async () => {
    const at = await fieldMap.current?.quietFix();
    if (!at || !meta || toolRef.current !== 'areas') return;
    const id = areaAt(meta.areas.map((a) => ({ id: a.id, ring: a.geometry.coordinates[0] as [number, number][] })), at);
    if (id && !editingRef.current && !selectedAreaRef.current) { areaTool.setSelectedId((current) => current ?? id); const area = meta.areas.find((a) => a.id === id); if (area) fieldMap.current?.fitTo(ringBounds(area.geometry.coordinates[0]), FIT_PADDING); }
  };
  // Aktions-Vorlage: the whole map (all Gebiete, their Gruppen, the marking rules) as one file. Loading shows what would change first.
  const templateInput = useRef<HTMLInputElement>(null);
  const [templateDraft, setTemplateDraft] = useState<{ template: ActionTemplate; plan: TemplatePlan } | null>(null);
  const [templateProgress, setTemplateProgress] = useState<ApplyProgress | null>(null);
  const pickTemplate = () => { setPanel(null); templateInput.current?.click(); };
  const onTemplateFile = async (file: File | undefined) => {
    if (!file || !meta) return;
    const result = parseTemplate(await file.text());
    if (!result.ok) { setNotice(result.reason); return; }
    const plan = planTemplate(result.template, { teams: meta.teams, areas: meta.areas.map((a) => ({ id: a.id, name: a.name, teamId: a.teamId, ring: a.geometry.coordinates[0] })) }, { role: meta.role === 'admin' ? 'admin' : 'team-editor', teamId: meta.teamId });
    setTemplateDraft({ template: result.template, plan });
    closeSelection(); setFab('idle'); setTool('inspect'); setPanel('template');
  };
  const applyTemplate = async () => {
    if (!templateDraft || !meta || templateProgress) return;
    const { template, plan } = templateDraft;
    setTemplateProgress({ done: 0, total: plan.createTeams.length + plan.createAreas.length + plan.reshapeAreas.length, label: '' });
    const result = await applyTemplatePlan(campaignId, plan, meta, setTemplateProgress);
    await campaign.reload();
    // The engine derived the changed outlines again: what the old outlines held and the new ones do not is removed (admin only).
    let pruned = 0, heldBack = false;
    if (meta.role === 'admin' && result.reshapedIds.length && store) {
      const keys = campaign.orphans();
      for (const id of keys.length ? result.reshapedIds : []) {
        try { const r = await pruneArea(campaignId, id, keys); pruned += r.removed; store.forget(r.keys); } catch { heldBack = true; }
      }
    }
    marking.setHousesOnly(template.rules.housesOnly);
    setTemplateProgress(null);
    const parts = [result.teamsCreated && `${result.teamsCreated} Gruppen`, result.areasCreated && `${result.areasCreated} neue Gebiete`, result.areasReshaped && `${result.areasReshaped} angepasst`, pruned && `${pruned} Markierungen außerhalb entfernt`, heldBack && 'Bereinigen nicht automatisch (zu viele Markierungen betroffen)'].filter(Boolean);
    // The sheet always closes: a second "Anwenden" on the old plan could create things twice. Loading the file again plans from what exists now.
    setNotice(result.errors.length ? `Vorlage teilweise angewendet (${parts.join(', ') || 'nichts'}). ${result.errors.length} Schritte fehlgeschlagen, z. B. ${result.errors[0]}. Datei erneut laden, um den Rest nachzuholen.` : parts.length ? `Vorlage angewendet: ${parts.join(', ')}.` : 'Vorlage angewendet.');
    setTemplateDraft(null); setPanel(null);
  };
  const exportTemplate = () => {
    if (!meta || !meta.areas.length) { setNotice('Es gibt noch keine Gebiete für eine Vorlage.'); return; }
    const unique = (names: string[]) => { const seen = new Map<string, number>(); return names.map((name) => { const key = name.trim().toLowerCase(); const n = (seen.get(key) ?? 0) + 1; seen.set(key, n); return n === 1 ? name : `${name} (${n})`; }); };
    const teamNames = unique(meta.teams.map((t) => t.name)), areaNames = unique(meta.areas.map((a) => a.name));
    const teams = meta.teams.map((t, i) => ({ name: teamNames[i], color: t.color }));
    const areas = meta.areas.map((a, i) => ({ name: areaNames[i], team: teamNames[Math.max(0, meta.teams.findIndex((t) => t.id === a.teamId))] ?? teamNames[0], ring: a.geometry.coordinates[0] as [number, number][] }));
    downloadText(templateFileName(meta.campaign.name), serializeTemplate(makeTemplate(meta.campaign.name, teams, areas, { housesOnly: marking.housesOnly })));
    setPanel(null); setNotice('Aktions-Vorlage gespeichert.');
  };
  // The template's outlines are shown on the map while its sheet is open ("nur zur Info"), in the colours of its Gruppen.
  useEffect(() => {
    const fm = fieldMap.current;
    if (!fm || panel !== 'template' || !templateDraft) return;
    const colors = new Map(templateDraft.template.teams.map((t) => [t.name, t.color]));
    fm.setDraw({ type: 'FeatureCollection', features: templateDraft.template.areas.map((a) => ({ type: 'Feature', properties: { kind: 'line', color: colors.get(a.team) ?? '#8fb8ff' }, geometry: { type: 'LineString', coordinates: a.ring } })) });
    fm.fitTo(ringBounds(templateDraft.template.areas.flatMap((a) => a.ring)), FIT_PADDING);
    return () => { fm.setDraw({ type: 'FeatureCollection', features: [] }); };
  }, [panel, templateDraft]);
  const openPanel = (next: Panel) => { closeSelection(); setFab('idle'); setPanel(next); };
  const startMarking = () => { closeSelection(); setPanel(null); setTool('inspect'); setFab('panel'); };
  const fitAll = () => { if (network && fieldMap.current) fieldMap.current.fitTo(workBounds(network, meta?.areas ?? []), FIT_PADDING); };
  const fitArea = (id: string) => { const area = meta?.areas.find((a) => a.id === id); if (area) { setPanel(null); fieldMap.current?.fitTo(ringBounds(area.geometry.coordinates[0]), FIT_PADDING); } };
  const locate = async () => {
    if (locating) return;
    setLocating(true);
    const result = await fieldMap.current?.locate();
    setLocating(false);
    if (result === 'denied') setNotice('Standort ist nicht freigegeben. Bitte in den Browser-Einstellungen erlauben.');
    else if (result === 'unavailable') setNotice('Standort gerade nicht verfügbar.');
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (fab !== 'idle') setFab(fab === 'panel' ? 'idle' : 'panel');
      else if (panel) setPanel(null);
      else if (selection) closeSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fab, panel, selection]);

  const importLegacy = async () => {
    if (!store || !network) return;
    setImportState('busy');
    try {
      const result = importLegacyProgress(network, (await fetchLegacySnapshot(campaignId)) as LegacySnapshot);
      for (const status of ['completed', 'later', 'not-deliverable'] as Status[]) {
        const keys = [...result.houses, ...result.segments].filter(([, s]) => s === status).map(([key]) => key);
        store.set(keys, status);
      }
      const { housesMatched, housesUnmatched, streetRangesMatched, streetRangesUnmatched } = result.stats;
      setNotice(`${housesMatched} Häuser und ${streetRangesMatched} Straßenabschnitte übernommen${housesUnmatched + streetRangesUnmatched ? `, ${housesUnmatched + streetRangesUnmatched} nicht zuordenbar` : ''}.`);
      setImportState('done'); setPanel(null);
    } catch { setNotice('Der bisherige Fortschritt konnte nicht geladen werden.'); setImportState('idle'); }
  };

  // the marking button can only exist while marking is possible: a released Area or another tool must not leave it half open
  useEffect(() => { if (fab !== 'idle' && (!mayMark || tool !== 'inspect' || phase.kind !== 'ready')) setFab('idle'); }, [fab, mayMark, tool, phase.kind]);
  const importOffer = phase.kind === 'ready' && meta?.role === 'admin' && importState !== 'done' && !!store && store.size === 0;
  const ready = phase.kind === 'ready';
  // ?diag=1 (or the switch left on in the panel): the readout stays on screen, and the panel opens once when the map is up.
  const diagOn = useSyncExternalStore(subscribeDiagMode, diagRequested, () => false);
  const diagAutoOpened = useRef(false);
  useEffect(() => { if (ready && diagOn && !diagAutoOpened.current && new URLSearchParams(location.search).get('diag') === '1') { diagAutoOpened.current = true; setPanel('diag'); } }, [ready, diagOn]);
  useEffect(() => { setObserving(panel === 'diag'); }, [panel]);
  const editing = !!areaTool.edit;
  editingRef.current = editing; selectedAreaRef.current = areaTool.selectedId;
  const canEditAny = !!meta && (meta.role === 'admin' || meta.role === 'team-editor');
  const selectedArea = meta?.areas.find((a) => a.id === areaTool.selectedId) ?? null;
  const sheetOpen = !!panel || (tool === 'inspect' && fab === 'idle' && (!!selection || !!selectedPickup || (isCollection && !!collectionAreaId))) || (tool === 'areas' && !!selectedArea && !editing) || (tool === 'pickup' && !!draft);
  const ui = !ready ? 'none' : sheetOpen && !editing ? 'sheet' : 'idle';

  const selectionArea = !selection ? '' : campaign.areaOf.get(selection.kind === 'house' ? houseKey(selection.house.id) : segmentKey(selection.segment.id)) ?? '';
  const areaStats = useMemo(() => {
    if (!selectedArea || !network || !store) return null;
    let total = 0, done = 0;
    for (const house of network.houses) if (campaign.areaOf.get(`h:${house.id}`) === selectedArea.id) { total++; if (store.statusOf(`h:${house.id}`) === 'completed') done++; }
    return { total, done, size: areaSquareMeters(fromRing(selectedArea.geometry.coordinates[0])) };
  }, [selectedArea, network, store, campaign.areaOf, campaign.progress]);
  const stats = useMemo(
    () => (panel === 'overview' && network && store ? houseStats(network, (key) => store.statusOf(key), campaign.areaOf) : null),
    [panel, network, store, campaign.areaOf, campaign.progress],
  );
  const [cleanupRevision, setCleanupRevision] = useState(0);
  const orphanCount = useMemo(() => (tool === 'areas' && selectedArea && meta?.role === 'admin' ? campaign.orphans().length : 0), [tool, selectedArea, meta?.role, campaign.progress, campaign.network, cleanupRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  const pruneSelected = () => {
    if (!selectedArea || !store) return;
    const keys = campaign.orphans();
    if (!keys.length || !window.confirm(`${keys.length} Markierungen entfernen, die nach der Änderung der Karte nirgends mehr liegen? Das gilt für alle Geräte und lässt sich nicht rückgängig machen.`)) return;
    void pruneArea(campaignId, selectedArea.id, keys, true).then((result) => {
      store.forget(result.keys);
      // Forgetting obsolete keys does not change derived house progress, so refresh this count explicitly.
      setCleanupRevision((revision) => revision + 1);
      setNotice(result.removed === 1 ? '1 veralteter Eintrag entfernt.' : result.removed ? `${result.removed} veraltete Einträge entfernt.` : 'Keine veralteten Einträge in diesem Gebiet.');
    }).catch((e) => setNotice(actionErrorText(e)));
  };

  // Gruppen and Gebiet admin: every change is one validated mutation (stale = someone else changed it first), then the new truth is loaded.
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const runAdmin = async (task: () => Promise<void>, done?: string) => {
    if (adminBusy) return;
    setAdminBusy(true); setAdminError(null);
    try { await task(); await campaign.reload(); if (done) setNotice(done); }
    catch (e) { setAdminError(actionErrorText(e)); try { await campaign.reload(); } catch { /* the error text stays */ } }
    finally { setAdminBusy(false); }
  };
  const drawCollection = () => { closeSelection(); setPanel(null); setFab('idle'); setTool('areas'); areaTool.startNew(); };
  const editCollection = (id: string) => { closeSelection(); setPanel(null); setFab('idle'); setTool('areas'); areaTool.startEdit(id); };
  const teamOf = (id: string) => meta?.teams.find((t) => t.id === id);
  const areaOfId = (id: string) => meta?.areas.find((a) => a.id === id);

  const modeHref = (collection: boolean) => { const u = new URL(location.href); u.searchParams.delete('kind'); if (collection) u.searchParams.set('kind', 'collection'); return `${u.pathname}${u.search}`; };
  const tiles: AppTile[] = [
    ...(meta?.role === 'admin' ? [
      { id: 'm-dist', icon: 'mailbox', label: 'Austeilen', on: !isCollection, href: isCollection ? modeHref(false) : undefined, onClick: () => setPanel(null), wide: true } satisfies AppTile,
      { id: 'm-coll', icon: 'paw', label: 'Abholen', on: isCollection, href: isCollection ? undefined : modeHref(true), onClick: () => setPanel(null), wide: true } satisfies AppTile,
    ] : []),
    { id: 'overview', icon: 'chart', label: 'Übersicht', onClick: () => openPanel('overview') },
    { id: 'activity', icon: 'users', label: 'Team', onClick: () => openPanel('activity') },
    ...(meta?.role === 'admin' && isCollection ? [{ id: 'setup', icon: 'ruler', label: 'Einrichten', onClick: () => { setAdminError(null); openPanel('setup'); } } satisfies AppTile] : []),
    ...(meta?.role === 'admin' && !isCollection ? [{ id: 'groups', icon: 'flag', label: 'Gruppen', onClick: () => { setAdminError(null); openPanel('groups'); } } satisfies AppTile] : []),
    ...(meta?.role === 'admin' ? [{ id: 'access', icon: 'lock', label: 'Zugänge', onClick: () => openPanel('access') } satisfies AppTile] : []),
    { id: 'search', icon: 'search', label: 'Suche', onClick: () => openPanel('search') },
    { id: 'areas', icon: 'polygon', label: 'Gebiete', onClick: () => (isCollection ? openPanel('areas') : enter('areas')) },
    ...(canEditAny && !isCollection ? [{ id: 'template', icon: 'upload', label: 'Vorlage laden', onClick: pickTemplate } satisfies AppTile] : []),
    ...(meta?.role === 'admin' && !isCollection ? [{ id: 'template-save', icon: 'download', label: 'Als Vorlage', onClick: exportTemplate } satisfies AppTile] : []),
    { id: 'notes', icon: 'message', label: 'Notizen', badge: notes?.all().length || undefined, onClick: () => openPanel('notes') },
    ...(isCollection && rights.create ? [{ id: 'pickup', icon: 'flag', label: 'Sonder-Marker', onClick: () => enter('pickup') } satisfies AppTile] : []),
    { id: 'fit', icon: 'fit', label: 'Alles zeigen', onClick: () => { setPanel(null); fitAll(); } },
    { id: 'theme', icon: theme === 'dark' ? 'sun' : 'moon', label: theme === 'dark' ? 'Hell' : 'Dunkel', onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    { id: 'hand', icon: 'hand', label: hand === 'right' ? 'Linkshand' : 'Rechtshand', onClick: () => setHand(hand === 'right' ? 'left' : 'right') },
    { id: 'base', icon: 'layers', label: baseOn ? 'Karte aus' : 'Karte an', on: !baseOn, onClick: () => setBaseOn(!baseOn) },
    ...(importOffer ? [{ id: 'import', icon: importState === 'busy' ? 'sync' : 'download', label: 'Alt-Import', onClick: () => void importLegacy() } satisfies AppTile] : []),
    { id: 'diag', icon: 'chart', label: 'Diagnose', onClick: () => openPanel('diag') },
    // the admin entry is role-aware: a link helper never sees it
    ...(meta?.role === 'admin' ? [{ id: 'admin', icon: 'shield', label: 'Verwaltung', href: '/login' } satisfies AppTile] : []),
  ];

  const ROLE_NAME: Record<string, string> = { admin: 'Admin', 'team-editor': 'Gruppe (bearbeiten)', viewer: 'Ansehen', 'collection-collector': 'Helfer' };
  const identity = meta ? [meta.me?.label ?? meta.collectorLabel, ROLE_NAME[meta.role] ?? meta.role].filter(Boolean).join(' · ') : undefined;
  const p = campaign.progress;
  const dot = campaign.sync.state === 'offline' ? 'offline' : campaign.sync.pending > 0 || campaign.sync.state === 'syncing' ? 'busy' : 'ok';
  const syncTitle = dot === 'ok' ? 'Alles gespeichert' : dot === 'busy' ? `${campaign.sync.pending} Änderungen werden gesendet` : `Offline – ${campaign.sync.pending} Änderungen warten`;
  const doneHouses = p?.houses.completed ?? 0, totalHouses = p ? p.totalHouses - p.houses['not-deliverable'] : 0;
  const percent = Math.round((p?.houseRatio ?? 0) * 100);

  return (
    <div className="v5-root" data-ui={ui} data-hand={hand} data-fab={fab}>
      <div ref={mapHost} className="v5-map" aria-label="Karte" />
      <input ref={templateInput} type="file" accept=".json,application/json" hidden aria-label="Vorlagen-Datei wählen" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void onTemplateFile(file); }} />
      {ready && (
        <button className="v5-pill" onClick={() => openPanel('overview')} role="status" aria-label={`${meta?.campaign.name ?? ''}: ${percent} Prozent – Übersicht öffnen`} data-done={doneHouses} data-total={totalHouses} title={syncTitle}>
          <span className={`v5-dot ${dot}`} aria-label={syncTitle}><Icon name={dot === 'ok' ? 'cloudOk' : dot === 'offline' ? 'cloudOff' : 'sync'} size={20} /></span>
          <strong className="v5-percent">{percent}<small>%</small></strong>
          {!canWrite && <Icon name="eye" size={18} className="v5-viewonly" />}
        </button>
      )}
      {ready && (
        <div className="v5-topright">
          <button className="v5-sq" onClick={() => openPanel('search')} aria-label="Straße oder Adresse suchen" title="Suchen"><Icon name="search" size={24} /></button>
          <button className="v5-sq" onClick={() => openPanel('home')} aria-label="Menü" title="Menü"><Icon name="grid" size={24} /></button>
        </div>
      )}
      {ready && buildableMissing.length > 0 && (
        <div className="v5-banner v5-missing" role="status">
          <Icon name="warning" size={20} /><span>{buildableMissing.map((a) => a.name).join(', ')}</span>
          {meta?.canBuildPack && <button className="v5-icon-btn tonal" onClick={() => void campaign.buildMissing()} aria-label="Kartendaten laden" title="Kartendaten laden"><Icon name="download" /></button>}
        </div>
      )}
      {ready && conflicts.length > 0 && panel !== 'conflicts' && (
        <button className="v5-conflict" onClick={() => openPanel('conflicts')} aria-label={`${conflicts.length} Änderungen wurden von anderen überschrieben`} title="Von anderen überschrieben">
          <Icon name="warning" size={18} />{conflicts.length}
        </button>
      )}
      {notice && <div className="v5-toast" role="status"><Icon name="check" size={22} /><span>{notice}</span><button className="v5-icon-btn" onClick={() => setNotice(null)} aria-label="OK"><Icon name="close" size={20} /></button></div>}
      {undo && !notice && <div className="v5-toast" role="status"><Icon name="check" size={22} /><span>{undo.label}</span><button className="v5-icon-btn tonal" onClick={() => { undo.revert(); setUndo(null); }} aria-label="Rückgängig" title="Rückgängig"><Icon name="undo" /></button></div>}

      {phase.kind === 'loading' && <Overlay><Loader /><p>{phase.label}</p></Overlay>}
      {phase.kind === 'error' && <Overlay><span className="v5-badge big"><Icon name="warning" size={34} /></span><h2>Das hat nicht geklappt</h2><p>{phase.status === 401 ? 'Kein Zugriff auf diese Aktion. Öffne den Einladungslink erneut.' : phase.message}</p><button className="v5-btn" onClick={() => location.reload()}><Icon name="sync" size={20} />Neu laden</button><button className="v5-btn" onClick={() => { setPanel('diag'); }}><Icon name="chart" size={20} />Diagnose</button></Overlay>}
      {phase.kind === 'needs-pack' && (
        <Overlay>
          <span className="v5-badge big"><Icon name="mapPin" size={34} /></span>
          <h2>Kartendaten fehlen</h2>
          <p>{phase.areas.map((a) => a.name).join(', ')}</p>
          {phase.canBuild ? <button className="v5-btn primary" onClick={() => void campaign.buildMissing()}><Icon name="download" size={20} />Kartendaten laden</button> : <p className="v5-muted">Eine Admin-Person muss sie laden.</p>}
        </Overlay>
      )}

      {ready && (fab === 'status' || fab === 'options') && <div className="v5-scrim" onClick={() => setFab('panel')} aria-hidden />}

      {ready && tool === 'inspect' && !editing && (
        <>
          <div className="v5-ctl left">
            <button className="v5-sq" onClick={fitAll} aria-label="Alles zeigen" title="Alles zeigen"><Icon name="fit" size={24} /></button>
          </div>
          <div className="v5-ctl right">
            {fab !== 'idle' && fab !== 'options' && <FabCaption marking={marking} kind={kind} />}
            {rotated && <button className="v5-sq" onClick={() => fieldMap.current?.resetNorth()} aria-label="Karte nach Norden ausrichten" title="Norden"><Icon name="compass" size={24} /></button>}
            <div className="v5-zoom">
              <button className="v5-sq" onClick={() => fieldMap.current?.zoomBy(1)} aria-label="Hineinzoomen" title="Hineinzoomen"><Icon name="plus" size={24} /></button>
              <button className="v5-sq" onClick={() => fieldMap.current?.zoomBy(-1)} aria-label="Herauszoomen" title="Herauszoomen"><Icon name="minus" size={24} /></button>
            </div>
            <button className={`v5-sq${locating ? ' on' : ''}`} onClick={() => void locate()} aria-label="Standort aktualisieren" title="Standort aktualisieren"><Icon name={locating ? 'sync' : 'locate'} size={24} /></button>
            {mayMark && <MarkFab phase={fab} setPhase={(next) => (next === 'panel' && fab === 'idle' ? startMarking() : setFab(next))} marking={marking} kind={kind} theme={theme} canUndoLast={!!undo} onUndoLast={() => { undo?.revert(); setUndo(null); }} />}
          </div>
        </>
      )}

      {ready && tool === 'areas' && meta && !editing && !selectedArea && (
        <div className="v5-ctl right row" aria-label="Gebiete">
          <span className="v5-hintchip"><Icon name="polygon" size={20} />Gebiet antippen</span>
          {canEditAny && <button className="v5-go" onClick={areaTool.startNew} aria-label="Neues Gebiet" title="Neues Gebiet"><Icon name="plus" size={26} /></button>}
          <button className="v5-sq" onClick={() => enter('inspect')} aria-label="Fertig" title="Fertig"><Icon name="close" size={24} /></button>
        </div>
      )}
      {editing && meta && <AreaEditBar tool={areaTool} meta={meta} />}
      {ready && tool === 'pickup' && !draft && (
        <div className="v5-ctl right row" aria-label="Sonder-Marker setzen">
          <span className="v5-hintchip"><Icon name="mapPin" size={20} />Karte antippen</span>
          <button className="v5-sq" onClick={() => enter('inspect')} aria-label="Fertig" title="Fertig"><Icon name="close" size={24} /></button>
        </div>
      )}

      {diagOn && panel !== 'diag' && <DiagHud onOpen={() => setPanel('diag')} />}
      {panel === 'diag' && <DiagSheet engine={campaign.engine} onClose={() => setPanel(null)} />}
      {ready && panel === 'home' && <HomeSheet tiles={tiles} identity={identity} onClose={() => setPanel(null)} />}
      {ready && panel === 'template' && templateDraft && <TemplateSheet template={templateDraft.template} plan={templateDraft.plan} progress={templateProgress} onApply={() => void applyTemplate()} onClose={() => { if (!templateProgress) { setPanel(null); setTemplateDraft(null); } }} />}
      {ready && panel === 'activity' && store && (
        <ActivitySheet kind={kind} theme={theme} store={store} version={campaign.progress} myLabel={meta?.me?.label ?? meta?.collectorLabel ?? 'Du'} labelOf={keyLabel} onPick={openNoteTarget} onClose={() => setPanel(null)} />
      )}
      {ready && panel === 'setup' && isCollection && meta?.role === 'admin' && (
        <CollectionSetupSheet meta={meta} views={views} busy={adminBusy} error={adminError} onClose={() => setPanel(null)}
          onDraw={drawCollection} onEditMain={() => editCollection(MAIN_ID)} onEdit={editCollection}
          onArchive={(id) => { const a = areaOfId(id); if (a && window.confirm(`Teilgebiet „${a.name}“ archivieren? Helfer sehen es dann nicht mehr; Fortschritt und Sonder-Marker bleiben erhalten.`)) void runAdmin(() => archiveCollectionArea(campaignId, a), 'Teilgebiet archiviert.'); }}
          onFree={(id, runId) => { const a = areaOfId(id); if (a && window.confirm(`„${a.name}“ freigeben? Der Raum wird geschlossen und das Teilgebiet ist wieder offen.`)) void runAdmin(() => forceReleaseArea(campaignId, runId, id), 'Teilgebiet freigegeben.'); }} />
      )}
      {ready && panel === 'groups' && meta?.role === 'admin' && (
        <GroupsSheet meta={meta} busy={adminBusy} error={adminError} onClose={() => setPanel(null)}
          onRenameCampaign={(name) => void runAdmin(() => renameCampaign(campaignId, meta.campaign.name, name), 'Aktion umbenannt.')}
          onCreate={(name, color) => void runAdmin(() => createTeam(campaignId, { id: `team_${crypto.randomUUID()}`, name, color }), 'Gruppe angelegt.')}
          onUpdate={(teamId, patch) => { const t = teamOf(teamId); if (t) void runAdmin(() => updateTeam(campaignId, t, patch)); }}
          onDelete={(teamId) => { const t = teamOf(teamId); if (t && window.confirm(`Gruppe „${t.name}“ löschen? Ihre Zugangslinks bleiben bestehen, bis du sie widerrufst.`)) void runAdmin(() => deleteTeam(campaignId, t), 'Gruppe gelöscht.'); }} />
      )}
      {ready && panel === 'access' && meta?.role === 'admin' && <AccessSheet campaignId={campaignId} teams={meta.teams} onClose={() => setPanel(null)} />}
      {ready && panel === 'search' && <SearchSheet engine={campaign.engine} onPick={openSearchResult} onClose={() => setPanel(null)} />}
      {ready && panel === 'overview' && stats && meta && (
        <OverviewSheet kind={kind} theme={theme} stats={stats} areas={meta.areas} teams={meta.teams} sync={campaign.sync} conflicts={conflicts.length}
          engine={campaign.engine?.kind === 'wasm' ? 'Rust (WebAssembly)' : 'TypeScript (Ersatz)'} onFitArea={fitArea} onSyncNow={campaign.syncNow} onConflicts={() => openPanel('conflicts')} onClose={() => setPanel(null)} />
      )}
      {ready && panel === 'conflicts' && (
        <SheetFrame icon="warning" title="Überschrieben" onClose={() => setPanel(null)} meta={<span>{conflicts.length}</span>}>
          <div className="v5-list">
            {conflicts.slice(0, 30).map((c) => {
              const isHouse = c.key.startsWith('h:');
              const id = c.key.slice(2);
              const house = isHouse ? index?.houses.get(id) : undefined, segment = !isHouse ? index?.segments.get(id) : undefined;
              const title = house ? `${house.street ?? ''} ${house.number ?? ''}`.trim() || 'Haus' : segment?.name ?? 'Straße';
              return (
                <div key={c.key} className="v5-conflict-row">
                  <Icon name={isHouse ? 'house' : 'road'} size={22} />
                  <span className="v5-conflict-title">{title}</span>
                  <Icon name={STATUS_ICON[c.mine]} size={22} /><Icon name="undo" size={14} /><Icon name={STATUS_ICON[c.theirs]} size={22} />
                  <button className="v5-icon-btn tonal" aria-label="Meine Version wiederherstellen" title="Meine Version wiederherstellen"
                    onClick={() => { store?.set(c.key, c.mine); store?.dismissConflicts([c.key]); }}><Icon name="check" size={20} /></button>
                </div>
              );
            })}
            <button className="v5-row-btn" onClick={() => { store?.dismissConflicts(); setPanel(null); }}><Icon name="close" />Alle so lassen</button>
          </div>
        </SheetFrame>
      )}
      {ready && panel === 'notes' && (
        <SheetFrame icon="message" title="Notizen" onClose={() => setPanel(null)}>
          <NotesOverview store={notes} index={index} areas={meta?.areas ?? []} onOpen={openNoteTarget} />
        </SheetFrame>
      )}

      {tool === 'pickup' && ready && draft && (
        <SheetFrame icon="mapPin" title="Sonder-Marker" onClose={() => { setDraft(null); setPickupError(null); }}>
          <PickupForm draft={draft} busy={pickupBusy} error={pickupError} onChange={setDraft} onSave={() => void savePickup()} />
        </SheetFrame>
      )}
      {selectedPickup && ready && tool === 'inspect' && fab === 'idle' && !panel && (
        <SheetFrame icon="mapPin" title={selectedPickup.title} onClose={() => { setPickupId(null); setPickupError(null); }}
          meta={<span>{PICKUP_LABEL[selectedPickup.status]}</span>}>
          <PickupBody pickup={selectedPickup} canEdit={rights.edit} busy={pickupBusy} error={pickupError} onStatus={(status) => void changePickupStatus(selectedPickup, status)} />
        </SheetFrame>
      )}
      {isCollection && panel === 'areas' && ready && meta && (
        <SheetFrame icon="polygon" title="Gebiete" onClose={() => setPanel(null)}
          meta={<span><Icon name="users" size={16} />{[...views.values()].filter((v) => v.phase === 'working').length}</span>}>
          <AreaList areas={meta.areas} views={views} stats={areaStatsMap} canAct={!!me} busy={runner.busy}
            onOpen={(id) => { setPanel(null); setCollectionAreaId(id); }}
            onClaim={(id) => void claimArea(id)} onJoin={(runId) => void runner.run(() => actions!.join(runId))} />
          {runner.error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{runner.error}</p>}
        </SheetFrame>
      )}

      {isCollection && collectionAreaId && ready && meta && tool === 'inspect' && fab === 'idle' && !panel && (() => {
        const area = meta.areas.find((a) => a.id === collectionAreaId);
        const view = area ? views.get(area.id) : undefined;
        if (!area || !view) return null;
        const stat = areaStatsMap.get(area.id);
        const percent = stat ? areaPercent(stat.done, stat.total, view.phase) : null;
        return (
          <SheetFrame icon="polygon" title={area.name} onClose={() => { setCollectionAreaId(null); runner.clear(); }}
            meta={<><span>{view.phase === 'open' ? 'Offen' : view.phase === 'working' ? 'Wird bearbeitet' : 'Erledigt'}</span>{percent !== null && <span><Icon name="house" size={16} />{percent} %</span>}</>}>
            <RoomStrip members={view.members} me={me} />
            <AreaActions view={view} busy={runner.busy} error={runner.error} canAct={!!me}
              onFit={() => fieldMap.current?.fitTo(ringBounds(area.geometry.coordinates[0]), FIT_PADDING)}
              onClaim={() => void claimArea(area.id)} onJoin={() => void runner.run(() => actions!.join(view.runId!))}
              onLeave={() => void runner.run(() => actions!.leave(view.runId!))} onRelease={() => void runner.run(() => actions!.release(view.runId!, area.id))}
              onComplete={() => void runner.run(() => actions!.complete(view.runId!, area.id))} />
            <NotesPane key={areaNoteKey(area.id)} store={notes} target={areaNoteKey(area.id)} area={area.id} canWrite={area.writable} onUndo={(label, revert) => setUndo({ label, revert })} />
          </SheetFrame>
        );
      })()}

      {tool === 'areas' && ready && !editing && selectedArea && (
        <SheetFrame icon="polygon" title={selectedArea.name} onClose={() => areaTool.setSelectedId(null)}
          meta={<><span><Icon name="ruler" size={16} />{areaStats ? sizeLabel(areaStats.size) : ''}</span><span><Icon name="house" size={16} />{areaStats ? `${areaStats.done.toLocaleString('de')} / ${areaStats.total.toLocaleString('de')}` : ''}</span></>}>
          <div className="v5-row">
            <button className="v5-icon-btn tonal" onClick={() => fieldMap.current?.fitTo(ringBounds(selectedArea.geometry.coordinates[0]), FIT_PADDING)} aria-label="Gebiet zeigen" title="Gebiet zeigen"><Icon name="fit" /></button>
            {areaTool.canEdit(selectedArea.teamId) && <button className="v5-go" onClick={() => areaTool.startEdit(selectedArea.id)} aria-label="Eckpunkte bearbeiten" title="Eckpunkte bearbeiten"><Icon name="pen" size={26} /></button>}
          </div>
          {orphanCount > 0 && <button className="v5-wide" onClick={pruneSelected} title="Markierungen entfernen, die nach einer Änderung des Gebiets nirgends mehr liegen"><Icon name="trash" size={20} />Veraltete Einträge bereinigen</button>}
          {meta?.role === 'admin' && (
            <>
              <AreaAdmin key={`${selectedArea.id}:${selectedArea.updatedAt}`} area={selectedArea} teams={meta.teams} busy={adminBusy}
                onRename={(name) => void runAdmin(() => renameArea(campaignId, areaOfId(selectedArea.id) ?? selectedArea, name))}
                onSetTeam={(teamId) => void runAdmin(() => setAreaTeam(campaignId, areaOfId(selectedArea.id) ?? selectedArea, teamId), 'Gebiet verschoben.')}
                onDelete={() => {
                  if (!window.confirm(`Gebiet „${selectedArea.name}“ endgültig löschen? Fortschritt, Notizen und Kartendaten dieses Gebiets werden für alle Geräte entfernt. Das lässt sich nicht rückgängig machen.`)) return;
                  const keys = [...campaign.areaOf].filter(([, area]) => area === selectedArea.id).map(([key]) => key);
                  void runAdmin(async () => {
                    await deleteArea(campaignId, areaOfId(selectedArea.id) ?? selectedArea);
                    await forgetArea(campaignId, selectedArea.id);
                    store?.forget(keys);
                    areaTool.setSelectedId(null);
                  }, 'Gebiet gelöscht.');
                }} />
              {adminError && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{adminError}</p>}
            </>
          )}
          <NotesPane key={areaNoteKey(selectedArea.id)} store={notes} target={areaNoteKey(selectedArea.id)} area={selectedArea.id} canWrite={canWrite && (meta?.role === 'admin' || meta?.teamId === selectedArea.teamId)} onUndo={(label, revert) => setUndo({ label, revert })} />
        </SheetFrame>
      )}

      {tool === 'inspect' && fab === 'idle' && !panel && selection && (
        <SheetFrame
          icon={selection.kind === 'house' ? 'house' : 'road'}
          title={selection.kind === 'house' ? `${selection.house.street ?? ''} ${selection.house.number ?? ''}`.trim() || 'Haus' : selection.segment.name ?? 'Straße'}
          onClose={closeSelection}
          meta={selection.kind === 'segment' ? <><span><Icon name="ruler" size={16} />{meters(selection.chunks.reduce((sum, c) => sum + c.length, 0))}</span><span><Icon name="house" size={16} />{selection.houses.length}</span></>
            : selection.house.parent === null ? <span><Icon name="warning" size={16} />Keiner Straße zugeordnet</span> : undefined}>
          {selection.kind === 'house'
            ? <Detail kind={kind} labels={LABELS} theme={theme} store={store} keyOf={houseKey(selection.house.id)} canWrite={canWrite} onPick={(s) => apply([houseKey(selection.house.id)], s, `Haus ${selection.house.number ?? ''}`)} />
            : <>
                <GroupDetail kind={kind} labels={LABELS} theme={theme} store={store} keys={selection.chunks.map((c) => segmentKey(c.id))} canWrite={canWrite} onPick={(s) => apply(selection.chunks.map((c) => segmentKey(c.id)), s, selection.segment.name ?? 'Abschnitt')} />
                {canWrite && selection.houses.length > 0 && (
                  <button className="v5-wide" aria-label={`Abschnitt und alle ${selection.houses.length} Häuser erledigt`} title={`Abschnitt und alle ${selection.houses.length} Häuser: ${LABELS.completed}`}
                    onClick={() => apply([...selection.chunks.map((c) => segmentKey(c.id)), ...selection.houses.map((h) => houseKey(h.id))], 'completed', `${selection.segment.name ?? 'Abschnitt'} + ${selection.houses.length}`)}>
                    <Icon name="road" size={22} /><Icon name="house" size={22} /><Icon name="check" size={22} /><b>{selection.houses.length}</b>
                  </button>
                )}
              </>}
          <NotesPane key={selection.kind === 'house' ? houseNoteKey(selection.house.id) : segmentNoteKey(selection.segment.group)} store={notes} canWrite={canWrite && writableAreas.has(selectionArea)} onUndo={(label, revert) => setUndo({ label, revert })}
            target={selection.kind === 'house' ? houseNoteKey(selection.house.id) : segmentNoteKey(selection.segment.group)}
            area={selectionArea} />
        </SheetFrame>
      )}
    </div>
  );
}

function GroupDetail({ store, keys, canWrite, onPick, theme, labels, kind }: { store: FieldStore | null; keys: EntityKey[]; canWrite: boolean; onPick: (s: Status) => void; theme: Theme; labels: Record<Status, string>; kind: Kind }) {
  const status = useGroupStatus(store, keys);
  return canWrite
    ? <StatusGroup current={status ?? undefined} onPick={onPick} theme={theme} labels={labels} kind={kind} />
    : <p className="v5-readonly"><Icon name={status ? STATUS_ICON[status] : 'open'} size={22} />{status ? labels[status] : 'Gemischt'}</p>;
}

function Detail({ store, keyOf, canWrite, onPick, theme, labels, kind }: { store: FieldStore | null; keyOf: EntityKey; canWrite: boolean; onPick: (s: Status) => void; theme: Theme; labels: Record<Status, string>; kind: Kind }) {
  const status = useStatus(store, keyOf);
  return canWrite
    ? <StatusGroup current={status} onPick={onPick} theme={theme} labels={labels} kind={kind} />
    : <p className="v5-readonly"><Icon name={STATUS_ICON[status]} size={22} />{labels[status]}<small className="v5-muted"> · {HINTS[kind][status]}</small></p>;
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="v5-overlay"><div className="v5-card">{children}</div></div>;
}
