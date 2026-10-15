import { useEffect, useRef, useState } from 'react';
import type { Meta } from './api.ts';
import { EmptyState, SheetFrame } from './sheet.tsx';
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

type View = { kind: 'main' } | { kind: 'assign' } | { kind: 'new' } | { kind: 'campaign' } | { kind: 'edit'; teamId: string };

/** A page of its own: name and colour of a Gruppe — the same two fields to create one and to change one; deleting sits at the foot of the change page. */
function GroupPage({ team, areas, busy, color: startColor, onSave, onDelete, onBack, onClose }: {
  team?: Meta['teams'][number]; areas: number; busy: boolean; color: string;
  onSave(name: string, color: string): void; onDelete?(): void; onBack(): void; onClose(): void;
}) {
  const [name, setName] = useState(team?.name ?? '');
  const [color, setColor] = useState(startColor);
  const ready = !!name.trim() && !busy;
  const save = () => { if (ready) onSave(name.trim(), color); };
  return (
    <SheetFrame icon="users" title={team ? 'Gruppe ändern' : 'Neue Gruppe'} onBack={onBack} backLabel="Zurück zu den Gruppen" onClose={onClose}
      footer={<div className="v5-footer-actions">
        {team && onDelete && <button className="v5-btn danger" style={{ marginTop: 0 }} disabled={busy || areas > 0} onClick={onDelete} aria-label={`Gruppe ${team.name} löschen`} title={areas > 0 ? 'Erst die Gebiete verschieben oder löschen' : 'Gruppe löschen'}><Icon name="trash" size={20} />Löschen</button>}
        <button className="v5-btn primary" style={{ marginTop: 0 }} disabled={!ready} onClick={save}><Icon name={team ? 'check' : 'plus'} size={20} />{team ? 'Speichern' : 'Gruppe anlegen'}</button>
      </div>}>
      <label className="v5-field"><span>Name</span>
        <input className="v5-input" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} placeholder="z. B. Nord" aria-label={team ? `Name der Gruppe ${team.name}` : 'Name der neuen Gruppe'} maxLength={120} />
      </label>
      <div className="v5-field"><span>Farbe</span><Swatches value={color} label={team ? `Farbe von ${team.name}` : 'Farbe der neuen Gruppe'} onPick={setColor} /></div>
      {team && areas > 0 && <p className="v5-hint"><Icon name="info" size={20} />{areas} {areas === 1 ? 'Gebiet gehört' : 'Gebiete gehören'} dazu; zum Löschen erst verschieben.</p>}
    </SheetFrame>
  );
}

/** A page of its own: rename the Aktion. */
function CampaignPage({ name: current, busy, onSave, onBack, onClose }: { name: string; busy: boolean; onSave(name: string): void; onBack(): void; onClose(): void }) {
  const [name, setName] = useState(current);
  const ready = !!name.trim() && !busy;
  return (
    <SheetFrame icon="users" title="Aktion umbenennen" onBack={onBack} backLabel="Zurück zu den Gruppen" onClose={onClose}
      footer={<button className="v5-btn primary" style={{ marginTop: 0, width: '100%' }} disabled={!ready} onClick={() => onSave(name.trim())}><Icon name="check" size={20} />Speichern</button>}>
      <label className="v5-field"><span>Name der Aktion</span>
        <input className="v5-input" value={name} onChange={(e) => setName(e.target.value.slice(0, 160))} onKeyDown={(e) => { if (e.key === 'Enter' && ready) onSave(name.trim()); }} aria-label="Name der Aktion" maxLength={160} />
      </label>
    </SheetFrame>
  );
}

