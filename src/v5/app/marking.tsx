import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature } from 'geojson';
import { routeSegments, buildGraph, type Network } from '../engine/index.ts';
import { statusColors, type FieldMap, type Hit, type Pt, type Theme } from '../map/fieldMap.ts';
import { segmentKey, type EntityKey, type Status } from '../store/types.ts';
import { keysForGroups, keysForSegments, keysForTouched, lassoSelect, type Index } from './mark.ts';
import { Icon, type IconName } from './ui.tsx';

export type MarkMode = 'tap' | 'paint' | 'lasso' | 'route';
export const MODES: { mode: MarkMode; icon: IconName; label: string }[] = [
  { mode: 'tap', icon: 'tap', label: 'Tippen' }, { mode: 'paint', icon: 'brush', label: 'Wischen' },
  { mode: 'lasso', icon: 'lasso', label: 'Lasso' }, { mode: 'route', icon: 'route', label: 'Strecke' },
];
export const BRUSHES: { status: Status; icon: IconName; label: string }[] = [
  { status: 'completed', icon: 'check', label: 'Erledigt' }, { status: 'later', icon: 'later', label: 'Später' },
  { status: 'not-deliverable', icon: 'blocked', label: 'Nicht zustellbar' }, { status: 'open', icon: 'open', label: 'Offen' },
];
export const meters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

type Saved = { mode: MarkMode; brush: Status; withHouses: boolean };
const DEFAULTS: Saved = { mode: 'tap', brush: 'completed', withHouses: true };
const load = (): Saved => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('vf-v5-mark') ?? '{}') }; } catch { return DEFAULTS; } };

export type MarkContext = {
  fieldMap: React.MutableRefObject<FieldMap | null>;
  network: Network | null;
  index: Index | null;
  apply(keys: EntityKey[], status: Status, label: string): void;
};

/**
 * One brush, four ways to use it. The mode and the brush are chosen once; after that every action is a single gesture:
 * tap = stamp, paint = drag over houses/streets, lasso = circle an area, route = two taps between two street points.
 */
export function useMarking(ctx: MarkContext, active: boolean) {
  const [saved, setSaved] = useState<Saved>(load);
  const [anchors, setAnchors] = useState<string[]>([]);
  const { mode, brush, withHouses } = saved;
  const update = (patch: Partial<Saved>) => setSaved((current) => { const next = { ...current, ...patch }; try { localStorage.setItem('vf-v5-mark', JSON.stringify(next)); } catch { /* private mode */ } return next; });
  const latest = useRef({ ...ctx, brush, withHouses });
  latest.current = { ...ctx, brush, withHouses };

  const graph = useMemo(() => (ctx.network ? buildGraph(ctx.network) : null), [ctx.network]);
  const route = useMemo(() => (graph && ctx.network && anchors.length >= 1 ? routeSegments(ctx.network, anchors, graph) : null), [graph, ctx.network, anchors]);
  const routeIds = route?.state === 'selected' ? route.segmentIds : [];
  const routeKeys = useMemo(() => (ctx.index && routeIds.length ? keysForSegments(ctx.index, routeIds, withHouses) : []), [ctx.index, routeIds, withHouses]);

  // leaving a mode or the tool clears every transient overlay
  useEffect(() => { if (!active || mode !== 'route') setAnchors([]); }, [active, mode]);
  useEffect(() => { ctx.fieldMap.current?.setPreview(active && mode === 'route' ? routeKeys : []); }, [active, mode, routeKeys, ctx.fieldMap]);

  // pointer tools: paint and lasso own the finger while active
  useEffect(() => {
    const fm = ctx.fieldMap.current;
    if (!fm || !active) return;
    const now = () => latest.current;
    if (mode === 'paint') {
      const houses = new Set<string>(), segments = new Set<string>();
      let last: Pt | null = null, frame = 0;
      const refresh = () => { frame = 0; const { index, withHouses: wh } = now(); if (index) fm.setPreview(keysForTouched(index, { houses, segments }, wh)); };
      const touch = (p: Pt) => {
        const hit = fm.hitTest(p);
        if (hit.house) houses.add(hit.house); else if (hit.segment) segments.add(hit.segment);
        if (!frame) frame = requestAnimationFrame(refresh);
      };
      fm.setGesture({
        down: (p) => { houses.clear(); segments.clear(); last = p; touch(p); return true; },
        move: (p) => {
          // a fast finger skips pixels: sample the straight line between two events so thin streets are not missed
          if (last) { const steps = Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / 8); for (let i = 1; i < steps; i++) touch({ x: last.x + ((p.x - last.x) * i) / steps, y: last.y + ((p.y - last.y) * i) / steps }); }
          touch(p); last = p;
        },
        up: () => {
          const { index, brush: b, withHouses: wh, apply } = now();
          const keys = index ? keysForTouched(index, { houses, segments }, wh) : [];
          if (frame) cancelAnimationFrame(frame);
          fm.setPreview([]);
          if (keys.length) apply(keys, b, keys.length === 1 ? '1' : String(keys.length));
        },
        cancel: () => { if (frame) cancelAnimationFrame(frame); fm.setPreview([]); },
      });
      return () => { fm.setGesture(null); fm.setPreview([]); };
    }
    if (mode === 'lasso') {
      let points: Pt[] = [];
      const drawn = (closed: boolean) => {
        const coords = points.map((p) => fm.unproject(p));
        const features: Feature[] = [];
        if (coords.length >= 2) features.push({ type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: closed ? [...coords, coords[0]] : coords } });
        if (coords.length >= 3) features.push({ type: 'Feature', properties: { kind: 'fill' }, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } });
        fm.setDraw({ type: 'FeatureCollection', features });
      };
      fm.setGesture({
        down: (p) => { points = [p]; return true; },
        move: (p) => { const l = points[points.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) >= 4) { points.push(p); drawn(false); } },
        up: (_p, _l, moved) => {
          const { network, brush: b, apply } = now();
          const ring = points.map((p) => fm.unproject(p));
          points = []; fm.setDraw({ type: 'FeatureCollection', features: [] });
          if (!moved || !network || ring.length < 3) return;
          const picked = lassoSelect(network, [...ring, ring[0]]);
          const keys: EntityKey[] = [...picked.houses.map((id) => `h:${id}`), ...picked.segments.map(segmentKey)];
          if (keys.length) apply(keys, b, String(keys.length));
        },
        cancel: () => { points = []; fm.setDraw({ type: 'FeatureCollection', features: [] }); },
      });
      return () => { fm.setGesture(null); fm.setDraw({ type: 'FeatureCollection', features: [] }); };
    }
    fm.setGesture(null);
  }, [active, mode, ctx.fieldMap]);

  /** Taps (modes tap and route) arrive through the map's click. Returns true when the tool consumed the tap. */
  const onMapHit = useCallback((hit: Hit | null): boolean => {
    if (!active) return false;
    const { index, brush: b, withHouses: wh, apply } = latest.current;
    if (!index || !hit || hit.kind === 'note') return true;
    if (mode === 'tap') {
      const keys = hit.kind === 'house' ? [`h:${hit.id}`] : keysForGroups(index, [hit.id], wh);
      if (keys.length) apply(keys, b, keys.length === 1 ? '1' : String(keys.length));
      return true;
    }
    if (mode === 'route' && hit.kind === 'segment') setAnchors((a) => [...a, hit.id]);
    return true;
  }, [active, mode]);

  const applyRoute = () => { if (routeKeys.length) { latest.current.apply(routeKeys, brush, String(routeKeys.length)); setAnchors([]); } };
  return { mode, brush, withHouses, setMode: (m: MarkMode) => update({ mode: m }), setBrush: (b: Status) => update({ brush: b }), setWithHouses: (w: boolean) => update({ withHouses: w }),
    anchors, route, routeKeys, routeCount: routeIds.length, undoAnchor: () => setAnchors((a) => a.slice(0, -1)), clearAnchors: () => setAnchors([]), applyRoute, onMapHit };
}

