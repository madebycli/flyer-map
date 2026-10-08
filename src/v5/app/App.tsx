import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildGraph, importLegacyProgress, routeSegments, type House, type LegacySnapshot, type Network, type Segment } from '../engine/index.ts';
import { FieldMap, STATUS_COLORS, type Hit } from '../map/fieldMap.ts';
import type { FieldStore } from '../store/store.ts';
import { houseKey, segmentKey, type EntityKey, type Status } from '../store/types.ts';
import { fetchLegacySnapshot } from './api.ts';
import { useCampaign } from './useCampaign.ts';

const LABELS: Record<Status, string> = { open: 'Offen', completed: 'Erledigt', later: 'Später', 'not-deliverable': 'Nicht zustellbar' };
const ORDER: Status[] = ['completed', 'later', 'not-deliverable', 'open'];
const meters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);
const percent = (ratio: number) => `${Math.round(ratio * 100)} %`;
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
      style: 'https://tiles.openfreemap.org/styles/bright',
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
      const lngs = network.houses.map((h) => h.center[0]), lats = network.houses.map((h) => h.center[1]);
      if (lngs.length) map.fitTo([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]]);
    });
  }, [network, store]);

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

  return (
    <div className="v5-root">
      <div ref={mapHost} className="v5-map" aria-label="Karte" />
      {phase.kind === 'ready' && <TopPill name={meta?.campaign.name ?? ''} campaign={campaign} />}
      {phase.kind === 'ready' && meta?.role === 'admin' && importState !== 'done' && store && store.size === 0 && (
        <button className="v5-import" disabled={importState === 'busy'} onClick={() => void importLegacy()}>
          {importState === 'busy' ? 'Wird übernommen …' : 'Fortschritt aus der bisherigen Version übernehmen'}
        </button>
      )}
      {notice && <div className="v5-toast" role="status"><span>{notice}</span><button onClick={() => setNotice(null)}>OK</button></div>}
      {phase.kind === 'ready' && meta && !meta.canWrite && <div className="v5-banner">Nur ansehen – mit dieser Rolle kannst du nichts markieren.</div>}
      {phase.kind === 'loading' && <Overlay><div className="v5-spinner" aria-hidden /><p>{phase.label}</p></Overlay>}
      {phase.kind === 'error' && <Overlay><h2>Das hat nicht geklappt</h2><p>{phase.status === 401 ? 'Du hast keinen Zugriff auf diese Aktion. Öffne den Einladungslink erneut.' : phase.message}</p><button className="v5-btn" onClick={() => location.reload()}>Neu laden</button></Overlay>}
      {phase.kind === 'needs-pack' && (
        <Overlay>
          <h2>Kartendaten fehlen</h2>
          <p>{phase.areas.map((a) => a.name).join(', ')} {phase.areas.length === 1 ? 'hat' : 'haben'} noch keine Straßen- und Häuserdaten.</p>
          {phase.canBuild ? <button className="v5-btn primary" onClick={() => void campaign.buildMissing()}>Kartendaten laden</button> : <p className="v5-muted">Bitte eine Admin-Person, sie zu laden.</p>}
        </Overlay>
      )}
      {phase.kind === 'ready' && meta?.canWrite && (
        <button className={`v5-fab${routeMode ? ' active' : ''}`} aria-pressed={routeMode} onClick={() => (routeMode ? leaveRouteMode() : (setSelection(null), fieldMap.current?.select(null), setRouteMode(true)))}>
          {routeMode ? 'Abbrechen' : 'Strecke markieren'}
        </button>
      )}
      {routeMode && (
        <Sheet title="Strecke markieren" onClose={leaveRouteMode}>
          {anchors.length < 2 && <p className="v5-muted">{anchors.length === 0 ? 'Tippe auf den ersten Straßenabschnitt.' : 'Tippe auf den letzten Abschnitt. Weitere Tipps legen Zwischenpunkte fest.'}</p>}
          {route?.state === 'disconnected' && <p className="v5-warn">Diese Abschnitte sind nicht verbunden.</p>}
          {route?.state === 'selected' && anchors.length >= 2 && (
            <>
              <p><strong>{routeSegmentIds.length}</strong> Abschnitte · {meters(routeLength)}</p>
              {route.ambiguous && <p className="v5-warn">Es gibt mehrere ähnlich kurze Wege. Tippe einen Zwischenpunkt, um deinen Weg festzulegen.</p>}
              <label className="v5-check"><input type="checkbox" checked={withHouses} onChange={(e) => setWithHouses(e.target.checked)} /> Häuser an der Strecke mitmarkieren</label>
              <StatusGrid onPick={(status) => { apply(routeKeys, status, `${routeSegmentIds.length} Abschnitte`); leaveRouteMode(); }} />
            </>
          )}
          {anchors.length > 0 && <button className="v5-btn" onClick={() => setAnchors((a) => a.slice(0, -1))}>Letzten Punkt entfernen</button>}
        </Sheet>
      )}
      {!routeMode && selection && (
        <Sheet title={selection.kind === 'house' ? `${selection.house.street ?? 'Haus'} ${selection.house.number ?? ''}`.trim() : selection.segment.name ?? 'Straße'} onClose={() => { setSelection(null); fieldMap.current?.select(null); }}>
          {selection.kind === 'house'
            ? <Detail store={store} keyOf={houseKey(selection.house.id)} canWrite={!!meta?.canWrite} onPick={(s) => apply([houseKey(selection.house.id)], s, `Haus ${selection.house.number ?? ''}`)}
                note={selection.house.parent === null ? 'Keiner Straße zugeordnet' : selection.house.evidence === 'residential-type' ? 'Ohne Hausnummer' : undefined} />
            : <>
                <Detail store={store} keyOf={segmentKey(selection.segment.id)} canWrite={!!meta?.canWrite} onPick={(s) => apply([segmentKey(selection.segment.id)], s, selection.segment.name ?? 'Abschnitt')}
                  note={`${meters(selection.segment.length)} · ${selection.houses.length} Häuser`} />
                {meta?.canWrite && selection.houses.length > 0 && (
                  <button className="v5-btn wide" onClick={() => apply([segmentKey(selection.segment.id), ...selection.houses.map((h) => houseKey(h.id))], 'completed', `${selection.segment.name ?? 'Abschnitt'} mit ${selection.houses.length} Häusern`)}>
                    Abschnitt und alle {selection.houses.length} Häuser erledigt
                  </button>
                )}
              </>}
        </Sheet>
      )}
      {undo && <div className="v5-toast" role="status"><span>{undo.label}</span><button onClick={() => { undo.revert(); setUndo(null); }}>Rückgängig</button></div>}
    </div>
  );
}

