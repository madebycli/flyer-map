import { useMemo, useRef, useState } from 'react';
import type { Meta } from './api.ts';
import { actionErrorText, areaPercent, areaView, type AreaView, type Me } from './collection.ts';
import { Icon, type IconName } from './ui.tsx';

type Area = Meta['areas'][number];
export type AreaStats = { done: number; total: number };

/** Outline colour of a collection Area: what is happening there, readable at a glance on the map. */
export const phaseColor = (view: AreaView): string => (view.phase === 'done' ? '#5fc79f' : view.phase === 'working' ? (view.inRoom ? '#8fb8ff' : '#d6b062') : '#8aa0b4');
const PHASE_LABEL: Record<AreaView['phase'], string> = { open: 'Offen', working: 'Wird bearbeitet', done: 'Erledigt' };
const PHASE_ICON: Record<AreaView['phase'], IconName> = { open: 'open', working: 'users', done: 'check' };

export function useAreaViews(meta: Meta | null, me: Me) {
  return useMemo(() => {
    const map = new Map<string, AreaView>();
    for (const area of meta?.areas ?? []) map.set(area.id, areaView(area, meta!.runs, me));
    return map;
  }, [meta, me]);
}

/** Runs one action at a time; a second tap while one is in flight does nothing (no double Room), failures say why. */
export function useActionRunner(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not the state: two taps inside one frame must still produce one action.
  const inFlight = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) { setError(actionErrorText(e)); }
    finally { try { await reload(); } catch { /* the next poll refreshes */ } inFlight.current = false; setBusy(false); }
  };
  return { busy, error, run, clear: () => setError(null) };
}

/** One row per Area: phase, who is in it, progress and the one action that makes sense next. */
export function AreaList({ areas, views, stats, onOpen, onClaim, onJoin, busy, canAct }: {
  areas: Area[]; views: Map<string, AreaView>; stats: Map<string, AreaStats>; onOpen: (id: string) => void;
  onClaim: (id: string) => void; onJoin: (runId: string) => void; busy: boolean; canAct: boolean;
}) {
  // working first, then open, finished last and greyed: finished Areas can never be taken again by accident
  const order = { working: 0, open: 1, done: 2 } as const;
  const sorted = [...areas].sort((a, b) => order[views.get(a.id)!.phase] - order[views.get(b.id)!.phase] || a.name.localeCompare(b.name, 'de', { numeric: true }));
  return (
    <div className="v5-list v5-arealist">
      {sorted.map((area) => {
        const view = views.get(area.id)!;
        const s = stats.get(area.id);
        const percent = s ? areaPercent(s.done, s.total, view.phase) : view.phase === 'done' ? 100 : null;
        return (
          <div key={area.id} className={`v5-arearow ${view.phase}`} data-phase={view.phase}>
            <button className="v5-arearow-main" onClick={() => onOpen(area.id)} aria-label={`${area.name}: ${PHASE_LABEL[view.phase]}${percent !== null ? `, ${percent} Prozent` : ''}`}>
              <span className="v5-arearow-badge"><Icon name={PHASE_ICON[view.phase]} size={22} /></span>
              <span className="v5-arearow-text">
                <b>{area.name}</b>
                <small>{PHASE_LABEL[view.phase]}{view.members.length ? ` · ${view.members.join(', ')}` : ''}</small>
              </span>
              <span className="v5-arearow-pct">{percent === null ? '' : <>{percent}<small>%</small></>}</span>
            </button>
            {canAct && view.canClaim && <button className="v5-icon-btn tonal" disabled={busy} onClick={() => onClaim(area.id)} aria-label={`${area.name} übernehmen`} title="Übernehmen"><Icon name="hand" size={22} /></button>}
            {canAct && view.canJoin && view.runId && <button className="v5-icon-btn tonal" disabled={busy} onClick={() => onJoin(view.runId!)} aria-label={`${area.name}: teilnehmen`} title="Teilnehmen"><Icon name="users" size={22} /></button>}
          </div>
        );
      })}
    </div>
  );
}

/** Actions of one Area as an icon row; only what the server state allows is offered. */
export function AreaActions({ view, busy, error, onClaim, onJoin, onLeave, onRelease, onComplete, onFit, canAct }: {
  view: AreaView; busy: boolean; error: string | null; canAct: boolean; onFit: () => void;
  onClaim: () => void; onJoin: () => void; onLeave: () => void; onRelease: () => void; onComplete: () => void;
}) {
  return (
    <>
      <div className="v5-row v5-actions">
        <button className="v5-icon-btn tonal" onClick={onFit} aria-label="Gebiet zeigen" title="Gebiet zeigen"><Icon name="fit" /></button>
        {canAct && view.canClaim && <button className="v5-go" disabled={busy} onClick={onClaim} aria-label="Übernehmen" title="Übernehmen"><Icon name="hand" size={26} /></button>}
        {canAct && view.canJoin && <button className="v5-go" disabled={busy} onClick={onJoin} aria-label="Teilnehmen" title="Teilnehmen"><Icon name="users" size={26} /></button>}
        {canAct && view.canComplete && <button className="v5-go" disabled={busy} onClick={onComplete} aria-label="Gebiet erledigt" title="Gebiet erledigt"><Icon name="check" size={26} /></button>}
        {canAct && view.canRelease && <button className="v5-icon-btn tonal" disabled={busy} onClick={onRelease} aria-label="Gebiet freigeben" title="Gebiet freigeben"><Icon name="unlock" /></button>}
        {canAct && view.canLeave && <button className="v5-icon-btn tonal" disabled={busy} onClick={onLeave} aria-label="Raum verlassen" title="Raum verlassen"><Icon name="exit" /></button>}
      </div>
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
    </>
  );
}

/** The Room: who is in it right now. */
export function RoomStrip({ members, me }: { members: string[]; me: Me }) {
  if (!members.length) return null;
  return (
    <div className="v5-room" aria-label="Arbeitsraum">
      {members.map((label, i) => <span key={`${label}${i}`} className={`v5-member${me && label === me.label ? ' me' : ''}`} title={label}><Icon name="users" size={14} />{label}</span>)}
    </div>
  );
}
