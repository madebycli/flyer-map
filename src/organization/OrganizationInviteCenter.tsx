import { useEffect, useMemo, useState } from "react";
import {
  OrganizationApiError,
  createOrganizationInvite,
  createOrganizationPasswordReset,
  getOrganizationMe,
  listOrganizationInvites,
  listOrganizationMembers,
  logoutOrganization,
  revokeOrganizationInvite,
  type OrganizationInviteDto,
  type OrganizationMeDto,
  type OrganizationMemberDto,
} from "./organizationApiClient.ts";
import "./organization-admin.css";
import "./organization-security.css";
import "./organization-invites.css";

const CAPABILITIES = [
  "organization.manage",
  "account.manage",
  "role.manage",
  "campaign.manage",
  "campaign.delete",
  "team.cross_manage",
  "audit.read",
  "security.manage",
] as const;

const CAPABILITY_LABELS: Record<string, string> = {
  "organization.manage": "Organization verwalten",
  "account.manage": "Accounts & Einladungen verwalten",
  "role.manage": "Rollen verwalten",
  "campaign.manage": "Aktionen verwalten",
  "campaign.delete": "Aktionen löschen",
  "team.cross_manage": "Teamübergreifend verwalten",
  "audit.read": "Audit lesen",
  "security.manage": "Security verwalten",
};

