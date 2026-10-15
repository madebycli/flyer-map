import { useEffect, useRef, useState } from 'react';
import type { Meta } from './api.ts';
import { SheetFrame } from './sheet.tsx';
import { Icon, Select } from '../../ui/index.ts';
import { GROUP_COLORS, nextFreeColor } from './groupColors.ts';

type Props = {
  meta: Meta;
  busy: boolean;
  error: string | null;
  onRenameCampaign(name: string): void;
  onCreate(name: string, color: string): void;
  onUpdate(teamId: string, patch: { name?: string; color?: string }): void;
  onDelete(teamId: string): void;
  onSetAreaTeam(areaId: string, teamId: string): void;
  onClose(): void;
};

/** Swatches the size of a control; the selected one carries a ring. */
export function Swatches({ value, onPick, label }: { value: string; onPick(color: string): void; label: string }) {
  // the strip scrolls sideways: the chosen colour is brought into view when it opens
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current, on = el?.querySelector<HTMLElement>('.v5-team.on');
    if (el && on) el.scrollLeft = Math.max(0, on.offsetLeft - el.clientWidth / 2 + on.offsetWidth / 2);
  }, []);
  return (
    <div className="v5-teams v5-swatchstrip" role="group" aria-label={label} ref={strip}>
      {(GROUP_COLORS.some((c) => c.toLowerCase() === value.toLowerCase()) ? GROUP_COLORS : [value, ...GROUP_COLORS]).map((c) => <button key={c} className={`v5-team${c.toLowerCase() === value.toLowerCase() ? ' on' : ''}`} style={{ '--c': c } as React.CSSProperties} onClick={() => onPick(c)} aria-pressed={c.toLowerCase() === value.toLowerCase()} aria-label={c} title={c} />)}
      <label className="v5-team custom" aria-label="Eigene Farbe wählen" title="Eigene Farbe">
        <Icon name="palette" size={20} />
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#4f8cff'} onChange={(event) => onPick(event.target.value)} aria-label={`${label}: eigene Farbe`} />
      </label>
    </div>
  );
}

/** Which Gruppe something belongs to: one chip per Gruppe with its colour and name (a colour alone says nothing to someone who did not pick it). */
export function GroupPicker({ teams, value, label, disabled, onPick }: { teams: Meta['teams']; value: string; label: string; disabled?: boolean; onPick(teamId: string): void }) {
  return (
    <div className="v5-chips" role="group" aria-label={label}>
      {teams.map((t) => (
        <button key={t.id} type="button" className={`v5-groupchip${t.id === value ? ' on' : ''}`} style={{ '--c': t.color } as React.CSSProperties} disabled={disabled}
          aria-pressed={t.id === value} onClick={() => { if (t.id !== value) onPick(t.id); }}>
          <span className="dot" aria-hidden />{t.name}
        </button>
      ))}
    </div>
  );
}

/** One line per Gebiet: its name and the Gruppe it belongs to, changeable right there. */
function AssignRow({ area, teams, busy, onSetAreaTeam }: { area: Meta['areas'][number]; teams: Meta['teams']; busy: boolean; onSetAreaTeam: Props['onSetAreaTeam'] }) {
  const team = teams.find((t) => t.id === area.teamId);
  return (
    <label className="v5-assignrow">
      <span className="name"><span className="dot" style={{ '--c': team?.color ?? 'var(--outline)' } as React.CSSProperties} aria-hidden />{area.name}</span>
      <Select value={area.teamId} disabled={busy || teams.length < 2} aria-label={`Gruppe von ${area.name}`} onChange={(e) => onSetAreaTeam(area.id, e.target.value)}>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
    </label>
  );
}

