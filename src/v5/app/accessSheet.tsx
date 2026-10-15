import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Meta } from './api.ts';
import { createCollectionLink, createGrant, listCollectors, listGrants, revokeCollector, revokeGrant, setPickupRights, type Collector, type Grant, type GrantRole, type PickupRights } from './accessApi.ts';
import { EmptyState, SheetFrame } from './sheet.tsx';
import { Icon } from '../../ui/index.ts';

type LinkKind = GrantRole | 'collector';
type Props = { campaignId: string; teams: Meta['teams']; onClose: () => void };

const ROLE: Record<string, string> = { 'team-editor': 'Gruppe bearbeitet', viewer: 'Ansehen', admin: 'Admin' };

/** A link people open on their phone: shown as QR code and copyable. It exists only here, once; the server keeps no readable copy. */
function LinkBox({ title, link, onDone }: { title: string; link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="v5-syncbox" role="status" aria-label={title}>
      <span><Icon name="send" size={18} /> {title}</span>
      <div className="v5-qr"><QRCodeSVG value={link} size={168} level="M" /></div>
      <input className="v5-input" readOnly value={link} aria-label="Zugangslink" onFocus={(e) => e.currentTarget.select()} />
      <small>Der Link ist bis zum Widerruf gültig und wird nur jetzt angezeigt.</small>
      <div className="v5-row">
        <button className="v5-btn primary" style={{ marginTop: 0 }} onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}><Icon name="upload" size={20} />{copied ? 'Kopiert' : 'Link kopieren'}</button>
        <button className="v5-btn" style={{ marginTop: 0 }} onClick={onDone}>Fertig</button>
      </div>
    </div>
  );
}

