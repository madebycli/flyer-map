import { useRef, useState } from 'react';
import { statusColors, type Theme } from '../map/fieldMap.ts';
import type { Status } from '../store/types.ts';
import { HINTS, ORDER, STATUS_ICON, type Kind } from './labels.ts';
import { Icon, type IconName } from '../../ui/index.ts';

/**
 * The bottom sheet every detail view uses: handle, badge, title, optional meta line, close.
 * The handle is a real control: drag it down (or tap it) and the sheet shrinks to its header, so the map is free without losing the place;
 * drag it up (or tap again) and the sheet is back. Closing stays the job of the X.
 */
export function SheetFrame({ icon, title, meta, onClose, children }: { icon: IconName; title: string; meta?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const [small, setSmall] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const reset = () => { const el = sheet.current; if (el) { el.style.transition = ''; el.style.transform = ''; } };
  const onDown = (event: React.PointerEvent<HTMLDivElement>) => { drag.current = { y: event.clientY, dy: 0 }; event.currentTarget.setPointerCapture(event.pointerId); };
  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.dy = event.clientY - d.y;
    const el = sheet.current;
    if (el && !small) { el.style.transition = 'none'; el.style.transform = `translateY(${Math.max(0, d.dy)}px)`; } // the sheet follows the finger on its way down
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    reset();
    if (!d) return;
    if (Math.abs(d.dy) < 8) setSmall((value) => !value);
    else if (d.dy > 40) setSmall(true);
    else if (d.dy < -40) setSmall(false);
  };
  return (
    <section ref={sheet} className={`v5-sheet${small ? ' small' : ''}`} aria-label={title}>
      <div className="v5-handle" role="button" tabIndex={0} aria-label={small ? 'Fenster vergrößern' : 'Fenster verkleinern'} aria-expanded={!small}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; reset(); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSmall((value) => !value); } }}><i aria-hidden /></div>
      <header>
        <span className="v5-badge"><Icon name={icon} size={26} /></span>
        <div className="v5-head-text"><h2>{title}</h2>{meta && <div className="v5-meta">{meta}</div>}</div>
        <button className="v5-icon-btn" onClick={onClose} aria-label="Schließen" title="Schließen"><Icon name="close" /></button>
      </header>
      {children}
    </section>
  );
}

/** Four equal squares, icon over a short label; the hint under them explains the selected (or last touched) status. */
export function StatusGroup({ current, onPick, theme, labels, kind }: { current?: Status; onPick: (status: Status) => void; theme: Theme; labels: Record<Status, string>; kind: Kind }) {
  const colors = statusColors(theme);
  return (
    <>
      <div className="v5-seg" role="group" aria-label="Status">
        {ORDER.map((status) => (
          <button key={status} className={`v5-status v5-seg-btn${current === status ? ' on' : ''}`} style={{ '--c': colors[status] } as React.CSSProperties}
            onClick={() => onPick(status)} aria-pressed={current === status} aria-label={labels[status]} title={HINTS[kind][status]}>
            <Icon name={STATUS_ICON[status]} size={26} />
            <span>{labels[status]}</span>
          </button>
        ))}
      </div>
      {current && <p className="v5-hint v5-statushint">{HINTS[kind][current]}</p>}
    </>
  );
}
