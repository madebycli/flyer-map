import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/index.ts';
import { MARGIN, RATIO, clampBox, snapBox, type PipBox } from './pipBox.ts';

/**
 * Brainrot mode: hold the menu button for five seconds and a muted loop plays in a small window. The window is a picture-in-picture like the one
 * on an iPad: one finger moves it (it settles in the nearest corner), two fingers or the handle in its corner make it bigger or smaller, the
 * cross closes it. The player's own surface is hidden: no controls, the frame is cropped, and a transparent layer takes every touch.
 */
const HOLD_MS = 5000;
const VIDEO_IDS = ['RbVMiu4ubT0', '91aqFhjxWB4'] as const;
const KEY = 'vf-v5-pip';
const read = (): PipBox | null => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PipBox> | null; return v && [v.x, v.y, v.w].every((n) => Number.isFinite(n)) ? { x: v.x as number, y: v.y as number, w: v.w as number } : null; } catch { return null; }
};
const save = (b: PipBox) => { try { localStorage.setItem(KEY, JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w) })); } catch { /* private mode */ } };

const url = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&playsinline=1&rel=0&modestbranding=1&disablekb=1&fs=0&iv_load_policy=3`;

export function FocusVideo() {
  const [index, setIndex] = useState(-1);
  const [box, setBox] = useState<PipBox>(() => clampBox(read() ?? { x: 9999, y: 70, w: 240 }, window.innerWidth, window.innerHeight));
  const [moving, setMoving] = useState(false);
  const boxRef = useRef(box);
  boxRef.current = box;
  const open = index >= 0;

  // Holding the menu button for five seconds opens or closes the window; the click that ends the hold must not open the menu.
  useEffect(() => {
    let timer: number | undefined, consume = false;
    const onMenu = (e: Event) => (e.target instanceof Element ? e.target.closest('button[aria-label="Menü"]') : null);
    const clear = () => { if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; } };
    const down = (e: PointerEvent) => {
      if (!onMenu(e)) return;
      clear(); consume = false;
      timer = window.setTimeout(() => {
        timer = undefined; consume = true;
        setIndex((i) => (i >= 0 ? -1 : Math.floor(Math.random() * VIDEO_IDS.length)));
        navigator.vibrate?.(35);
      }, HOLD_MS);
    };
    const click = (e: MouseEvent) => { if (consume && onMenu(e)) { consume = false; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } };
    const menu = (e: MouseEvent) => { if (onMenu(e) && (timer !== undefined || consume)) e.preventDefault(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', clear, true);
    document.addEventListener('pointercancel', clear, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', menu, true);
    return () => {
      clear();
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', clear, true);
      document.removeEventListener('pointercancel', clear, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', menu, true);
    };
  }, []);

  // The window stays on the screen when the screen turns or shrinks.
  useEffect(() => {
    const fit = () => setBox((b) => clampBox(b, window.innerWidth, window.innerHeight));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Touches: one pointer moves, two pointers scale around their middle.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ box: PipBox; ids: number[]; start: { x: number; y: number }[] } | null>(null);
  const begin = () => {
    const ids = [...pointers.current.keys()].slice(0, 2);
    gesture.current = { box: boxRef.current, ids, start: ids.map((id) => ({ ...pointers.current.get(id)! })) };
  };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setMoving(true); begin();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const now = g.ids.map((id) => pointers.current.get(id)).filter((p): p is { x: number; y: number } => !!p);
    if (g.start.length === 2 && now.length === 2) {
      const d0 = Math.hypot(g.start[0].x - g.start[1].x, g.start[0].y - g.start[1].y) || 1, d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
      const w = g.box.w * (d1 / d0);
      const c0 = { x: (g.start[0].x + g.start[1].x) / 2, y: (g.start[0].y + g.start[1].y) / 2 }, c1 = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
      // the point of the window under the middle of the fingers stays under it
      const k = w / g.box.w;
      setBox(clampBox({ w, x: c1.x - (c0.x - g.box.x) * k, y: c1.y - (c0.y - g.box.y) * k }, window.innerWidth, window.innerHeight));
    } else if (now.length === 1) {
      setBox(clampBox({ ...g.box, x: g.box.x + now[0].x - g.start[0].x, y: g.box.y + now[0].y - g.start[0].y }, window.innerWidth, window.innerHeight));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) { begin(); return; } // one finger stays: it carries on as a move from where the window is now
    gesture.current = null; setMoving(false);
    const settled = snapBox(boxRef.current, window.innerWidth, window.innerHeight);
    setBox(settled); save(settled);
  };
  // The handle in the corner: one finger makes the window bigger or smaller.
  const resize = useRef<{ x: number; w: number } | null>(null);
  const handleDown = (e: React.PointerEvent) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); resize.current = { x: e.clientX, w: boxRef.current.w }; setMoving(true); };
  const handleMove = (e: React.PointerEvent) => { const r = resize.current; if (r) setBox((b) => clampBox({ ...b, w: r.w + (e.clientX - r.x) }, window.innerWidth, window.innerHeight)); };
  const handleUp = () => { if (!resize.current) return; resize.current = null; setMoving(false); const s = snapBox(boxRef.current, window.innerWidth, window.innerHeight); setBox(s); save(s); };

  if (!open) return null;
  const h = box.w * RATIO;
  return (
    <aside className={`v5-pip${moving ? ' moving' : ''}`} style={{ left: box.x, top: box.y, width: box.w, height: h }} aria-label="Fokus-Video">
      <div className="v5-pip-frame">
        <iframe src={url(VIDEO_IDS[index])} title="Fokus-Video" allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" tabIndex={-1} />
      </div>
      <div className="v5-pip-touch" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <button type="button" className="v5-pip-close" onClick={() => setIndex(-1)} aria-label="Video schließen" title="Video schließen"><Icon name="close" size={20} /></button>
      <div className="v5-pip-handle" onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleUp} role="separator" aria-label="Größe ändern" />
    </aside>
  );
}