export type Marking = ReturnType<typeof useMarking>;

export function MarkBar({ marking, theme, onClose }: { marking: Marking; theme: Theme; onClose: () => void }) {
  const colors = statusColors(theme);
  const routeReady = marking.mode === 'route' && marking.route?.state === 'selected' && marking.anchors.length >= 2;
  return (
    <section className="v5-markbar" aria-label="Markieren">
      {marking.mode === 'route' && (
        <div className="v5-markinfo">
          {marking.anchors.length < 2 && <span><Icon name="mapPin" size={18} />{marking.anchors.length === 0 ? 'Start' : 'Ende'}</span>}
          {marking.route?.state === 'disconnected' && <span className="warn"><Icon name="warning" size={18} />Nicht verbunden</span>}
          {routeReady && marking.route?.state === 'selected' && (
            <>
              <span><Icon name="road" size={18} />{marking.routeCount}</span>
              <span><Icon name="ruler" size={18} />{meters(marking.route.length)}</span>
              {marking.route.ambiguous && <span className="warn" title="Mehrere ähnlich kurze Wege – Zwischenpunkt antippen"><Icon name="warning" size={18} />Zwischenpunkt?</span>}
            </>
          )}
          {marking.anchors.length > 0 && <button className="v5-icon-btn tonal" onClick={marking.undoAnchor} aria-label="Letzten Punkt entfernen" title="Letzten Punkt entfernen"><Icon name="undo" size={20} /></button>}
          {routeReady && <button className="v5-go" onClick={marking.applyRoute} aria-label="Strecke markieren" title="Strecke markieren"><Icon name="check" size={26} /></button>}
        </div>
      )}
      <div className="v5-barrow">
        <div className="v5-modes" role="group" aria-label="Werkzeug">
          {MODES.map((m) => (
            <button key={m.mode} className={`v5-mode${marking.mode === m.mode ? ' on' : ''}`} aria-pressed={marking.mode === m.mode} aria-label={m.label} title={m.label} onClick={() => marking.setMode(m.mode)}>
              <Icon name={m.icon} size={24} />
            </button>
          ))}
        </div>
        <button className="v5-icon-btn tonal" onClick={onClose} aria-label="Fertig" title="Fertig"><Icon name="close" /></button>
      </div>
      <div className="v5-barrow">
        <div className="v5-seg compact" role="group" aria-label="Status">
          {BRUSHES.map((b) => (
            <button key={b.status} className={`v5-seg-btn${marking.brush === b.status ? ' on' : ''}`} style={{ '--c': colors[b.status] } as React.CSSProperties}
              aria-pressed={marking.brush === b.status} aria-label={b.label} title={b.label} onClick={() => marking.setBrush(b.status)}>
              <Icon name={b.icon} size={24} /><span>{b.label}</span>
            </button>
          ))}
        </div>
        {marking.mode !== 'lasso' && (
          <button className={`v5-chip-toggle${marking.withHouses ? ' on' : ''}`} aria-pressed={marking.withHouses} onClick={() => marking.setWithHouses(!marking.withHouses)}
            aria-label="Häuser an Straßen mitmarkieren" title="Häuser an Straßen mitmarkieren"><Icon name="house" size={22} />{marking.withHouses && <Icon name="check" size={16} />}</button>
        )}
      </div>
    </section>
  );
}
