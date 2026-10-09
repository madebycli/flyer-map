import { useEffect, useMemo, useRef, useState } from 'react';
import { statusColors, type Theme } from '../map/fieldMap.ts';
import type { Meta } from './api.ts';
import { HINTS, LABELS, ORDER, STATUS_ICON, type Kind } from './labels.ts';
import type { SearchHit } from './search.ts';
import type { EngineClient } from './engineClient.ts';
import { ago, emptyTally, percentOf, tallyTotal, type HouseStats, type Tally } from './stats.ts';
import { SheetFrame } from './sheet.tsx';
import { planIsEmpty, type ActionTemplate, type TemplatePlan } from '../areas/template.ts';
import type { ApplyProgress } from './templateApply.ts';
import { Icon, WavyProgress, type IconName } from './ui.tsx';

export type AppTile = { id: string; icon: IconName; label: string; on?: boolean; badge?: number; href?: string; onClick?: () => void; wide?: boolean };

/** The Home menu: an app-icon grid of squares. Rare things live here so the map stays free for the one thing that is done all day. */
export function HomeSheet({ tiles, identity, onClose }: { tiles: AppTile[]; identity?: string; onClose: () => void }) {
  return (
    <SheetFrame icon="grid" title="Menü" onClose={onClose} meta={identity ? <span><Icon name="users" size={16} />{identity}</span> : undefined}>
      <div className="v5-home">
        {tiles.map((t) => {
          const body = <><Icon name={t.icon} size={t.wide ? 26 : 28} /><span>{t.label}</span>{t.badge ? <em>{t.badge}</em> : null}</>;
          const cls = `v5-app${t.on ? ' on' : ''}${t.wide ? ' wide' : ''}`;
          return t.href
            ? <a key={t.id} className={cls} href={t.href} aria-label={t.label}>{body}</a>
            : <button key={t.id} className={cls} onClick={t.onClick} aria-pressed={t.on} aria-label={t.label}>{body}</button>;
        })}
      </div>
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
  onFitArea(id: string): void;
  onSyncNow(): void;
  onConflicts(): void;
  onClose(): void;
};

/** Progress by houses (overall, per Area, per Team), what the colours mean, and the honest state of the sync. */
export function OverviewSheet({ kind, theme, stats, areas, teams, sync, conflicts, engine, onFitArea, onSyncNow, onConflicts, onClose }: OverviewProps) {
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
      <div className="v5-bignum" aria-label={`${percent} Prozent der Häuser`}>{percent}<small>%</small></div>
      <WavyProgress value={percent / 100} label="Fortschritt nach Häusern" />
      <div className="v5-stats">
        {ORDER.map((s) => (
          <div key={s} className="v5-stat" style={{ '--c': colors[s] } as React.CSSProperties}><b>{overall[s].toLocaleString('de')}</b><small>{labels[s]}</small></div>
        ))}
      </div>
      <h3>Fortschritt zählt Häuser, nicht Straßen</h3>
      <p className="v5-hint">„Nicht möglich“ zählt nicht gegen den Fortschritt.</p>
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
      <h3>Synchronisierung</h3>
      <div className={`v5-syncbox${sync.lastError && state !== 'ok' ? ' bad' : ''}`} role="status">
        <span><Icon name={state === 'ok' ? 'cloudOk' : state === 'offline' ? 'cloudOff' : 'sync'} size={18} /> {headline}</span>
        <small>Zuletzt erfolgreich: {ago(sync.lastOkAt, now)}</small>
        {sync.lastError && <small>Letzter Fehler: {sync.lastError}</small>}
      </div>
      <div className="v5-row" style={{ marginTop: '0.5rem' }}>
        <button className="v5-btn" style={{ marginTop: 0 }} onClick={onSyncNow} disabled={sync.state === 'syncing'}><Icon name="sync" size={20} />Jetzt abgleichen</button>
        {conflicts > 0 && <button className="v5-btn" style={{ marginTop: 0 }} onClick={onConflicts}><Icon name="warning" size={20} />{conflicts} überschrieben</button>}
      </div>
      <h3>Was bedeuten die Farben?</h3>
      <div className="v5-legend">
        {ORDER.map((s) => (
          <div key={s} className="v5-legend-row" style={{ '--c': colors[s] } as React.CSSProperties}>
            <span className="v5-swatch"><Icon name={STATUS_ICON[s]} size={20} /></span>
            <div><b>{labels[s]}</b><small>{HINTS[kind][s]}</small></div>
          </div>
        ))}
      </div>
      <p className="v5-hint v5-foot">Kartenmotor: {engine}</p>
    </SheetFrame>
  );
}

/** Street and house-number search, answered by the engine (Rust); picking a result flies there and opens it. */
export function SearchSheet({ engine, onPick, onClose }: { engine: EngineClient | null; onPick: (entry: SearchHit) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!engine || !query.trim()) { setResults([]); return; }
    let stale = false;
    const timer = window.setTimeout(() => { engine.search(query).then((hits) => { if (!stale) setResults(hits); }, () => { if (!stale) setResults([]); }); }, 50);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [engine, query]);
  return (
    <SheetFrame icon="search" title="Suche" onClose={onClose}>
      <div className="v5-row"><input ref={input} className="v5-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Straße oder Adresse" aria-label="Straße oder Adresse suchen" inputMode="search" autoComplete="off" /></div>
      <div className="v5-results">
        {results.map((r) => (
          <button key={`${r.kind}${r.id}`} className="v5-result" onClick={() => onPick(r)}>
            <Icon name={r.kind === 'street' ? 'road' : 'house'} size={22} /><b>{r.label}</b><small>{r.detail}</small>
          </button>
        ))}
        {query.trim() && !results.length && <p className="v5-hint"><Icon name="info" size={20} />Nichts gefunden.</p>}
      </div>
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
