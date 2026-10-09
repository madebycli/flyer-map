import { statusColors, type Theme } from '../map/fieldMap.ts';
import type { Status } from '../store/types.ts';
import { HINTS, ORDER, STATUS_ICON, type Kind } from './labels.ts';
import { Icon, type IconName } from '../../ui/index.ts';

/** The bottom sheet every detail view uses: handle, badge, title, optional meta line, close. */
export function SheetFrame({ icon, title, meta, onClose, children }: { icon: IconName; title: string; meta?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
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