/** One row per Gruppe: name, colour, how many Gebiete. A Gruppe with Gebieten cannot be deleted (move or delete the Gebiete first). */
function GroupRow({ team, areas, busy, onUpdate, onDelete }: { team: Meta['teams'][number]; areas: number; busy: boolean; onUpdate: Props['onUpdate']; onDelete: Props['onDelete'] }) {
  const [name, setName] = useState(team.name);
  const [open, setOpen] = useState(false);
  const commit = () => { const next = name.trim(); if (next && next !== team.name) onUpdate(team.id, { name: next }); else setName(team.name); };
  return (
    <div className="v5-grouprow">
      <div className="v5-row" style={{ margin: 0 }}>
        <button className="v5-team on" style={{ '--c': team.color, borderColor: 'transparent' } as React.CSSProperties} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Farbe von ${team.name} ändern`} title="Farbe ändern" />
        <input className="v5-input" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={`Name der Gruppe ${team.name}`} disabled={busy} maxLength={120} />
        <span className="v5-counter" title="Gebiete"><Icon name="polygon" size={18} />{areas}</span>
        <button className="v5-icon-btn" onClick={() => onDelete(team.id)} disabled={busy || areas > 0} aria-label={`Gruppe ${team.name} löschen`} title={areas > 0 ? 'Erst die Gebiete verschieben oder löschen' : 'Gruppe löschen'}><Icon name="trash" /></button>
      </div>
      {open && <Swatches value={team.color} label={`Farbe von ${team.name}`} onPick={(color) => { setOpen(false); onUpdate(team.id, { color }); }} />}
    </div>
  );
}

/** Admin: the Aktion's name, its Gruppen, and which Gebiet belongs to which Gruppe (also changeable on the Gebiet itself). */
export function GroupsSheet({ meta, busy, error, onRenameCampaign, onCreate, onUpdate, onDelete, onSetAreaTeam, onClose }: Props) {
  const [campaignName, setCampaignName] = useState(meta.campaign.name);
  const [name, setName] = useState('');
  const [color, setColor] = useState(() => nextFreeColor(meta.teams.map((t) => t.color)));
  const count = (teamId: string) => meta.areas.filter((a) => a.teamId === teamId).length;
  const commitCampaign = () => { const next = campaignName.trim(); if (next && next !== meta.campaign.name) onRenameCampaign(next); else setCampaignName(meta.campaign.name); };
  return (
    <SheetFrame icon="users" title="Gruppen" onClose={onClose} meta={<span><Icon name="polygon" size={16} />{meta.areas.length} Gebiete</span>}>
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      <h3>Aktion</h3>
      <input className="v5-input" value={campaignName} onChange={(e) => setCampaignName(e.target.value.slice(0, 160))} onBlur={commitCampaign} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label="Name der Aktion" disabled={busy} maxLength={160} />
      <h3>Gruppen</h3>
      {meta.teams.length === 0 ? <p className="v5-hint"><Icon name="info" size={20} />Noch keine Gruppe. Ein Gebiet gehört immer zu einer Gruppe.</p> : (
        <div className="v5-list">
          {meta.teams.map((t) => <GroupRow key={`${t.id}:${t.updatedAt}`} team={t} areas={count(t.id)} busy={busy} onUpdate={onUpdate} onDelete={onDelete} />)}
        </div>
      )}
      <h3>Neue Gruppe</h3>
      <div className="v5-form">
        <input className="v5-input" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} placeholder="Name (z. B. Nord)" aria-label="Name der neuen Gruppe" maxLength={120} />
        <Swatches value={color} label="Farbe der neuen Gruppe" onPick={setColor} />
        <button className="v5-btn primary" style={{ marginTop: 0 }} disabled={busy || !name.trim()} onClick={() => { onCreate(name.trim(), color); setName(''); }}><Icon name="plus" size={20} />Gruppe anlegen</button>
      </div>
      <h3>Gebiete zuweisen</h3>
      {meta.areas.length === 0 ? <p className="v5-hint"><Icon name="info" size={20} />Noch keine Gebiete. Zeichne eines über Menü → Gebiete; es gehört dann zur gewählten Gruppe.</p>
        : meta.teams.length < 2 ? <p className="v5-hint"><Icon name="info" size={20} />Lege eine zweite Gruppe an, dann kannst du die {meta.areas.length} Gebiete hier verteilen.</p>
        : <div className="v5-list">{meta.areas.map((a) => <AssignRow key={`${a.id}:${a.updatedAt}`} area={a} teams={meta.teams} busy={busy} onSetAreaTeam={onSetAreaTeam} />)}</div>}
    </SheetFrame>
  );
}

/** Admin, on a selected Gebiet: its name and which Gruppe it belongs to (the map colours it accordingly). */
export function AreaAdmin({ area, teams, busy, onRename, onSetTeam }: { area: Meta['areas'][number]; teams: Meta['teams']; busy: boolean; onRename(name: string): void; onSetTeam(teamId: string): void }) {
  const [name, setName] = useState(area.name);
  const commit = () => { const next = name.trim(); if (next && next !== area.name) onRename(next); else setName(area.name); };
  return (
    <div className="v5-form">
      <input className="v5-input" value={name} onChange={(e) => setName(e.target.value.slice(0, 160))} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label="Name des Gebiets ändern" disabled={busy} maxLength={160} />
      <GroupPicker teams={teams} value={area.teamId} label="Gruppe des Gebiets" disabled={busy} onPick={onSetTeam} />
    </div>
  );
}
