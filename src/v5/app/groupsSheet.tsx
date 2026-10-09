import { useState } from 'react';
import type { Meta } from './api.ts';
import { SheetFrame } from './sheet.tsx';
import { Icon } from '../../ui/index.ts';

/** Calm colours for Gruppen; the map draws a Gebiet in its Gruppe's colour, so they must stay apart from each other and from the status colours. */
export const GROUP_COLORS = ['#4f8cff', '#e5736b', '#e0a83a', '#8b7be8', '#38b8a6', '#d46fb0', '#7dbb4a', '#8a97a6'];

type Props = {
  meta: Meta;
  busy: boolean;
  error: string | null;
  onRenameCampaign(name: string): void;
  onCreate(name: string, color: string): void;
  onUpdate(teamId: string, patch: { name?: string; color?: string }): void;
  onDelete(teamId: string): void;
  onClose(): void;
};

/** Swatches the size of a control; the selected one carries a ring. */
export function Swatches({ value, onPick, label }: { value: string; onPick(color: string): void; label: string }) {
  return (
    <div className="v5-teams" role="group" aria-label={label}>
      {GROUP_COLORS.map((c) => <button key={c} className={`v5-team${c.toLowerCase() === value.toLowerCase() ? ' on' : ''}`} style={{ '--c': c } as React.CSSProperties} onClick={() => onPick(c)} aria-pressed={c.toLowerCase() === value.toLowerCase()} aria-label={c} title={c} />)}
    </div>
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

/** Admin: the Aktion's name and its Gruppen. Gebiete are moved between Gruppen from the Gebiet itself. */
export function GroupsSheet({ meta, busy, error, onRenameCampaign, onCreate, onUpdate, onDelete, onClose }: Props) {
  const [campaignName, setCampaignName] = useState(meta.campaign.name);
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLORS[meta.teams.length % GROUP_COLORS.length]);
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
      {teams.length > 1 && (
        <div className="v5-teams" role="group" aria-label="Gruppe des Gebiets">
          {teams.map((t) => <button key={t.id} className={`v5-team${t.id === area.teamId ? ' on' : ''}`} style={{ '--c': t.color } as React.CSSProperties} disabled={busy} aria-pressed={t.id === area.teamId} aria-label={`Zu Gruppe ${t.name}`} title={t.name} onClick={() => { if (t.id !== area.teamId) onSetTeam(t.id); }} />)}
        </div>
      )}
    </div>
  );
}
