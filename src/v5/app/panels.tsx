import { versionLabel } from '../../pwa/version.ts';
import { useEffect, useMemo, useState } from 'react';
import { statusColors, type Theme } from '../map/fieldMap.ts';
import type { Meta } from './api.ts';
import { HINTS, LABELS, ORDER, STATUS_ICON, type Kind } from './labels.ts';
import { ago, emptyTally, percentOf, tallyTotal, type HouseStats, type Tally } from './stats.ts';
import { CountdownCard } from './roomsUi.tsx';
import { SheetFrame } from './sheet.tsx';
import { planIsEmpty, type ActionTemplate, type TemplatePlan } from '../areas/template.ts';
import type { ApplyProgress } from './templateApply.ts';
import { Icon, ListGroup, ListRow, Progress, Segmented, SwitchRow, type IconName } from '../../ui/index.ts';

export type MenuRow = { id: string; icon: IconName; label: string; hint?: string; badge?: number; href?: string; onClick?: () => void };
export type MenuGroup = { id: string; title?: string; rows: MenuRow[] };

/** The menu: a few titled groups of rows, ordered by how often they are needed. Rare things (look, hand, diagnosis) live one level down in the settings. */
export function HomeSheet({ groups, mode, identity, extra, onClose }: {
  groups: MenuGroup[];
  /** Admins switch between handing out and collecting here. */
  mode?: { value: 'distribution' | 'collection'; onChange: (value: 'distribution' | 'collection') => void };
  identity?: string; /** One more line under the name, for example the time left. */ extra?: React.ReactNode; onClose: () => void;
}) {
  return (
    <SheetFrame icon="menu" title="Menü" onClose={onClose} meta={identity || extra ? <><span>{identity && <Icon name="users" size={16} />}{identity}</span>{extra}</> : undefined}>
      {mode && <Segmented label="Modus" value={mode.value} onChange={mode.onChange} options={[{ value: 'distribution', label: 'Austeilen', icon: 'mailbox' }, { value: 'collection', label: 'Abholen', icon: 'paw' }]} />}
      {groups.map((g) => (
        <ListGroup key={g.id} title={g.title}>
          {g.rows.map((r) => <ListRow key={r.id} icon={r.icon} label={r.label} hint={r.hint} badge={r.badge} href={r.href} onClick={r.onClick} />)}
        </ListGroup>
      ))}
      <p className="v5-hint">Kartendaten © OpenStreetMap-Mitwirkende · OpenMapTiles · OpenFreeMap</p>
      <p className="v5-hint v5-version" aria-label={`App-Version ${versionLabel()}`}>{versionLabel()}</p>
    </SheetFrame>
  );
}

/** Look and feel on one page: appearance, accent colour, handedness, basemap. Nothing here changes the data. */
export function SettingsSheet({ theme, onTheme, hand, onHand, baseOn, onBase, awake, onAwake, haptics, onHaptics, onPalette, extraRows, onBack, onClose }: {
  theme: Theme; onTheme(theme: Theme): void; hand: 'right' | 'left'; onHand(hand: 'right' | 'left'): void; baseOn: boolean; onBase(on: boolean): void; awake: boolean; onAwake(on: boolean): void; haptics: boolean; onHaptics(on: boolean): void;
  onPalette(): void; extraRows: MenuRow[]; onBack(): void; onClose(): void;
}) {
  return (
    <SheetFrame icon="settings" title="Einstellungen" onBack={onBack} onClose={onClose}>
      <ListGroup title="Darstellung">
        <Segmented label="Hell oder dunkel" value={theme} onChange={onTheme} options={[{ value: 'dark', label: 'Dunkel', icon: 'moon' }, { value: 'light', label: 'Hell', icon: 'sun' }]} />
        <ListRow icon="palette" label="Farbe" hint="Akzentfarbe der App" onClick={onPalette} />
      </ListGroup>
      <ListGroup title="Bedienung">
        <Segmented label="Bedienhand" value={hand} onChange={onHand} options={[{ value: 'right', label: 'Rechtshand', icon: 'hand' }, { value: 'left', label: 'Linkshand', icon: 'hand' }]} />
      </ListGroup>
      <ListGroup title="Unterwegs">
        <SwitchRow icon="sun" label="Bildschirm anlassen" hint="Das Display dimmt nicht, solange die App offen ist" checked={awake} onChange={onAwake} />
        <SwitchRow icon="check" label="Kurz vibrieren beim Markieren" hint="Nur auf Geräten, die das können (nicht iPhone)" checked={haptics} onChange={onHaptics} />
      </ListGroup>
      <ListGroup title="Karte">
        <SwitchRow icon="layers" label="Straßenkarte darunter" hint="Aus: nur Straßen, Häuser und Gebiete" checked={baseOn} onChange={onBase} />
      </ListGroup>
      {extraRows.length > 0 && (
        <ListGroup title="Mehr">
          {extraRows.map((r) => <ListRow key={r.id} icon={r.icon} label={r.label} hint={r.hint} onClick={r.onClick} />)}
        </ListGroup>
      )}
    </SheetFrame>
  );
}