type LinkState = {
  kind: "invite" | "reset";
  targetId: string;
  title: string;
  link: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

function buildSecretLink(path: string, key: string, secret: string) {
  const url = new URL(path, window.location.origin);
  url.hash = new URLSearchParams({ [key]: secret }).toString();
  return url.toString();
}

function LinkDialog({ value, onClose }: { value: LinkState; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [value.link]);
  return (
    <div className="org-link-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="org-link-dialog" role="dialog" aria-modal="true" aria-label={value.title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="org-link-dialog__header">
          <div><span className="org-eyebrow">One-time-Link</span><h2>{value.title}</h2></div>
          <button className="org-link-dialog__close" type="button" onClick={onClose} aria-label="Dialog schließen">×</button>
        </div>
        <p>Dieser geheime Link wird nur in diesem Browser-Tab vorgehalten. Nach einem Reload kann er nicht aus der Datenbank zurückgelesen werden.</p>
        <code className="org-link-dialog__code">{value.link}</code>
        <div className="org-link-dialog__actions">
          <button className="org-security-action org-security-action--primary" type="button" onClick={() => void navigator.clipboard.writeText(value.link).then(() => setCopied(true))}>{copied ? "Kopiert ✓" : "Link kopieren"}</button>
          <button className="org-security-action" type="button" onClick={onClose}>Schließen</button>
        </div>
      </section>
    </div>
  );
}

function InviteHeader({ me }: { me: OrganizationMeDto }) {
  const [busy, setBusy] = useState(false);
  return (
    <header className="org-admin-topbar">
      <a className="org-brand" href="/admin">Flyer Map</a>
      <nav aria-label="Organizer Navigation">
        <a href="/admin">Aktionen</a>
        <a href="/admin/invites" aria-current="page">Einladungen</a>
        <a href="/admin/security">Sicherheit</a>
      </nav>
      <div className="org-account-chip"><span>{me.account.username}</span><button type="button" disabled={busy} onClick={() => { setBusy(true); void logoutOrganization().finally(() => window.location.replace("/login")); }}>Abmelden</button></div>
    </header>
  );
}

export function OrganizationInviteCenter() {
  const [me, setMe] = useState<OrganizationMeDto | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [invites, setInvites] = useState<OrganizationInviteDto[]>([]);
  const [members, setMembers] = useState<OrganizationMemberDto[]>([]);
  const [role, setRole] = useState<"organizer" | "admin">("admin");
  const [capabilities, setCapabilities] = useState<string[]>(["campaign.manage"]);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const [dialog, setDialog] = useState<LinkState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const membership = useMemo(
    () => me?.memberships.find((item) => item.organizationId === organizationId) ?? me?.memberships[0] ?? null,
    [me, organizationId],
  );
  const organizer = membership?.role === "organizer";
  const canManageAccounts = Boolean(organizer || membership?.capabilities.includes("account.manage"));
  const delegableCapabilities = useMemo(
    () => organizer ? [...CAPABILITIES] : CAPABILITIES.filter((capability) => membership?.capabilities.includes(capability)),
    [membership, organizer],
  );

  const refresh = async (id = organizationId) => {
    if (!id || !canManageAccounts) return;
    setError(null);
    try {
      const [inviteResult, memberResult] = await Promise.all([
        listOrganizationInvites(id),
        listOrganizationMembers(id),
      ]);
      setInvites(inviteResult.invites);
      setMembers(memberResult.members);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  useEffect(() => {
    let active = true;
    getOrganizationMe()
      .then((value) => {
        if (!active) return;
        setMe(value);
        setOrganizationId(value.memberships[0]?.organizationId ?? "");
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof OrganizationApiError && cause.status === 401) {
          window.location.replace(`/login?next=${encodeURIComponent("/admin/invites")}`);
          return;
        }
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!me || !organizationId || !canManageAccounts) return;
    void refresh(organizationId);
  }, [canManageAccounts, me, organizationId]);

  useEffect(() => {
    if (!organizer && role === "organizer") setRole("admin");
    setCapabilities((current) => current.filter((capability) => delegableCapabilities.includes(capability as typeof CAPABILITIES[number])));
  }, [delegableCapabilities, organizer, role]);

  const createInvite = async () => {
    if (!membership || !canManageAccounts || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createOrganizationInvite(membership.organizationId, {
        role,
        capabilities: role === "organizer" ? [] : capabilities,
        expiresInHours,
      });
      const link = buildSecretLink("/join", "token", result.secret);
      const state: LinkState = { kind: "invite", targetId: result.invite.id, title: `${role === "organizer" ? "Organizer" : "Admin"} einladen`, link };
      setLinks((current) => ({ ...current, [result.invite.id]: state }));
      setDialog(state);
      await refresh(membership.organizationId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (invite: OrganizationInviteDto) => {
    if (!membership || busy) return;
    setBusy(true);
    setError(null);
    try {
      await revokeOrganizationInvite(membership.organizationId, invite.id);
      setLinks((current) => {
        const next = { ...current };
        delete next[invite.id];
        return next;
      });
      await refresh(membership.organizationId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const createReset = async (member: OrganizationMemberDto) => {
    if (!membership || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createOrganizationPasswordReset(membership.organizationId, member.accountId, 30);
      const link = buildSecretLink("/reset", "token", result.secret);
      const state: LinkState = { kind: "reset", targetId: member.accountId, title: `Passwort zurücksetzen: ${member.username}`, link };
      setLinks((current) => ({ ...current, [`reset:${member.accountId}`]: state }));
      setDialog(state);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="org-page"><section className="org-status">Einladungen werden geladen …</section></main>;
  if (!me || !membership) return <main className="org-page"><section className="org-card"><h1>Keine aktive Organization</h1><p className="org-error">{error ?? "Keine aktive Mitgliedschaft gefunden."}</p></section></main>;

  return (
    <main className="org-admin-page">
      <InviteHeader me={me} />
      <section className="org-admin-content org-invite-center">
        <div className="org-heading-row"><div><span className="org-eyebrow">Zugänge</span><h1>Einladungen</h1></div><a className="org-secondary" href="/admin">Zurück zu Aktionen</a></div>
        {me.memberships.length > 1 ? <label className="org-select-label">Organization<select value={membership.organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{me.memberships.map((item) => <option value={item.organizationId} key={item.id}>{item.organizationName}</option>)}</select></label> : <p className="org-organization-name">{membership.organizationName} · {membership.role}</p>}
        {me.assurance !== "mfa" ? <section className="org-warning"><strong>MFA erforderlich</strong><p>Eine Recovery-Sitzung darf keine Einladungen oder Passwort-Resets erstellen.</p><a href="/admin/security">Sicherheit öffnen</a></section> : null}
        {!canManageAccounts ? <section className="org-card"><h2>Keine Account-Berechtigung</h2><p>Für Einladungen brauchst du <code>account.manage</code> oder die Organizer-Rolle.</p></section> : null}
        {error ? <p className="org-error" role="alert">{error}</p> : null}

        {canManageAccounts ? (
          <>
            <section className="org-card org-card--wide org-invite-create-card">
              <div><span className="org-eyebrow">Neuer Zugang</span><h2>Person einladen</h2><p>Der Empfänger legt beim Einlösen selbst Benutzername, Passwort und MFA fest.</p></div>
              <div className="org-invite-form-grid">
                <label>Rolle<select value={role} onChange={(event) => { setRole(event.target.value as "organizer" | "admin"); setCapabilities([]); }}><option value="admin">Admin</option>{organizer ? <option value="organizer">Organizer</option> : null}</select></label>
                <label>Gültigkeit<select value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))}><option value={24}>24 Stunden</option><option value={72}>3 Tage</option><option value={168}>7 Tage</option></select></label>
              </div>
              {role === "admin" ? <fieldset className="org-invite-capabilities"><legend>Berechtigungen</legend>{delegableCapabilities.map((capability) => <label key={capability}><input type="checkbox" checked={capabilities.includes(capability)} onChange={(event) => setCapabilities(event.target.checked ? [...capabilities, capability] : capabilities.filter((item) => item !== capability))} /><span><strong>{CAPABILITY_LABELS[capability] ?? capability}</strong><small>{capability}</small></span></label>)}</fieldset> : <p className="org-status">Organizer besitzen die vollständige Organization-Verantwortung. Nur bestehende Organizer dürfen weitere Organizer einladen.</p>}
              <button className="org-primary" type="button" disabled={busy || me.assurance !== "mfa"} onClick={() => void createInvite()}>{busy ? "Wird erstellt …" : "Einladungslink erstellen"}</button>
            </section>

            <section className="org-card org-card--wide">
              <div className="org-heading-row"><div><span className="org-eyebrow">Einladungen</span><h2>Offen & Verlauf</h2></div><button className="org-security-action" type="button" disabled={busy} onClick={() => void refresh()}>Aktualisieren</button></div>
              <div className="org-invite-list">
                {invites.length === 0 ? <p>Noch keine Einladungen.</p> : invites.map((invite) => {
                  const active = !invite.usedAt && !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now();
                  const storedLink = links[invite.id];
                  return <article className="org-invite-row" key={invite.id}><div><strong>{invite.role === "organizer" ? "Organizer" : "Admin"}</strong><span>{invite.capabilities.length > 0 ? invite.capabilities.join(" · ") : "Vollzugriff als Organizer"}</span><small>{active ? `gültig bis ${new Date(invite.expiresAt).toLocaleString("de-DE")}` : invite.usedAt ? "verwendet" : invite.revokedAt ? "widerrufen" : "abgelaufen"}</small></div><div className="org-invite-row-actions">{active && storedLink ? <button className="org-security-action org-security-action--primary" type="button" onClick={() => setDialog(storedLink)}>Link anzeigen</button> : null}{active && !storedLink ? <span className="org-invite-secret-note">Secret nach Reload nicht mehr abrufbar</span> : null}{active ? <button className="org-security-action org-security-action--danger" type="button" disabled={busy} onClick={() => void revokeInvite(invite)}>Widerrufen</button> : null}</div></article>;
                })}
              </div>
            </section>

            <section className="org-card org-card--wide">
              <span className="org-eyebrow">Accounts</span><h2>Passwort-Reset</h2><p>Ein Reset-Link ist 30 Minuten gültig, einmalig und widerruft beim Einlösen die alten Sessions des Accounts.</p>
              <div className="org-invite-list">{members.map((member) => <article className="org-invite-row" key={member.id}><div><strong>{member.username}</strong><span>{member.role} · {member.capabilities.join(" · ") || "keine Zusatzrechte"}</span></div><button className="org-security-action" type="button" disabled={busy || me.assurance !== "mfa"} onClick={() => void createReset(member)}>Reset-Link erstellen</button></article>)}</div>
            </section>
          </>
        ) : null}
      </section>
      {dialog ? <LinkDialog value={dialog} onClose={() => setDialog(null)} /> : null}
    </main>
  );
}
