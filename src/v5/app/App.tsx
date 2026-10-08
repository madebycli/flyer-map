import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { importLegacyProgress, type House, type LegacySnapshot, type Network, type Segment } from '../engine/index.ts';
import { FieldMap, statusColors, type Hit, type Pt, type Theme } from '../map/fieldMap.ts';
import type { FieldStore } from '../store/store.ts';
import { houseKey, segmentKey, type EntityKey, type Status } from '../store/types.ts';
import { areaSquareMeters, fromRing } from '../areas/polygon.ts';
import { fetchLegacySnapshot } from './api.ts';
import { AreaEditBar, sizeLabel, useAreaTool } from './areas.tsx';
import { buildIndex } from './mark.ts';
import { MarkBar, meters, useMarking } from './marking.tsx';
import { useCampaign } from './useCampaign.ts';
import { Icon, Loader, WavyProgress, type IconName } from './ui.tsx';

const LABELS: Record<Status, string> = { open: 'Offen', completed: 'Erledigt', later: 'Später', 'not-deliverable': 'Nicht zustellbar' };
const ORDER: Status[] = ['completed', 'later', 'not-deliverable', 'open'];
const STATUS_ICON: Record<Status, IconName> = { completed: 'check', later: 'later', 'not-deliverable': 'blocked', open: 'open' };
const readTheme = (): Theme => { try { return localStorage.getItem('vf-v5-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
const readHand = (): 'left' | 'right' => { try { return localStorage.getItem('vf-v5-hand') === 'left' ? 'left' : 'right'; } catch { return 'right'; } };

type Tool = 'inspect' | 'mark' | 'areas';
type Selection = { kind: 'house'; house: House } | { kind: 'segment'; segment: Segment; houses: House[] };
type Undo = { label: string; revert: () => void };

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
  for (const segment of network.segments) if (segment.visible) add(segment.coords[0][0], segment.coords[0][1]);
  if (!Number.isFinite(w)) for (const area of areas) for (const [lng, lat] of area.geometry.coordinates[0]) add(lng, lat);
  return [[w, s], [e, n]];
}
const FIT_PADDING = { top: 120, bottom: 170, left: 28, right: 28 };

export function App({ campaignId }: { campaignId: string }) {
  const campaign = useCampaign(campaignId);
  const { phase, meta, network, store } = campaign;
  const mapHost = useRef<HTMLDivElement>(null);
  const fieldMap = useRef<FieldMap | null>(null);
  const [tool, setTool] = useState<Tool>('inspect');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importState, setImportState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [hand, setHand] = useState<'left' | 'right'>(readHand);
  const [menu, setMenu] = useState(false);

  const index = useMemo(() => (network ? buildIndex(network) : null), [network]);
  const canWrite = !!meta?.canWrite;

  const apply = useCallback((keys: EntityKey[], status: Status, label: string) => {
    if (!store || !canWrite || !keys.length) return;
    const before = keys.map((key) => [key, store.statusOf(key)] as const);
    store.set(keys, status);
    setUndo({ label: `${label} → ${LABELS[status]}`, revert: () => { for (const [key, previous] of before) store.set(key, previous); } });
  }, [store, canWrite]);

  const marking = useMarking({ fieldMap, network, index, apply }, tool === 'mark');
  const areaTool = useAreaTool({ campaignId, fieldMap, meta, network, reload: campaign.reload }, tool === 'areas');

  // One click router: whichever tool is active decides what a tap on the map means.
  const hitRef = useRef<(hit: Hit | null, point: Pt) => void>(() => {});
  hitRef.current = (hit, point) => {
    if (tool === 'areas') { areaTool.onMapTap(point); return; }
    if (tool === 'mark') { marking.onMapHit(hit); return; }
    if (!index) return;
    if (!hit) { setSelection(null); fieldMap.current?.select(null); return; }
    if (hit.kind === 'house') {
      const house = index.houses.get(hit.id);
      if (house) { setSelection({ kind: 'house', house }); fieldMap.current?.select(houseKey(house.id)); }
    } else {
      const segment = index.segments.get(hit.id);
      if (segment) { setSelection({ kind: 'segment', segment, houses: index.housesBySegment.get(segment.id) ?? [] }); fieldMap.current?.select(segmentKey(segment.id)); }
    }
  };
  const segmentsOnlyRef = useRef(false);
  segmentsOnlyRef.current = tool === 'mark' && marking.mode === 'route';

  useEffect(() => {
    if (!mapHost.current || fieldMap.current) return;
    fieldMap.current = new FieldMap({ container: mapHost.current, theme, onHit: (hit, point) => hitRef.current(hit, point), segmentsOnly: () => segmentsOnlyRef.current });
    return () => { fieldMap.current?.destroy(); fieldMap.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!network || !store || !fieldMap.current) return;
    const map = fieldMap.current;
    void map.loadNetwork(network).then(() => { map.bind(store); map.fitTo(workBounds(network, meta?.areas ?? []), FIT_PADDING); });
  }, [network, store]); // eslint-disable-line react-hooks/exhaustive-deps -- fit only when the geometry changes

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    fieldMap.current?.setTheme(theme);
    try { localStorage.setItem('vf-v5-theme', theme); } catch { /* private mode */ }
  }, [theme]);
  useEffect(() => { try { localStorage.setItem('vf-v5-hand', hand); } catch { /* private mode */ } }, [hand]);

  useEffect(() => { if (!undo) return; const t = window.setTimeout(() => setUndo(null), 7000); return () => window.clearTimeout(t); }, [undo]);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 9000); return () => window.clearTimeout(t); }, [notice]);

  const closeSelection = () => { setSelection(null); fieldMap.current?.select(null); };
  const enter = (next: Tool) => { closeSelection(); setMenu(false); areaTool.setSelectedId(null); setTool(next); };
  const fitAll = () => { if (network && fieldMap.current) fieldMap.current.fitTo(workBounds(network, meta?.areas ?? []), FIT_PADDING); };

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
      setImportState('done'); setMenu(false);
    } catch { setNotice('Der bisherige Fortschritt konnte nicht geladen werden.'); setImportState('idle'); }
  };

  const importOffer = phase.kind === 'ready' && meta?.role === 'admin' && importState !== 'done' && !!store && store.size === 0;
  const ready = phase.kind === 'ready';
  const editing = !!areaTool.edit;
  const ui = !ready ? 'none' : editing || tool === 'mark' ? 'bar' : selection || (tool === 'areas' && areaTool.selectedId) || menu ? 'sheet' : 'dock';
  const canEditAny = !!meta && (meta.role === 'admin' || meta.role === 'team-editor');

  const selectedArea = meta?.areas.find((a) => a.id === areaTool.selectedId) ?? null;
  const areaStats = useMemo(() => {
    if (!selectedArea || !network || !store) return null;
    let total = 0, done = 0;
    for (const house of network.houses) if (campaign.areaOf.get(`h:${house.id}`) === selectedArea.id) { total++; if (store.statusOf(`h:${house.id}`) === 'completed') done++; }
    return { total, done, size: areaSquareMeters(fromRing(selectedArea.geometry.coordinates[0])) };
  }, [selectedArea, network, store, campaign.areaOf, campaign.progress]);

  return (
    <div className="v5-root" data-ui={ui} data-hand={hand}>
      <div ref={mapHost} className="v5-map" aria-label="Karte" />
      {ready && <Hud name={meta?.campaign.name ?? ''} campaign={campaign} canWrite={canWrite} />}
      {ready && campaign.missingAreas.length > 0 && (
        <div className="v5-banner v5-missing" role="status">
          <Icon name="warning" size={20} /><span>{campaign.missingAreas.map((a) => a.name).join(', ')}</span>
          {meta?.canBuildPack && <button className="v5-icon-btn tonal" onClick={() => void campaign.buildMissing()} aria-label="Kartendaten laden" title="Kartendaten laden"><Icon name="download" /></button>}
        </div>
      )}
      {notice && <div className="v5-toast" role="status"><Icon name="check" size={22} /><span>{notice}</span><button className="v5-icon-btn" onClick={() => setNotice(null)} aria-label="OK"><Icon name="close" size={20} /></button></div>}
      {undo && !notice && <div className="v5-toast" role="status"><Icon name="check" size={22} /><span>{undo.label}</span><button className="v5-icon-btn tonal" onClick={() => { undo.revert(); setUndo(null); }} aria-label="Rückgängig" title="Rückgängig"><Icon name="undo" /></button></div>}

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

      {ui === 'dock' && (
        <nav className="v5-dock" aria-label="Werkzeuge">
          <button className="v5-tool" onClick={fitAll} aria-label="Alles zeigen" title="Alles zeigen"><Icon name="fit" /></button>
          {canWrite && <button className="v5-tool primary" onClick={() => enter('mark')} aria-label="Markieren" title="Markieren"><Icon name="brush" size={28} /></button>}
          <button className="v5-tool" onClick={() => enter('areas')} aria-label="Gebiete" title="Gebiete"><Icon name="polygon" /></button>
          <button className="v5-tool" onClick={() => setMenu(true)} aria-label="Mehr" title="Mehr"><Icon name="more" /></button>
        </nav>
      )}

      {tool === 'mark' && ready && <MarkBar marking={marking} theme={theme} onClose={() => enter('inspect')} />}

      {tool === 'areas' && ready && meta && !editing && !selectedArea && (
        <nav className="v5-dock v5-dock-areas" aria-label="Gebiete">
          <button className="v5-tool" onClick={() => enter('inspect')} aria-label="Fertig" title="Fertig"><Icon name="close" /></button>
          {canEditAny && <button className="v5-tool primary" onClick={areaTool.startNew} aria-label="Neues Gebiet" title="Neues Gebiet"><Icon name="plus" size={28} /></button>}
        </nav>
      )}
      {editing && meta && <AreaEditBar tool={areaTool} meta={meta} />}

      {ui === 'sheet' && menu && (
        <SheetFrame icon="more" title="Mehr" onClose={() => setMenu(false)}>
          <div className="v5-list">
            <button className="v5-row-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}</button>
            <button className="v5-row-btn" onClick={() => setHand(hand === 'right' ? 'left' : 'right')}><Icon name="hand" />{hand === 'right' ? 'Bedienung links' : 'Bedienung rechts'}</button>
            {importOffer && <button className="v5-row-btn" disabled={importState === 'busy'} onClick={() => void importLegacy()} aria-label="Fortschritt aus der bisherigen Version übernehmen"><Icon name={importState === 'busy' ? 'sync' : 'download'} />Fortschritt aus der alten Version übernehmen</button>}
            <a className="v5-row-btn" href={`/?campaign=${encodeURIComponent(campaignId)}`}><Icon name="mapPin" />Alte Ansicht</a>
            {meta?.role === 'admin' && <a className="v5-row-btn" href="/login"><Icon name="shield" />Verwaltung</a>}
          </div>
        </SheetFrame>
      )}

      {tool === 'areas' && !editing && selectedArea && (
        <SheetFrame icon="polygon" title={selectedArea.name} onClose={() => areaTool.setSelectedId(null)}
          meta={<><span><Icon name="ruler" size={16} />{areaStats ? sizeLabel(areaStats.size) : ''}</span><span><Icon name="house" size={16} />{areaStats ? `${areaStats.done.toLocaleString('de')} / ${areaStats.total.toLocaleString('de')}` : ''}</span></>}>
          <div className="v5-row">
            <button className="v5-icon-btn tonal" onClick={() => fieldMap.current?.fitTo([[Math.min(...selectedArea.geometry.coordinates[0].map((p) => p[0])), Math.min(...selectedArea.geometry.coordinates[0].map((p) => p[1]))], [Math.max(...selectedArea.geometry.coordinates[0].map((p) => p[0])), Math.max(...selectedArea.geometry.coordinates[0].map((p) => p[1]))]], FIT_PADDING)} aria-label="Gebiet zeigen" title="Gebiet zeigen"><Icon name="fit" /></button>
            {areaTool.canEdit(selectedArea.teamId) && <button className="v5-go" onClick={() => areaTool.startEdit(selectedArea.id)} aria-label="Eckpunkte bearbeiten" title="Eckpunkte bearbeiten"><Icon name="pen" size={26} /></button>}
          </div>
        </SheetFrame>
      )}

      {tool === 'inspect' && selection && (
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

/**
 * Quiet by default: one small capsule (sync state + percentage). Tapping it unfolds the details for a few seconds.
 * Nothing animates here unless something needs attention.
 */
function Hud({ name, campaign, canWrite }: { name: string; campaign: ReturnType<typeof useCampaign>; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const t = window.setTimeout(() => setOpen(false), 5000); return () => window.clearTimeout(t); }, [open]);
  const p = campaign.progress;
  const dot = campaign.sync.state === 'offline' ? 'offline' : campaign.sync.pending > 0 || campaign.sync.state === 'syncing' ? 'busy' : 'ok';
  const title = dot === 'ok' ? 'Alles gespeichert' : dot === 'busy' ? `${campaign.sync.pending} Änderungen werden gesendet` : `Offline – ${campaign.sync.pending} Änderungen warten`;
  const done = p?.houses.completed ?? 0, total = p ? p.totalHouses - p.houses['not-deliverable'] : 0;
  const percent = Math.round((p?.houseRatio ?? 0) * 100);
  return (
    <div className={`v5-pill${open ? ' open' : ''}`} role="status" aria-label={`${name}: ${percent} Prozent`} data-done={done} data-total={total}>
      <button className="v5-pill-main" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Fortschritt">
        <span className={`v5-dot ${dot}`} title={title} aria-label={title}><Icon name={dot === 'ok' ? 'cloudOk' : dot === 'offline' ? 'cloudOff' : 'sync'} size={20} /></span>
        <strong className="v5-percent">{percent}<small>%</small></strong>
        {!canWrite && <Icon name="eye" size={18} className="v5-viewonly" />}
      </button>
      {open && (
        <div className="v5-pill-detail">
          <span className="v5-count"><Icon name="house" size={15} />{done.toLocaleString('de')} / {total.toLocaleString('de')}</span>
          <WavyProgress value={p?.houseRatio ?? 0} label="Fortschritt" />
          <small>{name}</small>
        </div>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="v5-overlay"><div className="v5-card">{children}</div></div>;
}