/** Aktions-Vorlagen: load one from a file, or keep the current Gebiete and Gruppen as a file. */
export function TemplatesSheet({ canLoad, canSave, onLoad, onSave, onBack, onClose }: { canLoad: boolean; canSave: boolean; onLoad(): void; onSave(): void; onBack(): void; onClose(): void }) {
  return (
    <SheetFrame icon="upload" title="Vorlagen" onBack={onBack} onClose={onClose}>
      <p className="v5-hint"><Icon name="info" size={20} />Eine Vorlage hält Gebiete und Gruppen einer Aktion fest, ohne Personen und ohne Fortschritt. Damit lässt sich eine Aktion schnell wieder aufsetzen.</p>
      <ListGroup>
        {canLoad && <ListRow icon="upload" label="Vorlage laden" hint="Datei wählen, vorher wird gezeigt, was sich ändert" onClick={onLoad} />}
        {canSave && <ListRow icon="download" label="Als Vorlage speichern" hint="Gebiete und Gruppen dieser Aktion als Datei" onClick={onSave} />}
      </ListGroup>
    </SheetFrame>
  );
}

type OverviewProps = {
  kind: Kind;
  theme: Theme;
  stats: HouseStats;
  areas: Meta['areas'];
  teams: Meta['teams'];
  sync: { state: 'idle' | 'syncing' | 'offline'; pending: number; lastOkAt: number | null; lastError: string | null };
  conflicts: number;
  engine: string;
  /** The Aktion's time window (distribution only) and the server clock the countdown follows. */
  window?: { startsAt: string | null; endsAt: string | null } | null;
  serverNow?: () => number;
  /** An admin's way to make the numbers cover the whole Aktion although only some parts are on the device (see `completeSizes`). */
  sizes?: { busy: { done: number; total: number; failed?: boolean } | null; onRun(): void };
  onFitArea(id: string): void;
  onSyncNow(): void;
  onConflicts(): void;
  onClose(): void;
};

