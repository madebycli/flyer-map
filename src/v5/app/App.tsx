import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildGraph, importLegacyProgress, routeSegments, type House, type LegacySnapshot, type Network, type Segment } from '../engine/index.ts';
import { FieldMap, statusColors, type Hit, type Theme } from '../map/fieldMap.ts';
import type { FieldStore } from '../store/store.ts';
import { houseKey, segmentKey, type EntityKey, type Status } from '../store/types.ts';
import { fetchLegacySnapshot } from './api.ts';
import { useCampaign } from './useCampaign.ts';
import { Icon, Loader, WavyProgress, type IconName } from './ui.tsx';

const LABELS: Record<Status, string> = { open: 'Offen', completed: 'Erledigt', later: 'Später', 'not-deliverable': 'Nicht zustellbar' };
const ORDER: Status[] = ['completed', 'later', 'not-deliverable', 'open'];
const STATUS_ICON: Record<Status, IconName> = { completed: 'check', later: 'later', 'not-deliverable': 'blocked', open: 'open' };
const readTheme = (): Theme => { try { return localStorage.getItem('vf-v5-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
const meters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);
const NO_SEGMENTS: string[] = [];

type Selection =
  | { kind: 'house'; house: House }
  | { kind: 'segment'; segment: Segment; houses: House[] };

type Undo = { label: string; revert: () => void };

function useStatus(store: FieldStore | null, key: EntityKey | null): Status {
  return useSyncExternalStore(
    useCallback((listener) => (store && key ? store.subscribeKey(key, listener) : () => {}), [store, key]),
    () => (store && key ? store.statusOf(key) : 'open'),
  );
}

export function App({ campaignId }: { campaignId: string }) {
  const campaign = useCampaign(campaignId);
  const { phase, meta, network, store } = campaign;
  const mapHost = useRef<HTMLDivElement>(null);
  const fieldMap = useRef<FieldMap | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [routeMode, setRouteMode] = useState(false);
  const [anchors, setAnchors] = useState<string[]>([]);
  const [withHouses, setWithHouses] = useState(true);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [importState, setImportState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);

  const index = useMemo(() => {
    if (!network) return null;
    const housesBySegment = new Map<string, House[]>();
    for (const house of network.houses) if (house.parent) { const list = housesBySegment.get(house.parent); if (list) list.push(house); else housesBySegment.set(house.parent, [house]); }
    return {
      housesBySegment, graph: buildGraph(network),
      segments: new Map(network.segments.map((s) => [s.id, s])), houses: new Map(network.houses.map((h) => [h.id, h])),
    };
  }, [network]);

  const route = useMemo(() => (index && anchors.length >= 1 ? routeSegments(network as Network, anchors, index.graph) : null), [index, network, anchors]);
  const routeSegmentIds = route?.state === 'selected' ? route.segmentIds : NO_SEGMENTS;

  // The map is created once; geometry and status arrive through loadNetwork / bind.
  useEffect(() => {
    if (!mapHost.current || fieldMap.current) return;
    fieldMap.current = new FieldMap({
      container: mapHost.current,
      theme,
      onHit: (hit) => hitRef.current(hit),
      segmentsOnly: () => routeModeRef.current,
    });
    return () => { fieldMap.current?.destroy(); fieldMap.current = null; };
  }, []);

  useEffect(() => {
    if (!network || !store || !fieldMap.current) return;
    const map = fieldMap.current;
    void map.loadNetwork(network).then(() => {
      map.bind(store);
      map.fitTo(workBounds(network, meta?.areas ?? []), { top: 120, bottom: 150, left: 28, right: 28 });
    });
  }, [network, store]); // eslint-disable-line react-hooks/exhaustive-deps -- fit only when the geometry changes

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    fieldMap.current?.setTheme(theme);
    try { localStorage.setItem('vf-v5-theme', theme); } catch { /* private mode */ }
  }, [theme]);

  useEffect(() => { fieldMap.current?.setPreview(routeMode ? routeSegmentIds.map(segmentKey) : []); }, [routeMode, routeSegmentIds]);

  const apply = useCallback((keys: EntityKey[], status: Status, label: string) => {
    if (!store || !meta?.canWrite || !keys.length) return;
    const before = keys.map((key) => [key, store.statusOf(key)] as const);
    store.set(keys, status);
    setUndo({
      label: `${label} → ${LABELS[status]}`,
      revert: () => { for (const [key, previous] of before) store.set(key, previous); },
    });
  }, [store, meta]);

  const routeModeRef = useRef(false);
  routeModeRef.current = routeMode;
  const hitRef = useRef<(hit: Hit | null) => void>(() => {});
  hitRef.current = (hit) => {
    if (!index) return;
    if (!hit) { setSelection(null); fieldMap.current?.select(null); return; }
    if (routeMode) {
      if (hit.kind === 'segment') setAnchors((current) => [...current, hit.id]);
      return;
    }
    if (hit.kind === 'house') {
      const house = index.houses.get(hit.id);
      if (house) { setSelection({ kind: 'house', house }); fieldMap.current?.select(houseKey(house.id)); }
    } else {
      const segment = index.segments.get(hit.id);
      if (segment) { setSelection({ kind: 'segment', segment, houses: index.housesBySegment.get(segment.id) ?? [] }); fieldMap.current?.select(segmentKey(segment.id)); }
    }
  };

  useEffect(() => { if (!undo) return; const t = window.setTimeout(() => setUndo(null), 8000); return () => window.clearTimeout(t); }, [undo]);

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
      setImportState('done');
    } catch { setNotice('Der bisherige Fortschritt konnte nicht geladen werden.'); setImportState('idle'); }
  };
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 9000); return () => window.clearTimeout(t); }, [notice]);

  const leaveRouteMode = () => { setRouteMode(false); setAnchors([]); };
  const routeKeys = useMemo(() => {
    if (!index || !routeSegmentIds.length) return [] as EntityKey[];
    const visible = routeSegmentIds.filter((id) => index.segments.get(id)?.visible);
    const keys = visible.map(segmentKey);
    if (withHouses) for (const id of visible) for (const house of index.housesBySegment.get(id) ?? []) keys.push(houseKey(house.id));
    return keys;
  }, [index, routeSegmentIds, withHouses]);
  const routeLength = route?.state === 'selected' ? route.length : 0;

  const canWrite = !!meta?.canWrite;
  const importOffer = phase.kind === 'ready' && meta?.role === 'admin' && importState !== 'done' && !!store && store.size === 0;
  const sheetOpen = routeMode || !!selection;
  const fitAll = () => { if (network && fieldMap.current) fieldMap.current.fitTo(workBounds(network, meta?.areas ?? []), { top: 120, bottom: 150, left: 28, right: 28 }); };
  const closeSelection = () => { setSelection(null); fieldMap.current?.select(null); };

  return (
    <div className="v5-root">
      <div ref={mapHost} className="v5-map" aria-label="Karte" />
      {phase.kind === 'ready' && <Hud name={meta?.campaign.name ?? ''} campaign={campaign} />}
      {phase.kind === 'ready' && meta && !meta.canWrite && <div className="v5-banner" role="status"><Icon name="eye" size={20} />Nur ansehen</div>}
      {phase.kind === 'ready' && campaign.missingAreas.length > 0 && (
        <div className="v5-banner v5-missing" role="status">
          <Icon name="warning" size={20} /><span>{campaign.missingAreas.map((a) => a.name).join(', ')}</span>
          {meta?.canBuildPack && <button className="v5-icon-btn tonal" onClick={() => void campaign.buildMissing()} aria-label="Kartendaten laden" title="Kartendaten laden"><Icon name="download" /></button>}
        </div>
      )}
      {notice && <div className="v5-toast" role="status"><Icon name="check" size={22} /><span>{notice}</span><button className="v5-icon-btn" onClick={() => setNotice(null)} aria-label="OK"><Icon name="close" size={20} /></button></div>}
      {undo && <div className="v5-toast" role="status"><Icon name="check" size={22} /><span>{undo.label}</span><button className="v5-icon-btn tonal" onClick={() => { undo.revert(); setUndo(null); }} aria-label="Rückgängig" title="Rückgängig"><Icon name="undo" /></button></div>}

      {phase.kind === 'loading' && <Overlay><Loader /><p>{phase.label}</p></Overlay>}
      {phase.kind === 'error' && <Overlay><span className="v5-badge big"><Icon name="warning" size={34} /></span><h2>Das hat nicht geklappt</h2><p>{phase.status === 401 ? 'Kein Zugriff auf diese Aktion. Öffne den Einladungslink erneut.' : phase.message}</p><button className="v5-btn" onClick={() => location.reload()}><Icon name="sync" size={20} />Neu laden</button></Overlay>}
      {phase.kind === 'needs-pack' && (
        <Overlay>
          <span className="v5-badge big"><Icon name="mapPin" size={34} /></span>
          <h2>Kartendaten fehlen</h2>
          <p>{phase.areas.map((a) => a.name).join(', ')}</p>
          {phase.canBuild ? <button className="v5-btn primary" onClick={() => void campaign.buildMissing()}><Icon name="download" size={20} />Kartendaten laden</button> : <p className="v5-muted">Eine Admin-Person muss sie laden.</p>}
        </Overlay>
      )}

      {phase.kind === 'ready' && !sheetOpen && (
        <nav className="v5-dock" aria-label="Werkzeuge">
          <button className="v5-tool" onClick={fitAll} aria-label="Alles zeigen" title="Alles zeigen"><Icon name="fit" /></button>
          {canWrite && (
            <button className="v5-tool primary" aria-pressed={false} aria-label="Strecke markieren" title="Strecke markieren"
              onClick={() => { closeSelection(); setRouteMode(true); }}><Icon name="route" size={28} /></button>
          )}
          <button className="v5-tool" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'} title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          {importOffer && (
            <button className="v5-tool" disabled={importState === 'busy'} onClick={() => void importLegacy()} aria-label="Fortschritt aus der bisherigen Version übernehmen" title="Fortschritt aus der bisherigen Version übernehmen">
              <Icon name={importState === 'busy' ? 'sync' : 'download'} />
            </button>
          )}
        </nav>
      )}

      {routeMode && (
        <SheetFrame icon="route" title="Strecke markieren" onClose={leaveRouteMode}
          meta={route?.state === 'selected' && anchors.length >= 2 ? <><span><Icon name="road" size={16} />{routeSegmentIds.length}</span><span><Icon name="ruler" size={16} />{meters(routeLength)}</span></> : undefined}>
          {anchors.length < 2 && <p className="v5-hint"><Icon name="mapPin" size={20} />{anchors.length === 0 ? 'Start antippen' : 'Ende antippen – weitere Tipps setzen Zwischenpunkte'}</p>}
          {route?.state === 'disconnected' && <p className="v5-warn"><Icon name="warning" size={20} />Nicht verbunden</p>}
          {route?.state === 'selected' && anchors.length >= 2 && (
            <>
              {route.ambiguous && <p className="v5-warn"><Icon name="warning" size={20} />Mehrere ähnlich kurze Wege – Zwischenpunkt antippen</p>}
              <div className="v5-row">
                <button className={`v5-chip-toggle${withHouses ? ' on' : ''}`} aria-pressed={withHouses} onClick={() => setWithHouses(!withHouses)} aria-label="Häuser an der Strecke mitmarkieren" title="Häuser an der Strecke mitmarkieren">
                  <Icon name="house" size={22} />{withHouses && <Icon name="check" size={16} />}
                </button>
                <button className="v5-icon-btn tonal" onClick={() => setAnchors((a) => a.slice(0, -1))} aria-label="Letzten Punkt entfernen" title="Letzten Punkt entfernen"><Icon name="undo" /></button>
              </div>
              <StatusGroup theme={theme} onPick={(status) => { apply(routeKeys, status, `${routeSegmentIds.length} Abschnitte`); leaveRouteMode(); }} />
            </>
          )}
          {anchors.length === 1 && <div className="v5-row"><button className="v5-icon-btn tonal" onClick={() => setAnchors([])} aria-label="Zurücksetzen" title="Zurücksetzen"><Icon name="undo" /></button></div>}
        </SheetFrame>
      )}

      {!routeMode && selection && (
        <SheetFrame
          icon={selection.kind === 'house' ? 'house' : 'road'}
          title={selection.kind === 'house' ? `${selection.house.street ?? ''} ${selection.house.number ?? ''}`.trim() || 'Haus' : selection.segment.name ?? 'Straße'}
          onClose={closeSelection}
          meta={selection.kind === 'segment' ? <><span><Icon name="ruler" size={16} />{meters(selection.segment.length)}</span><span><Icon name="house" size={16} />{selection.houses.length}</span></>
            : selection.house.parent === null ? <span><Icon name="warning" size={16} />Keiner Straße zugeordnet</span> : undefined}>
          {selection.kind === 'house'
            ? <Detail theme={theme} store={store} keyOf={houseKey(selection.house.id)} canWrite={canWrite} onPick={(s) => apply([houseKey(selection.house.id)], s, `Haus ${selection.house.number ?? ''}`)} />
            : <>
                <Detail theme={theme} store={store} keyOf={segmentKey(selection.segment.id)} canWrite={canWrite} onPick={(s) => apply([segmentKey(selection.segment.id)], s, selection.segment.name ?? 'Abschnitt')} />
                {canWrite && selection.houses.length > 0 && (
                  <button className="v5-wide" aria-label={`Abschnitt und alle ${selection.houses.length} Häuser erledigt`} title={`Abschnitt und alle ${selection.houses.length} Häuser erledigt`}
                    onClick={() => apply([segmentKey(selection.segment.id), ...selection.houses.map((h) => houseKey(h.id))], 'completed', `${selection.segment.name ?? 'Abschnitt'} + ${selection.houses.length}`)}>
                    <Icon name="road" size={22} /><Icon name="house" size={22} /><Icon name="check" size={22} /><b>{selection.houses.length}</b>
                  </button>
                )}
              </>}
        </SheetFrame>
      )}
    </div>
  );
}

