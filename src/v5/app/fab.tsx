import { useEffect, useRef } from 'react';
import { statusColors, type Theme } from '../map/fieldMap.ts';
import type { Status } from '../store/types.ts';
import { HINTS, LABELS, ORDER, STATUS_ICON, type Kind } from './labels.ts';
import { MODES, meters, type Marking } from './marking.tsx';
import { Icon } from '../../ui/index.ts';

/** idle: just the button. panel: counter / undo / discard / confirm. status: pick what the route becomes. options: modes, brush, filters. */
export type FabPhase = 'idle' | 'panel' | 'status' | 'options';
const LONG_PRESS_MS = 450;

/** Tap vs. long press on one element; a long press swallows the tap that follows it. */
function usePress(onTap: () => void, onLong?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  return {
    onPointerDown: () => { fired.current = false; if (onLong) timer.current = setTimeout(() => { timer.current = null; fired.current = true; onLong(); }, LONG_PRESS_MS); },
    onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel,
    onClick: () => { if (fired.current) { fired.current = false; return; } onTap(); },
    onContextMenu: (event: { preventDefault(): void }) => event.preventDefault(),
  };
}

type Props = {
  phase: FabPhase;
  setPhase(phase: FabPhase): void;
  marking: Marking;
  kind: Kind;
  theme: Theme;
  /** Revert the last applied change (the app's undo), if there is one. */
  canUndoLast: boolean;
  onUndoLast(): void;
};

/**
 * The one button that matters. A tap starts marking at once (route mode: tap points on the map), the button morphs into a small
 * panel, the check mark morphs it into the status choice, and a long press opens the larger options. No list, no extra screen.
 */