/** Progress by houses (overall, per Area, per Team), what the colours mean, and the honest state of the sync. */
export function OverviewSheet({ kind, theme, stats, areas, teams, sync, conflicts, engine, window: timeWindow, serverNow, sizes, onFitArea, onSyncNow, onConflicts, onClose }: OverviewProps) {
  const labels = LABELS[kind], colors = statusColors(theme);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 10_000); return () => window.clearInterval(t); }, []);
  const overall = stats.overall, total = tallyTotal(overall), percent = percentOf(overall);
  const byTeam = useMemo(() => {
    const map = new Map<string, { name: string; color: string; tally: Tally }>();
    for (const area of areas) {
      const t = stats.byArea.get(area.id);
      if (!t) continue;
      const team = teams.find((x) => x.id === area.teamId);
      if (!team) continue;
      const entry = map.get(team.id) ?? { name: team.name, color: team.color, tally: emptyTally() };
      for (const s of ORDER) entry.tally[s] += t[s];
      map.set(team.id, entry);
    }
    return [...map.values()];
  }, [areas, teams, stats]);
  const state = sync.state === 'offline' ? 'offline' : sync.pending > 0 || sync.state === 'syncing' ? 'busy' : 'ok';
  const headline = state === 'ok' ? 'Alles gespeichert' : state === 'busy' ? `${sync.pending} Änderungen werden gesendet` : `Offline – ${sync.pending} Änderungen warten`;
  return (
    <SheetFrame icon="chart" title="Übersicht" onClose={onClose} meta={<span><Icon name="house" size={16} />{total.toLocaleString('de')} Häuser</span>}>
      {kind === 'distribution' && timeWindow && serverNow && <CountdownCard window={timeWindow} now={serverNow} progress={percent} />}
      {sizes && (
        <div className="v5-row" role="status">
          <p className="v5-hint"><Icon name="info" size={20} />{sizes.busy && !sizes.busy.failed ? `Größe der Kartenteile wird ermittelt · ${sizes.busy.done}/${sizes.busy.total}` : sizes.busy?.failed ? 'Das Ermitteln ist fehlgeschlagen.' : 'Die Zahlen zählen nur die geladenen Kartenteile.'}</p>
          <button className="v5-btn" onClick={sizes.onRun} disabled={!!sizes.busy && !sizes.busy.failed}><Icon name="sync" size={20} />{sizes.busy?.failed ? 'Erneut versuchen' : 'Alle Teile einmal berechnen'}</button>
        </div>
      )}
      <div className="v5-bignum" aria-label={`${percent} Prozent der Häuser`}>{percent}<small>%</small></div>
      <Progress value={percent / 100} label="Fortschritt nach Häusern" />
      <div className="v5-stats">
        {ORDER.map((s) => (
          <div key={s} className="v5-stat" style={{ '--c': colors[s] } as React.CSSProperties}><b>{overall[s].toLocaleString('de')}</b><small>{labels[s]}</small></div>
        ))}
      </div>
      <p className="v5-hint"><Icon name="info" size={20} />{`Der Fortschritt zählt Häuser. „${labels['not-deliverable']}“ wird von der Gesamtzahl abgezogen.`}</p>
      {areas.length > 1 && (<>
        <h3>Gebiete</h3>
        <div className="v5-list">
          {areas.map((a) => { const t = stats.byArea.get(a.id); const p = t ? percentOf(t) : 0; return (
            <button key={a.id} className="v5-areabar" onClick={() => onFitArea(a.id)} aria-label={`${a.name}: ${p} Prozent, zeigen`}>
              <div><b>{a.name}</b><span>{t ? `${t.completed.toLocaleString('de')} / ${(tallyTotal(t) - t['not-deliverable']).toLocaleString('de')}` : '–'} · {p} %</span></div>
              <div className="v5-bar" style={{ '--p': p / 100 } as React.CSSProperties}><i /></div>
            </button>
          ); })}
        </div>
      </>)}
      {byTeam.length > 1 && (<>
        <h3>Gruppen</h3>
        <div className="v5-list">
          {byTeam.map((t) => (
            <div key={t.name} className="v5-areabar" style={{ cursor: 'default' }}>
              <div><b><span className="v5-dotc" style={{ background: t.color }} />{t.name}</b><span>{percentOf(t.tally)} %</span></div>
              <div className="v5-bar" style={{ '--p': percentOf(t.tally) / 100 } as React.CSSProperties}><i /></div>
            </div>
          ))}
        </div>
      </>)}
      {(state !== 'ok' || conflicts > 0) && (<>
        <h3>Synchronisierung</h3>
        <div className={`v5-syncbox${sync.lastError && state !== 'ok' ? ' bad' : ''}`} role="status">
          <span><Icon name={state === 'offline' ? 'cloudOff' : 'sync'} size={18} /> {headline}</span>
          <small>Zuletzt erfolgreich: {ago(sync.lastOkAt, now)}</small>
          {sync.lastError && <small>Letzter Fehler: {sync.lastError}</small>}
        </div>
        <div className="v5-row">
          {state !== 'ok' && <button className="v5-btn" onClick={onSyncNow} disabled={sync.state === 'syncing'}><Icon name="sync" size={20} />Jetzt abgleichen</button>}
          {conflicts > 0 && <button className="v5-btn" onClick={onConflicts}><Icon name="warning" size={20} />{conflicts} überschrieben</button>}
        </div>
      </>)}
    </SheetFrame>
  );
}

