import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export type BrushSize = 'fine' | 'medium' | 'wide';
/** Diameter of the highlighter stroke in screen px: the same on every zoom level, so what is under it is what is marked. */
export const BRUSH_PX: Record<BrushSize, number> = { fine: 26, medium: 44, wide: 72 };
export const BRUSH_SIZES: BrushSize[] = ['fine', 'medium', 'wide'];
export const BRUSH_LABEL: Record<BrushSize, string> = { fine: 'Fein', medium: 'Mittel', wide: 'Breit' };

type Saved = { mode: MarkMode; brush: Status; withHouses: boolean; housesOnly: boolean; size: BrushSize };
const HOUSE_TAP = 'house|';
const DEFAULTS: Saved = { mode: 'route', brush: 'completed', withHouses: true, housesOnly: false, size: 'medium' };
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
  /** What was tapped, in order: street pieces (the route runs through them) and, as `house|<id>`, single houses added to the selection. */
  const [taps, setTaps] = useState<string[]>([]);
  const anchors = useMemo(() => taps.filter((t) => !t.startsWith(HOUSE_TAP)), [taps]);
  const picked = useMemo(() => taps.filter((t) => t.startsWith(HOUSE_TAP)).map((t) => `h:${t.slice(HOUSE_TAP.length)}`), [taps]);
  const { mode, brush, withHouses, housesOnly, size } = saved;
  const update = (patch: Partial<Saved>) => setSaved((current) => { const next = { ...current, ...patch }; try { localStorage.setItem('vf-v5-mark-2', JSON.stringify(next)); } catch { /* private mode */ } return next; });
  const latest = useRef({ ...ctx, brush, withHouses, housesOnly, size });
  latest.current = { ...ctx, brush, withHouses, housesOnly, size };

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
  const streetKeys = useMemo(() => (ctx.index && routeIds.length ? keysForSegments(ctx.index, routeIds, withHouses, housesOnly) : []), [ctx.index, routeIds, withHouses, housesOnly]);
  // Houses tapped one by one join the selection (a route is not needed for them): one confirm sets the status of everything.
  const routeKeys = useMemo(() => (picked.length ? [...new Set([...streetKeys, ...picked])] : streetKeys), [streetKeys, picked]);
  const routeHouses = useMemo(() => routeKeys.reduce((n, key) => n + (key.startsWith('h:') ? 1 : 0), 0), [routeKeys]);

  // leaving a mode or the tool clears every transient overlay
  useEffect(() => { if (!active || mode !== 'route') setTaps([]); }, [active, mode]);
  useEffect(() => { ctx.fieldMap.current?.setPreview(active && mode === 'route' ? routeKeys : []); }, [active, mode, routeKeys, ctx.fieldMap]);

  // pointer tools: paint and lasso own the finger while active
  useEffect(() => {
    const fm = ctx.fieldMap.current;
    if (!fm || !active) return;
    const now = () => latest.current;
    if (mode === 'paint') {
      // Highlighter: a thick see-through stroke follows the finger; everything it touches on the screen is previewed and, on lifting, marked.
      const houses = new Set<string>(), segments = new Set<string>();
      let points: Pt[] = [], last: Pt | null = null, frame = 0;
      const clearStroke = () => fm.setInk(null);
      const draw = () => {
        frame = 0;
        const { brush: b, size: sz, index, withHouses: wh, housesOnly: ho } = now();
        fm.setInk({ kind: 'stroke', points, color: fm.statusColor(b), width: BRUSH_PX[sz] });
        if (index) fm.setPreview(keysForTouched(index, { houses, segments }, wh, ho));
      };
      const touch = (a: Pt, b: Pt) => {
        const hit = fm.brushTouch(a, b, BRUSH_PX[now().size] / 2);
        for (const id of hit.houses) houses.add(id);
        for (const id of hit.segments) segments.add(id);
        if (!frame) frame = requestAnimationFrame(draw);
      };
      fm.setGesture({
        hold: true,
        down: (p) => { clearStroke(); houses.clear(); segments.clear(); points = [p]; last = p; touch(p, p); return true; },
        move: (p) => {
          const from = last ?? p;
          // a fast finger skips pixels: the whole line from the last point is tested, not just the new one
          touch(from, p);
          if (Math.hypot(p.x - from.x, p.y - from.y) >= 3) { points.push(p); last = p; }
        },
        up: () => {
          const { index, brush: b, housesOnly: ho, withHouses: wh, apply } = now();
          const keys = index ? keysForTouched(index, { houses, segments }, wh, ho) : [];
          if (frame) { cancelAnimationFrame(frame); frame = 0; }
          fm.setPreview([]);
          if (keys.length) apply(keys, b, keys.length === 1 ? '1' : String(keys.length));
          // the stroke stays a moment, then fades away: the marked colours take over
          fm.fadeInk();
        },
        cancel: () => { if (frame) cancelAnimationFrame(frame); frame = 0; fm.setPreview([]); clearStroke(); },
      });
      return () => { if (frame) cancelAnimationFrame(frame); fm.setGesture(null); fm.setPreview([]); clearStroke(); };
    }
    if (mode === 'lasso') {
      let points: Pt[] = [], drawFrame = 0;
      const drawn = (closed: boolean) => fm.setInk({ kind: 'lasso', points, closed });
      fm.setGesture({
        hold: true,
        down: (p) => { points = [p]; return true; },
        // the outline is redrawn once per frame, not once per touch event (a finger sends several per frame)
        move: (p) => { const l = points[points.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) >= 4) { points.push(p); if (!drawFrame) drawFrame = requestAnimationFrame(() => { drawFrame = 0; drawn(false); }); } },
        up: (_p, _l, moved) => {
          if (drawFrame) { cancelAnimationFrame(drawFrame); drawFrame = 0; }
          const { engine, brush: b, housesOnly: ho, apply } = now();
          const ring = points.map((p) => fm.unproject(p));
          points = []; fm.setInk(null);
          if (!moved || !engine || ring.length < 3) return;
          // the engine (Rust) knows where every house and street piece lies; the answer arrives a moment later
          void engine.lasso([...ring, ring[0]], ho).then((picked) => {
            const keys: EntityKey[] = [...picked.houses.map((id) => `h:${id}`), ...picked.segments.map(segmentKey)];
            if (keys.length) apply(keys, b, String(keys.length));
          }, () => { /* engine gone (view closed) */ });
        },
        cancel: () => { if (drawFrame) { cancelAnimationFrame(drawFrame); drawFrame = 0; } points = []; fm.setInk(null); },
      });
      return () => { fm.setGesture(null); fm.setInk(null); };
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
    if (mode === 'route') {
      if (hit.kind === 'segment') setTaps((a) => [...a, hit.id]);
      else setTaps((a) => (a.includes(`${HOUSE_TAP}${hit.id}`) ? a.filter((t) => t !== `${HOUSE_TAP}${hit.id}`) : [...a, `${HOUSE_TAP}${hit.id}`])); // a second tap takes the house out again
    }
    return true;
  }, [active, mode]);

  // the route is kept when nothing could be applied (e.g. it lies in somebody else's Area), so it can be corrected instead of redone
  const applyRoute = (status: Status): boolean => {
    if (!routeKeys.length || latest.current.apply(routeKeys, status, String(routeKeys.length)) === 0) return false;
    setTaps([]);
    return true;
  };
  const routeReady = mode === 'route' && routeKeys.length > 0 && (picked.length > 0 || (route?.state === 'selected' && anchors.length >= 2));
  return {
    mode, brush, withHouses, housesOnly,
    setMode: (m: MarkMode) => update({ mode: m }), setBrush: (b: Status) => update({ brush: b }),
    setWithHouses: (w: boolean) => update({ withHouses: w }), setHousesOnly: (h: boolean) => update({ housesOnly: h }),
    size, setSize: (z: BrushSize) => update({ size: z }),
    anchors, taps: taps.length, picked: picked.length, route, routeKeys, routeCount: routeIds.length, routeHouses, routeReady,
    undoAnchor: () => setTaps((a) => a.slice(0, -1)), clearAnchors: () => setTaps([]), applyRoute, onMapHit,
  };
}

export type Marking = ReturnType<typeof useMarking>;
