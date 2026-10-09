import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Meta } from './api.ts';
import { createCollectionLink, createGrant, listCollectors, listGrants, revokeCollector, revokeGrant, type Collector, type Grant, type GrantRole } from './accessApi.ts';
import { SheetFrame } from './sheet.tsx';
import { Icon } from '../../ui/index.ts';

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
  const [role, setRole] = useState<GrantRole>(teams.length ? 'team-editor' : 'viewer');
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
    const result = await createGrant(campaignId, { role, teamId: role === 'team-editor' ? teamId : null, label: label.trim() });
    setLabel('');
    setCreated({ title: role === 'team-editor' ? 'Link für die Gruppe' : 'Link zum Ansehen', link: result.link });
  });
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? '–';

  return (
    <SheetFrame icon="users" title="Zugänge" onClose={onClose} meta={<span><Icon name="lock" size={16} />{(grants?.length ?? 0) + collectors.length} aktiv</span>}>
      {created && <LinkBox title={created.title} link={created.link} onDone={() => setCreated(null)} />}
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      <h3>Neuer Link</h3>
      <div className="v5-form">
        <div className="v5-seg" role="group" aria-label="Wer bekommt den Link" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {([['team-editor', 'users', 'Gruppe'], ['viewer', 'eye', 'Ansehen']] as const).map(([value, icon, text]) => (
            <button key={value} className={`v5-seg-btn${role === value ? ' on' : ''}`} style={{ '--c': 'var(--primary)', aspectRatio: 'auto', minHeight: 'var(--ctl)' } as React.CSSProperties}
              onClick={() => setRole(value)} aria-pressed={role === value} disabled={value === 'team-editor' && !teams.length}><Icon name={icon} size={22} /><span>{text}</span></button>
          ))}
        </div>
        {role === 'team-editor' && (
          <div className="v5-teams" role="group" aria-label="Gruppe">
            {teams.map((t) => <button key={t.id} className={`v5-team${t.id === teamId ? ' on' : ''}`} style={{ '--c': t.color } as React.CSSProperties} onClick={() => setTeamId(t.id)} aria-label={t.name} aria-pressed={t.id === teamId} title={t.name} />)}
            <span className="v5-muted" style={{ alignSelf: 'center', marginLeft: '0.4rem' }}>{teamName(teamId)}</span>
          </div>
        )}
        <input className="v5-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name für dich (z. B. Gruppe Nord)" aria-label="Name des Links" maxLength={80} />
        <button className="v5-btn primary" style={{ marginTop: 0 }} disabled={busy || (role === 'team-editor' && !teamId)} onClick={() => void create()}><Icon name="send" size={20} />Link erstellen</button>
      </div>

      <h3>Aktive Links</h3>
      {grants === null ? <p className="v5-hint">Lade …</p> : grants.length === 0 ? <p className="v5-hint"><Icon name="info" size={20} />Noch kein Link erstellt.</p> : (
        <div className="v5-list">
          {grants.map((g) => (
            <div key={g.grantId} className="v5-conflict-row">
              <span className="v5-conflict-title">{g.label || ROLE[g.role]} <small className="v5-muted">· {g.role === 'team-editor' ? teamName(g.teamId) : ROLE[g.role]}</small></span>
              <button className="v5-icon-btn" onClick={() => void run(() => revokeGrant(campaignId, g.grantId))} disabled={busy} aria-label={`Link ${g.label || ROLE[g.role]} widerrufen`} title="Widerrufen"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}

      <h3>Abholen</h3>
      <div className="v5-row">
        <button className="v5-btn" style={{ marginTop: 0 }} disabled={busy} onClick={() => void run(async () => { const r = await createCollectionLink(campaignId); setCreated({ title: 'Link für Abhol-Helfer', link: r.link }); })}><Icon name="paw" size={20} />Abhol-Link erstellen</button>
      </div>
      {collectors.length > 0 && (
        <div className="v5-list">
          {collectors.map((c) => (
            <div key={c.id} className="v5-conflict-row">
              <span className="v5-conflict-title">{c.label}</span>
              <button className="v5-icon-btn" onClick={() => void run(() => revokeCollector(campaignId, c.id))} disabled={busy} aria-label={`${c.label} entfernen`} title="Entfernen"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}
    </SheetFrame>
  );
}