const names = (list: string[], max = 8) => (list.length > max ? `${list.slice(0, max).join(', ')} und ${list.length - max} weitere` : list.join(', '));

/** What loading an Aktions-Vorlage would do, before anything happens: new Gruppen and Gebiete, changed outlines, what stays. */
export function TemplateSheet({ template, plan, progress, onApply, onClose }: { template: ActionTemplate; plan: TemplatePlan; progress: ApplyProgress | null; onApply: () => void; onClose: () => void }) {
  const rows: { icon: IconName; title: string; text: string }[] = [
    plan.createTeams.length ? { icon: 'users', title: `${plan.createTeams.length} neue Gruppen`, text: names(plan.createTeams.map((t) => t.name)) } : null,
    plan.createAreas.length ? { icon: 'plus', title: `${plan.createAreas.length} neue Gebiete`, text: names(plan.createAreas.map((a) => a.name)) } : null,
    plan.reshapeAreas.length ? { icon: 'pen', title: `${plan.reshapeAreas.length} Gebiete mit neuem Umriss`, text: `${names(plan.reshapeAreas.map((a) => a.name))} – Markierungen außerhalb des neuen Umrisses werden entfernt` } : null,
    plan.unchanged.length ? { icon: 'check', title: `${plan.unchanged.length} unverändert`, text: names(plan.unchanged) } : null,
    plan.keep.length ? { icon: 'info', title: `${plan.keep.length} nicht in der Vorlage`, text: `${names(plan.keep)} – bleiben, wie sie sind` } : null,
    plan.skipped.length ? { icon: 'warning', title: `${plan.skipped.length} übersprungen`, text: plan.skipped.map((s) => `${s.name} (${s.reason})`).join(', ') } : null,
  ].filter((r): r is { icon: IconName; title: string; text: string } => r !== null);
  const empty = planIsEmpty(plan);
  return (
    <SheetFrame icon="upload" title="Aktions-Vorlage" onClose={onClose} meta={<span><Icon name="polygon" size={16} />{template.name} · {template.areas.length} Gebiete · {template.teams.length} Gruppen</span>}>
      <p className="v5-hint"><Icon name="info" size={20} />Die Umrisse sind auf der Karte zu sehen. Es wird nichts gelöscht und keine Person und kein Fortschritt aus der Vorlage übernommen.</p>
      <div className="v5-legend">
        {rows.map((r) => (
          <div key={r.title} className="v5-legend-row" style={{ '--c': 'var(--primary)' } as React.CSSProperties}>
            <span className="v5-swatch"><Icon name={r.icon} size={20} /></span>
            <div><b>{r.title}</b><small>{r.text}</small></div>
          </div>
        ))}
      </div>
      {empty && <p className="v5-hint"><Icon name="check" size={20} />Nichts zu tun: Die Aktion entspricht schon der Vorlage.</p>}
      {progress && <div className="v5-syncbox" role="status"><span><Icon name="sync" size={18} />{progress.done} / {progress.total}</span><small>{progress.label}</small><div className="v5-bar" style={{ '--p': progress.total ? progress.done / progress.total : 0 } as React.CSSProperties}><i /></div></div>}
      {!empty && <div className="v5-row" style={{ marginTop: '0.6rem' }}><button className="v5-btn primary" style={{ marginTop: 0 }} onClick={onApply} disabled={!!progress}><Icon name="check" size={20} />Anwenden</button></div>}
    </SheetFrame>
  );
}