/** Admin: who can open this Aktion. Links for a Gruppe or for viewers, links for Abhol-Helfer, and the people behind them; every link can be withdrawn. */
export function AccessSheet({ campaignId, teams, onClose }: Props) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [role, setRole] = useState<LinkKind>(teams.length ? 'team-editor' : 'viewer');
  const [creating, setCreating] = useState(false);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ title: string; link: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [g, c] = await Promise.all([listGrants(campaignId), listCollectors(campaignId).then((r) => r, () => [] as Collector[])]);
      setGrants(g.filter((x) => !x.revokedAt && x.role !== 'admin'));
      setCollectors(c.filter((x) => !x.revokedAt));
    } catch (e) { setError(e instanceof Error ? e.message : 'Zugänge konnten nicht geladen werden.'); }
  }, [campaignId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await task(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.'); } finally { setBusy(false); }
  };
  const create = () => run(async () => {
    if (role === 'collector') {
      const r = await createCollectionLink(campaignId);
      setCreated({ title: 'Link für Abhol-Helfer', link: r.link });
    } else {
      const result = await createGrant(campaignId, { role, teamId: role === 'team-editor' ? teamId : null, label: label.trim() });
      setCreated({ title: role === 'team-editor' ? 'Link für die Gruppe' : 'Link zum Ansehen', link: result.link });
    }
    setLabel('');
    setCreating(false);
  });
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? '–';

  if (creating) {
    return (
      <SheetFrame icon="users" title="Neuer Link" onBack={() => setCreating(false)} backLabel="Zurück zu den Zugängen" onClose={onClose}
        footer={<button className="v5-btn primary" style={{ marginTop: 0, width: '100%' }} disabled={busy || (role === 'team-editor' && !teamId)} onClick={() => void create()}><Icon name="send" size={20} />Link erstellen</button>}>
        <div className="v5-seg three" role="group" aria-label="Wer bekommt den Link">
          {([['team-editor', 'users', 'Gruppe'], ['viewer', 'eye', 'Ansehen'], ['collector', 'paw', 'Abholen']] as const).map(([value, icon, text]) => (
            <button key={value} className={`v5-seg-btn${role === value ? ' on' : ''}`} style={{ '--c': 'var(--primary)' } as React.CSSProperties}
              onClick={() => setRole(value)} aria-pressed={role === value} disabled={value === 'team-editor' && !teams.length}><Icon name={icon} size={22} /><span>{text}</span></button>
          ))}
        </div>
        {role === 'team-editor' && (
          <div className="v5-field"><span>Gruppe</span>
            <div className="v5-chips" role="group" aria-label="Gruppe">
              {teams.map((t) => <button key={t.id} type="button" className={`v5-groupchip${t.id === teamId ? ' on' : ''}`} style={{ '--c': t.color } as React.CSSProperties} aria-pressed={t.id === teamId} onClick={() => setTeamId(t.id)}><span className="dot" aria-hidden />{t.name}</button>)}
            </div>
          </div>
        )}
        {role === 'collector'
          ? <p className="v5-hint"><Icon name="info" size={20} />Abhol-Helfer öffnen den Link auf dem Handy, übernehmen Teilgebiete und legen Sonder-Marker an.</p>
          : <label className="v5-field"><span>Name (nur für dich)</span><input className="v5-input" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} placeholder="z. B. Gruppe Nord" aria-label="Name des Links" maxLength={80} /></label>}
      </SheetFrame>
    );
  }
  return (
    <SheetFrame icon="users" title="Zugänge" onClose={onClose} meta={<span><Icon name="lock" size={16} />{(grants?.length ?? 0) + collectors.length} aktiv</span>}
      actions={<button className="v5-icon-btn tonal" onClick={() => setCreating(true)} aria-label="Neuer Link" title="Neuer Link"><Icon name="plus" /></button>}>
      {created && <LinkBox title={created.title} link={created.link} onDone={() => setCreated(null)} />}
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      <h3>Aktive Links</h3>
      {grants === null ? <p className="v5-hint">Lade …</p> : grants.length === 0 ? <EmptyState icon="send" title="Noch kein Link" text="Mit + erstellst du einen Link für eine Gruppe, zum Ansehen oder für Abhol-Helfer." /> : (
        <div className="v5-list">
          {grants.map((g) => (
            <div key={g.grantId} className="v5-conflict-row">
              <span className="v5-conflict-title">{g.label || ROLE[g.role]} <small className="v5-muted">· {g.role === 'team-editor' ? teamName(g.teamId) : ROLE[g.role]}</small></span>
              <button className="v5-icon-btn" onClick={() => void run(() => revokeGrant(campaignId, g.grantId))} disabled={busy} aria-label={`Link ${g.label || ROLE[g.role]} widerrufen`} title="Widerrufen"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}

      {collectors.length > 0 && <h3>Abhol-Helfer</h3>}
      {collectors.length > 0 && (
        <div className="v5-list">
          {collectors.map((c) => {
            const rights = c.collectionCapabilities ?? { canViewPickups: true, canCreatePickups: false, canEditPickups: false, canAssignPickups: false };
            const toggle = (key: keyof PickupRights) => void run(() => setPickupRights(campaignId, c.id, { ...rights, [key]: !rights[key] }));
            return (
              <div key={c.id} className="v5-grouprow">
                <div className="v5-conflict-row">
                  <span className="v5-conflict-title">{c.label}</span>
                  <button className="v5-icon-btn" onClick={() => void run(() => revokeCollector(campaignId, c.id))} disabled={busy} aria-label={`${c.label} entfernen`} title="Entfernen"><Icon name="trash" /></button>
                </div>
                <div className="v5-seg three" role="group" aria-label={`Sonder-Marker-Rechte von ${c.label}`}>
                  {([['canViewPickups', 'eye', 'Sehen'], ['canCreatePickups', 'plus', 'Anlegen'], ['canEditPickups', 'pen', 'Bearbeiten']] as const).map(([key, icon, text]) => (
                    <button key={key} className={`v5-seg-btn${rights[key] ? ' on' : ''}`} style={{ '--c': 'var(--primary)' } as React.CSSProperties} disabled={busy} aria-pressed={rights[key]} aria-label={`${c.label}: ${text}`} title={text} onClick={() => toggle(key)}><Icon name={icon} size={22} /><span>{text}</span></button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SheetFrame>
  );
}