function TopPill({ name, campaign }: { name: string; campaign: ReturnType<typeof useCampaign> }) {
  const p = campaign.progress;
  const dot = campaign.sync.state === 'offline' ? 'offline' : campaign.sync.pending > 0 || campaign.sync.state === 'syncing' ? 'busy' : 'ok';
  const title = dot === 'ok' ? 'Alles gespeichert' : dot === 'busy' ? `${campaign.sync.pending} Änderungen werden gesendet` : `Offline – ${campaign.sync.pending} Änderungen warten`;
  return (
    <div className="v5-pill" role="status">
      <span className={`v5-dot ${dot}`} title={title} aria-label={title} />
      <div className="v5-pill-text">
        <strong>{name}</strong>
        {p && <small>{p.houses.completed.toLocaleString('de')} / {(p.totalHouses - p.houses['not-deliverable']).toLocaleString('de')} Häuser · {percent(p.houseRatio)}</small>}
      </div>
      {p && <div className="v5-bar" aria-hidden><i style={{ width: percent(p.houseRatio) }} /></div>}
    </div>
  );
}

function Detail({ store, keyOf, canWrite, onPick, note }: { store: FieldStore | null; keyOf: EntityKey; canWrite: boolean; onPick: (s: Status) => void; note?: string }) {
  const status = useStatus(store, keyOf);
  return (
    <>
      <p className="v5-muted"><span className="v5-chip" style={{ background: STATUS_COLORS[status] }} />{LABELS[status]}{note ? ` · ${note}` : ''}</p>
      {canWrite && <StatusGrid current={status} onPick={onPick} />}
    </>
  );
}

function StatusGrid({ current, onPick }: { current?: Status; onPick: (s: Status) => void }) {
  return (
    <div className="v5-grid">
      {ORDER.map((status) => (
        <button key={status} className={`v5-status${current === status ? ' on' : ''}`} onClick={() => onPick(status)} aria-pressed={current === status}>
          <span className="v5-chip" style={{ background: STATUS_COLORS[status] }} />{LABELS[status]}
        </button>
      ))}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section className="v5-sheet" aria-label={title}>
      <div className="v5-handle" aria-hidden />
      <header><h2>{title}</h2><button className="v5-close" onClick={onClose} aria-label="Schließen">×</button></header>
      {children}
    </section>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="v5-overlay"><div className="v5-card">{children}</div></div>;
}