/** Admin: the Aktion's Gruppen as a list (a tap opens one, + adds one) and, one level down, which Gebiet belongs to which Gruppe. Every change is a page of its own with a way back. */
export function GroupsSheet({ meta, busy, error, onRenameCampaign, onCreate, onUpdate, onDelete, onSetAreaTeam, onClose }: Props) {
  const [view, setView] = useState<View>({ kind: 'main' });
  const main = () => setView({ kind: 'main' });
  const count = (teamId: string) => meta.areas.filter((a) => a.teamId === teamId).length;
  const editing = view.kind === 'edit' ? meta.teams.find((t) => t.id === view.teamId) : undefined;
  if (view.kind === 'new') return <GroupPage areas={0} busy={busy} color={nextFreeColor(meta.teams.map((t) => t.color))} onBack={main} onClose={onClose} onSave={(name, color) => { onCreate(name, color); main(); }} />;
  if (view.kind === 'edit' && editing) {
    return (
      <GroupPage key={editing.id} team={editing} areas={count(editing.id)} busy={busy} color={editing.color} onBack={main} onClose={onClose}
        onSave={(name, color) => { const patch: { name?: string; color?: string } = {}; if (name !== editing.name) patch.name = name; if (color.toLowerCase() !== editing.color.toLowerCase()) patch.color = color; if (patch.name || patch.color) onUpdate(editing.id, patch); main(); }}
        onDelete={() => { main(); onDelete(editing.id); }} />
    );
  }
  if (view.kind === 'campaign') return <CampaignPage name={meta.campaign.name} busy={busy} onBack={main} onClose={onClose} onSave={(name) => { if (name !== meta.campaign.name) onRenameCampaign(name); main(); }} />;
  const assign = view.kind === 'assign';
  return (
    <SheetFrame icon="users" title={assign ? 'Gebiete zuweisen' : 'Gruppen'} onClose={onClose}
      onBack={assign ? main : undefined} backLabel="Zurück zu den Gruppen"
      meta={<span><Icon name="polygon" size={16} />{meta.areas.length} Gebiete</span>}
      actions={assign ? undefined : <button className="v5-icon-btn tonal" onClick={() => setView({ kind: 'new' })} aria-label="Neue Gruppe" title="Neue Gruppe"><Icon name="plus" /></button>}>
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      {assign ? (
        meta.areas.length === 0 ? <EmptyState icon="polygon" title="Noch keine Gebiete" text="Zeichne eines über Menü → Gebiete; es gehört dann zur gewählten Gruppe." />
          : meta.teams.length < 2 ? <EmptyState icon="users" title="Nur eine Gruppe" text={`Lege eine zweite Gruppe an, dann kannst du die ${meta.areas.length} Gebiete verteilen.`} />
          : <div className="v5-list">{meta.areas.map((a) => <AssignRow key={`${a.id}:${a.updatedAt}`} area={a} teams={meta.teams} busy={busy} onSetAreaTeam={onSetAreaTeam} />)}</div>
      ) : (
        <>
          <h3>Gruppen</h3>
          {meta.teams.length === 0 ? <EmptyState icon="users" title="Noch keine Gruppe" text="Ein Gebiet gehört immer zu einer Gruppe. Mit + legst du die erste an." />
            : <div className="v5-list">
              {meta.teams.map((t) => (
                <button key={t.id} className="v5-row-btn" onClick={() => setView({ kind: 'edit', teamId: t.id })} aria-label={`Gruppe ${t.name} bearbeiten`}>
                  <span className="v5-gdot" style={{ '--c': t.color } as React.CSSProperties} aria-hidden />
                  <span className="v5-row-name">{t.name}</span>
                  <span className="v5-row-count" title="Gebiete">{count(t.id)} {count(t.id) === 1 ? 'Gebiet' : 'Gebiete'}</span>
                  <Icon name="pen" size={20} />
                </button>
              ))}
            </div>}
          <h3>Weiteres</h3>
          <div className="v5-list">
            <button className="v5-row-btn" onClick={() => setView({ kind: 'assign' })} disabled={meta.areas.length === 0}><Icon name="polygon" size={22} /><span className="v5-row-name">Gebiete zuweisen</span><span className="v5-row-count">{meta.areas.length}</span></button>
            <button className="v5-row-btn" onClick={() => setView({ kind: 'campaign' })} aria-label="Aktion umbenennen"><Icon name="pen" size={22} /><span className="v5-row-name">Aktion umbenennen<small>{meta.campaign.name}</small></span></button>
          </div>
        </>
      )}
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