/** Bounds of what can be worked on (houses and visible streets); Area polygons only when nothing was derived. */
function workBounds(network: Network, areas: { geometry: { coordinates: [number, number][][] } }[]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const add = (lng: number, lat: number) => { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < s) s = lat; if (lat > n) n = lat; };
  for (const house of network.houses) add(house.center[0], house.center[1]);
  for (const segment of network.segments) if (segment.visible) add(segment.coords[0][0], segment.coords[0][1]);
  if (!Number.isFinite(w)) for (const area of areas) for (const [lng, lat] of area.geometry.coordinates[0]) add(lng, lat);
  return [[w, s], [e, n]];
}

function StatusGroup({ current, onPick, theme }: { current?: Status; onPick: (status: Status) => void; theme: Theme }) {
  const colors = statusColors(theme);
  return (
    <div className="v5-seg" role="group" aria-label="Status">
      {ORDER.map((status) => (
        <button key={status} className={`v5-status v5-seg-btn${current === status ? ' on' : ''}`} style={{ '--c': colors[status] } as React.CSSProperties}
          onClick={() => onPick(status)} aria-pressed={current === status} aria-label={LABELS[status]} title={LABELS[status]}>
          <Icon name={STATUS_ICON[status]} size={26} />
          <span>{LABELS[status]}</span>
        </button>
      ))}
    </div>
  );
}

