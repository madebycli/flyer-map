import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature } from 'geojson';
import type { RouteResult } from '../engine/index.ts';
import type { FieldMap, Hit, Pt } from '../map/fieldMap.ts';
import { segmentKey, type EntityKey, type Status } from '../store/types.ts';
import type { EngineClient } from './engineClient.ts';
import { keysForGroups, keysForSegments, keysForTouched, type Index } from './mark.ts';
import type { IconName } from '../../ui/index.ts';

export type MarkMode = 'tap' | 'paint' | 'lasso' | 'route';
/** Route first: "Strecke" is what almost every shift is made of, so it is what a plain tap on the marking button starts. */
export const MODES: { mode: MarkMode; icon: IconName; label: string }[] = [
  { mode: 'route', icon: 'route', label: 'Strecke' }, { mode: 'tap', icon: 'tap', label: 'Tippen' },
  { mode: 'paint', icon: 'brush', label: 'Wischen' }, { mode: 'lasso', icon: 'lasso', label: 'Lasso' },
];
export const meters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

type Saved = { mode: MarkMode; brush: Status; withHouses: boolean; housesOnly: boolean };
const DEFAULTS: Saved = { mode: 'route', brush: 'completed', withHouses: true, housesOnly: false };
const load = (): Saved => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('vf-v5-mark-2') ?? '{}') }; } catch { return DEFAULTS; } };

export type MarkContext = {
  fieldMap: React.MutableRefObject<FieldMap | null>;
  /** The engine answers route, lasso and search questions (Rust); null while it is not ready. */
  engine: EngineClient | null;
  index: Index | null;
  /** Applies what the person may change and returns how many keys that was (0 = nothing happened). */
  apply(keys: EntityKey[], status: Status, label: string): number | void;
};

/**
 * One brush, four ways to use it. Strecke: tap points along the streets, then confirm and pick a status. Tippen stamps one
 * street piece or house, Wischen paints over many, Lasso circles an area; those three apply the current brush immediately.
 */
export function useMarking(ctx: MarkContext, active: boolean) {
  const [saved, setSaved] = useState<Saved>(load);
  const [anchors, setAnchors] = useState<string[]>([]);
  const { mode, brush, withHouses, housesOnly } = saved;
  const update = (patch: Partial<Saved>) => setSaved((current) => { const next = { ...current, ...patch }; try { localStorage.setItem('vf-v5-mark-2', JSON.stringify(next)); } catch { /* private mode */ } return next; });
  const latest = useRef({ ...ctx, brush, withHouses, housesOnly });
  latest.current = { ...ctx, brush, withHouses, housesOnly };

  // The route is computed by the engine (Rust, in the Worker); an answer for outdated anchors is dropped.
  const [route, setRoute] = useState<RouteResult | null>(null);
  const { engine } = ctx;
  useEffect(() => {
    if (!active || mode !== 'route' || !engine || anchors.length < 1) { setRoute(null); return; }
    let stale = false;
    engine.route(anchors).then((result) => { if (!stale) setRoute(result); }, () => { if (!stale) setRoute(null); });
    return () => { stale = true; };
  }, [active, mode, engine, anchors]);
  const routeIds = route?.state === 'selected' ? route.segmentIds : [];
  const routeKeys = useMemo(() => (ctx.index && routeIds.length ? keysForSegments(ctx.index, routeIds, withHouses, housesOnly) : []), [ctx.index, routeIds, withHouses, housesOnly]);
  const routeHouses = useMemo(() => routeKeys.reduce((n, key) => n + (key.startsWith('h:') ? 1 : 0), 0), [routeKeys]);

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
      const refresh = () => { frame = 0; const { index, withHouses: wh, housesOnly: ho } = now(); if (index) fm.setPreview(keysForTouched(index, { houses, segments }, wh, ho)); };
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
          const { index, brush: b, withHouses: wh, housesOnly: ho, apply } = now();
          const keys = index ? keysForTouched(index, { houses, segments }, wh, ho) : [];
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
          const { engine, brush: b, housesOnly: ho, apply } = now();
          const ring = points.map((p) => fm.unproject(p));
          points = []; fm.setDraw({ type: 'FeatureCollection', features: [] });
          if (!moved || !engine || ring.length < 3) return;
          // the engine (Rust) knows where every house and street piece lies; the answer arrives a moment later
          void engine.lasso([...ring, ring[0]], ho).then((picked) => {
            const keys: EntityKey[] = [...picked.houses.map((id) => `h:${id}`), ...picked.segments.map(segmentKey)];
            if (keys.length) apply(keys, b, String(keys.length));
          }, () => { /* engine gone (view closed) */ });
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
    const { index, brush: b, withHouses: wh, housesOnly: ho, apply } = latest.current;
    if (!index || !hit || (hit.kind !== 'house' && hit.kind !== 'segment')) return true;
    if (mode === 'tap') {
      const keys = hit.kind === 'house' ? [`h:${hit.id}`] : keysForGroups(index, [hit.id], wh, ho);
      if (keys.length) apply(keys, b, keys.length === 1 ? '1' : String(keys.length));
      return true;
    }
    if (mode === 'route' && hit.kind === 'segment') setAnchors((a) => [...a, hit.id]);
    return true;
  }, [active, mode]);

  // the route is kept when nothing could be applied (e.g. it lies in somebody else's Area), so it can be corrected instead of redone
  const applyRoute = (status: Status) => { if (routeKeys.length && latest.current.apply(routeKeys, status, String(routeKeys.length)) !== 0) setAnchors([]); };
  const routeReady = mode === 'route' && route?.state === 'selected' && anchors.length >= 2 && routeKeys.length > 0;
  return {
    mode, brush, withHouses, housesOnly,
    setMode: (m: MarkMode) => update({ mode: m }), setBrush: (b: Status) => update({ brush: b }),
    setWithHouses: (w: boolean) => update({ withHouses: w }), setHousesOnly: (h: boolean) => update({ housesOnly: h }),
    anchors, route, routeKeys, routeCount: routeIds.length, routeHouses, routeReady,
    undoAnchor: () => setAnchors((a) => a.slice(0, -1)), clearAnchors: () => setAnchors([]), applyRoute, onMapHit,
  };
}

export type Marking = ReturnType<typeof useMarking>;
