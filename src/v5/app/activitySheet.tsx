import { useEffect, useMemo, useState } from 'react';
import { statusColors, type Theme } from '../map/fieldMap.ts';
import type { EntityKey } from '../store/types.ts';
import { deriveActivity, type FeedItem } from './activity.ts';
import { LABELS, STATUS_ICON, type Kind } from './labels.ts';
import { SheetFrame } from './sheet.tsx';
import type { FieldStore } from '../store/store.ts';
import { ago } from './stats.ts';
import { Icon } from '../../ui/index.ts';

type Props = { kind: Kind; theme: Theme; store: FieldStore; version: unknown; myLabel: string; labelOf(key: EntityKey): string; onPick(key: EntityKey): void; onClose(): void };

/** Team and activity in one place: who has brought in how many houses (today, this week, in total) and the latest changes. */
export function ActivitySheet({ kind, theme, store, version, myLabel, labelOf, onPick, onClose }: Props) {
  const labels = LABELS[kind], colors = statusColors(theme);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(t); }, []);
  // `version` changes whenever the overlay does; the derivation walks every entry once, never per frame.
  const activity = useMemo(() => deriveActivity(store.entries(), now, 40, new Map([[store.actor, myLabel]])), [store, version, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = activity.people[0]?.completed ?? 0;
  return (
    <SheetFrame icon="users" title="Team & Aktivität" onClose={onClose} meta={<span><Icon name="house" size={16} />{activity.todayTotal} heute · {activity.weekTotal} in 7 Tagen</span>}>
      {!activity.people.length && !activity.feed.length && <p className="v5-hint"><Icon name="info" size={20} />Noch nichts markiert.</p>}
      {activity.people.length > 0 && (<>
        <h3>Wer hat wie viel</h3>
        <div className="v5-list">
          {activity.people.map((p) => (
            <div key={p.name} className="v5-areabar" style={{ cursor: 'default' }}>
              <div><b>{p.name}{p.name === myLabel ? ' (du)' : ''}</b><span>{p.completed.toLocaleString('de')} {labels.completed.toLowerCase()}</span></div>
              <div className="v5-bar" style={{ '--p': top ? p.completed / top : 0 } as React.CSSProperties}><i /></div>
              <span>{p.today} heute · {p.week} in 7 Tagen · zuletzt {ago(p.lastAt, now)}</span>
            </div>
          ))}
        </div>
      </>)}
      {activity.feed.length > 0 && (<>
        <h3>Zuletzt</h3>
        <ul className="v5-note-list" aria-label="Letzte Änderungen">
          {activity.feed.map((item: FeedItem) => (
            <li key={`${item.key}:${item.at}`}>
              <button className="v5-note v5-note-open" onClick={() => onPick(item.key)} style={{ '--c': colors[item.status] } as React.CSSProperties}>
                <span className="v5-note-ico"><Icon name={STATUS_ICON[item.status]} size={20} /></span>
                <span className="v5-note-body"><span>{labelOf(item.key)}</span><small>{labels[item.status]} · {item.by} · {ago(item.at, now)}</small></span>
              </button>
            </li>
          ))}
        </ul>
      </>)}
    </SheetFrame>
  );
}