function SheetFrame({ icon, title, meta, onClose, children }: { icon: IconName; title: string; meta?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <section className="v5-sheet" aria-label={title}>
      <div className="v5-handle" aria-hidden />
      <header>
        <span className="v5-badge"><Icon name={icon} size={26} /></span>
        <div className="v5-head-text"><h2>{title}</h2>{meta && <div className="v5-meta">{meta}</div>}</div>
        <button className="v5-icon-btn" onClick={onClose} aria-label="Schließen" title="Schließen"><Icon name="close" /></button>
      </header>
      {children}
    </section>
  );
}

function Detail({ store, keyOf, canWrite, onPick, theme }: { store: FieldStore | null; keyOf: EntityKey; canWrite: boolean; onPick: (s: Status) => void; theme: Theme }) {
  const status = useStatus(store, keyOf);
  return canWrite
    ? <StatusGroup current={status} onPick={onPick} theme={theme} />
    : <p className="v5-readonly"><Icon name={STATUS_ICON[status]} size={22} />{LABELS[status]}</p>;
}

function Hud({ name, campaign }: { name: string; campaign: ReturnType<typeof useCampaign> }) {
  const p = campaign.progress;
  const dot = campaign.sync.state === 'offline' ? 'offline' : campaign.sync.pending > 0 || campaign.sync.state === 'syncing' ? 'busy' : 'ok';
  const title = dot === 'ok' ? 'Alles gespeichert' : dot === 'busy' ? `${campaign.sync.pending} Änderungen werden gesendet` : `Offline – ${campaign.sync.pending} Änderungen warten`;
  const done = p?.houses.completed ?? 0, total = p ? p.totalHouses - p.houses['not-deliverable'] : 0;
  return (
    <div className="v5-pill" role="status" title={name} aria-label={`${name}: ${Math.round((p?.houseRatio ?? 0) * 100)} Prozent`}>
      <span className={`v5-dot ${dot}`} title={title} aria-label={title}><Icon name={dot === 'ok' ? 'cloudOk' : dot === 'offline' ? 'cloudOff' : 'sync'} size={22} /></span>
      <div className="v5-hud-main">
        <div className="v5-hud-row">
          <strong className="v5-percent">{Math.round((p?.houseRatio ?? 0) * 100)}<small>%</small></strong>
          <span className="v5-count"><Icon name="house" size={15} />{done.toLocaleString('de')} / {total.toLocaleString('de')}</span>
        </div>
        <WavyProgress value={p?.houseRatio ?? 0} label="Fortschritt" />
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="v5-overlay"><div className="v5-card">{children}</div></div>;
}