export function MarkFab({ phase, setPhase, marking, kind, theme, canUndoLast, onUndoLast }: Props) {
  const colors = statusColors(theme);
  const labels = LABELS[kind];
  const route = marking.mode === 'route';
  const modeMeta = MODES.find((m) => m.mode === marking.mode)!;
  const start = usePress(() => setPhase('panel'), () => setPhase('options'));
  const counter = usePress(() => setPhase('options'), () => setPhase('options'));
  const exit = () => { marking.clearAnchors(); setPhase('idle'); };
  const discard = () => { if (marking.anchors.length) marking.clearAnchors(); else exit(); };
  const cycleBrush = () => marking.setBrush(ORDER[(ORDER.indexOf(marking.brush) + 1) % ORDER.length]);
  const choose = (status: Status) => { marking.applyRoute(status); setPhase('panel'); };

  if (phase === 'idle') {
    return (
      <div className="v5-fab" data-state="idle">
        <button className="v5-fab-main" {...start} aria-label="Markieren starten" title="Markieren (lange drücken für Optionen)"><Icon name={modeMeta.icon} size={30} /></button>
      </div>
    );
  }

  return (
    <div className="v5-fab" data-state={phase} role="group" aria-label="Markieren">
      {phase === 'panel' && (
        <div className="v5-fab-grid">
          {route
            ? <button className="v5-tile" {...counter} aria-label={`${marking.anchors.length} Punkte – Optionen`} title="Punkte – antippen für Optionen"><b>{marking.anchors.length}</b><small>Punkte</small></button>
            : <button className="v5-tile" {...counter} aria-label={`${modeMeta.label} – Optionen`} title="Optionen"><Icon name={modeMeta.icon} size={24} /><small>{modeMeta.label}</small></button>}
          {route
            ? <button className="v5-tile" onClick={marking.undoAnchor} disabled={!marking.anchors.length} aria-label="Letzten Punkt entfernen" title="Letzten Punkt entfernen"><Icon name="undo" size={24} /><small>Zurück</small></button>
            : <button className="v5-tile" onClick={onUndoLast} disabled={!canUndoLast} aria-label="Letzte Markierung rückgängig" title="Letzte Markierung rückgängig"><Icon name="undo" size={24} /><small>Zurück</small></button>}
          <button className="v5-tile" onClick={discard} aria-label={route && marking.anchors.length ? 'Punkte verwerfen' : 'Markieren beenden'} title={route && marking.anchors.length ? 'Alle Punkte verwerfen' : 'Markieren beenden'}>
            <Icon name={route && marking.anchors.length ? 'trash' : 'close'} size={24} /><small>{route && marking.anchors.length ? 'Leeren' : 'Fertig'}</small>
          </button>
          {route
            ? <button className="v5-tile go" onClick={() => setPhase('status')} disabled={!marking.routeReady} aria-label="Strecke bestätigen" title="Strecke bestätigen"><Icon name="check" size={30} /></button>
            : <button className="v5-tile status" style={{ '--c': colors[marking.brush] } as React.CSSProperties} onClick={cycleBrush} aria-label={`Pinsel: ${labels[marking.brush]}`} title={`Pinsel: ${labels[marking.brush]} (antippen zum Wechseln)`}><Icon name={STATUS_ICON[marking.brush]} size={24} /><small>{labels[marking.brush]}</small></button>}
        </div>
      )}
      {phase === 'status' && (
        <div className="v5-fab-grid">
          {ORDER.map((status) => (
            <button key={status} className="v5-tile status" style={{ '--c': colors[status] } as React.CSSProperties} onClick={() => choose(status)} aria-label={labels[status]} title={HINTS[kind][status]}>
              <Icon name={STATUS_ICON[status]} size={26} /><small>{labels[status]}</small>
            </button>
          ))}
        </div>
      )}
      {phase === 'options' && (
        <div className="v5-fab-grid">
          {MODES.map((m) => (
            <button key={m.mode} className={`v5-tile${marking.mode === m.mode ? ' on' : ''}`} onClick={() => marking.setMode(m.mode)} aria-pressed={marking.mode === m.mode} aria-label={m.label} title={m.label}><Icon name={m.icon} size={24} /><small>{m.label}</small></button>
          ))}
          {ORDER.map((status) => (
            <button key={status} className={`v5-tile status${marking.brush === status ? ' on' : ''}`} style={{ '--c': colors[status] } as React.CSSProperties} disabled={route}
              onClick={() => marking.setBrush(status)} aria-pressed={marking.brush === status} aria-label={labels[status]} title={route ? 'Bei „Strecke“ wählst du den Status nach dem Bestätigen' : HINTS[kind][status]}>
              <Icon name={STATUS_ICON[status]} size={24} /><small>{labels[status]}</small>
            </button>
          ))}
          <button className={`v5-tile${marking.withHouses ? ' on' : ''}`} onClick={() => marking.setWithHouses(!marking.withHouses)} aria-pressed={marking.withHouses} aria-label="Häuser mitmarkieren" title="Häuser an der Straße mitmarkieren"><Icon name="house" size={24} /><small>+ Häuser</small></button>
          <button className={`v5-tile${marking.housesOnly ? ' on' : ''}`} onClick={() => marking.setHousesOnly(!marking.housesOnly)} aria-pressed={marking.housesOnly} aria-label="Nur Straßen mit Häusern" title="Straßen ohne Häuser auslassen und ausblenden"><Icon name="road" size={24} /><small>Nur mit Haus</small></button>
          <button className="v5-tile" onClick={exit} aria-label="Markieren beenden" title="Markieren beenden"><Icon name="close" size={24} /><small>Beenden</small></button>
          <button className="v5-tile go" onClick={() => setPhase('panel')} aria-label="Weiter markieren" title="Weiter markieren"><Icon name="check" size={30} /></button>
        </div>
      )}
    </div>
  );
}

/** One line above the button: what the route is right now, or which tool is active. */
export function FabCaption({ marking, kind }: { marking: Marking; kind: Kind }) {
  let text: string;
  let warn = false;
  if (marking.mode !== 'route') text = `${MODES.find((m) => m.mode === marking.mode)!.label} · ${LABELS[kind][marking.brush]}`;
  else if (marking.anchors.length === 0) text = 'Startpunkt auf einer Straße antippen';
  else if (marking.route?.state === 'disconnected') { text = 'Nicht verbunden – anderen Punkt wählen'; warn = true; }
  else if (marking.anchors.length === 1) text = 'Endpunkt antippen';
  else if (marking.route?.state === 'selected') {
    text = `${marking.routeCount} Straßen · ${marking.routeHouses} Häuser · ${meters(marking.route.length)}`;
    if (marking.route.ambiguous) { text += ' · Zwischenpunkt?'; warn = true; }
  } else text = 'Keine Strecke';
  return <div className={`v5-caption${warn ? ' warn' : ''}`} role="status"><Icon name={warn ? 'warning' : marking.mode === 'route' ? 'route' : 'tap'} size={18} />{text}</div>;
}
