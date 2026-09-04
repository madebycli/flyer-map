import { useEffect, useMemo, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  OrganizationApiError,
  changeOrganizationPassword,
  changeOrganizationUsername,
  completeOrganizationTotp,
  createOrganizationInvite,
  createOrganizationPasswordReset,
  createOrganizationRole,
  deleteOrganizationRole,
  getOrganizationMe,
  listOrganizationAudit,
  listOrganizationFeatures,
  listOrganizationInvites,
  listOrganizationMembers,
  listOrganizationRoles,
  listOrganizationSessions,
  logoutOrganization,
  restartOrganizationTotp,
  revokeOrganizationInvite,
  revokeOrganizationSession,
  rotateOrganizationRecoveryCodes,
  updateOrganizationFeature,
  type OrganizationAuditEventDto,
  type OrganizationFeatureDto,
  type OrganizationInviteDto,
  type OrganizationMeDto,
  type OrganizationMemberDto,
  type OrganizationRoleDto,
  type OrganizationSessionDto,
} from "./organizationApiClient.ts";
import "./organization-admin.css";

const CAPABILITIES = [
  "organization.create",
  "organization.manage",
  "account.manage",
  "role.manage",
  "campaign.create",
  "campaign.manage",
  "campaign.delete",
  "team.cross_manage",
  "audit.read",
  "security.manage",
] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function SecurityHeader({ me }: { me: OrganizationMeDto }) {
  const [busy, setBusy] = useState(false);
  const canCreateCampaign = me.memberships.some((membership) =>
    membership.role === "organizer" || membership.capabilities.includes("campaign.create"),
  );
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logoutOrganization();
    } finally {
      window.location.replace("/login");
    }
  };
  return (
    <header className="org-admin-topbar">
      <a className="org-brand" href="/admin">Flyer Map</a>
      <nav aria-label="Organizer Navigation">
        <a href="/admin">Aktionen</a>
        {canCreateCampaign ? <a href="/new">Neue Aktion</a> : null}
        <a href="/admin/security" aria-current="page">Sicherheit</a>
        <a href="/">Feldkarte</a>
      </nav>
      <div className="org-account-chip"><span>{me.account.username}</span><button type="button" disabled={busy} onClick={() => void logout()}>Abmelden</button></div>
    </header>
  );
}

function CapabilityPicker({
  value,
  onChange,
  allowedCapabilities = CAPABILITIES,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  allowedCapabilities?: readonly string[];
}) {
  const visibleCapabilities = CAPABILITIES.filter((capability) => allowedCapabilities.includes(capability));
  return (
    <fieldset className="org-radio">
      <legend>Berechtigungen</legend>
      {visibleCapabilities.length === 0 ? <p>Keine delegierbaren Zusatzrechte.</p> : null}
      {visibleCapabilities.map((capability) => (
        <label key={capability}>
          <input
            type="checkbox"
            checked={value.includes(capability)}
            onChange={(event) => onChange(event.target.checked ? [...value, capability] : value.filter((item) => item !== capability))}
          /> {capability}
        </label>
      ))}
    </fieldset>
  );
}

function RecoveryMfaCard({ organizationId }: { organizationId: string }) {
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<{ otpauthUri: string; recoveryCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const restart = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restartOrganizationTotp(organizationId, password);
      setEnrollment({ otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes });
      setPassword("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await completeOrganizationTotp(code);
      window.location.replace("/admin/security");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (enrollment) {
    return (
      <section className="org-card org-card--wide">
        <span className="org-eyebrow">Recovery-Modus</span>
        <h2>TOTP neu bestätigen</h2>
        <div className="org-qr"><QRCodeSVG value={enrollment.otpauthUri} size={196} level="M" /></div>
        <details><summary>Setup-Link anzeigen</summary><code className="org-break-code">{enrollment.otpauthUri}</code></details>
        <div className="org-recovery-box"><strong>Neue Recovery-Codes</strong><pre>{enrollment.recoveryCodes.join("\n")}</pre><button type="button" onClick={() => void copyText(enrollment.recoveryCodes.join("\n"))}>Codes kopieren</button></div>
        <form className="org-form" onSubmit={(event) => void finish(event)}>
          <label>6-stelliger Code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required /></label>
          {error ? <p className="org-error">{error}</p> : null}
          <button className="org-primary" disabled={busy || code.length !== 6}>MFA abschließen</button>
        </form>
      </section>
    );
  }

  return (
    <section className="org-card org-card--wide">
      <span className="org-eyebrow">Recovery-Sitzung</span>
      <h2>Privilegierte Aktionen sind gesperrt</h2>
      <p>Bestätige dein aktuelles Passwort und richte TOTP neu ein. Die Recovery-Sitzung kann keine Admin-Änderungen ausführen.</p>
      <form className="org-form" onSubmit={(event) => void restart(event)}>
        <label>Aktuelles Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error ? <p className="org-error">{error}</p> : null}
        <button className="org-primary" disabled={busy}>TOTP sicher erneuern</button>
      </form>
    </section>
  );
}

export function OrganizationSecurityCenter() {
  const [me, setMe] = useState<OrganizationMeDto | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [members, setMembers] = useState<OrganizationMemberDto[]>([]);
  const [sessions, setSessions] = useState<OrganizationSessionDto[]>([]);
  const [invites, setInvites] = useState<OrganizationInviteDto[]>([]);
  const [roles, setRoles] = useState<OrganizationRoleDto[]>([]);
  const [features, setFeatures] = useState<OrganizationFeatureDto[]>([]);
  const [events, setEvents] = useState<OrganizationAuditEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [totpEnrollment, setTotpEnrollment] = useState<{ otpauthUri: string; recoveryCodes: string[] } | null>(null);
  const [factorCode, setFactorCode] = useState("");

  const membership = useMemo(() => me?.memberships.find((item) => item.organizationId === organizationId) ?? me?.memberships[0] ?? null, [me, organizationId]);
  const has = (capability: string) => Boolean(membership?.role === "organizer" || membership?.capabilities.includes(capability));
  const delegableCapabilities = membership?.role === "organizer"
    ? [...CAPABILITIES]
    : membership?.capabilities ?? [];

  const refresh = async (nextOrganizationId = organizationId) => {
    if (!nextOrganizationId) return;
    setError(null);
    const tasks: Promise<void>[] = [
      listOrganizationSessions().then((result) => setSessions(result.sessions)),
    ];
    if (has("account.manage")) tasks.push(listOrganizationMembers(nextOrganizationId).then((result) => setMembers(result.members)), listOrganizationInvites(nextOrganizationId).then((result) => setInvites(result.invites)));
    if (has("role.manage")) tasks.push(listOrganizationRoles(nextOrganizationId).then((result) => setRoles(result.roles)));
    if (has("organization.manage")) tasks.push(listOrganizationFeatures(nextOrganizationId).then((result) => setFeatures(result.features)));
    if (has("audit.read")) tasks.push(listOrganizationAudit(nextOrganizationId).then((result) => setEvents(result.events)));
    try {
      await Promise.all(tasks);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  useEffect(() => {
    let active = true;
    getOrganizationMe()
      .then(async (value) => {
        if (!active) return;
        const initial = value.memberships[0]?.organizationId ?? "";
        setMe(value);
        setOrganizationId(initial);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof OrganizationApiError && cause.status === 401) {
          window.location.replace(`/login?next=${encodeURIComponent("/admin/security")}`);
          return;
        }
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!me || !organizationId) return;
    void refresh(organizationId);
  }, [me, organizationId]);

  if (loading) return <main className="org-page"><section className="org-status">Security Center wird geladen …</section></main>;
  if (!me || !membership) return <main className="org-page"><section className="org-card"><h1>Keine aktive Organization</h1><p className="org-error">{error ?? "Für diesen Account existiert keine aktive Mitgliedschaft."}</p><a href="/admin">Zurück</a></section></main>;

  if (me.assurance === "recovery") {
    return <main className="org-admin-page"><SecurityHeader me={me} /><section className="org-admin-content org-admin-content--narrow"><RecoveryMfaCard organizationId={membership.organizationId} /></section></main>;
  }

  return (
    <main className="org-admin-page">
      <SecurityHeader me={me} />
      <section className="org-admin-content">
        <div className="org-heading-row"><div><span className="org-eyebrow">Organization Security</span><h1>Sicherheit & Zugriffe</h1></div><a className="org-secondary" href="/admin">Zurück zu Aktionen</a></div>
        {me.memberships.length > 1 ? <label className="org-select-label">Organization<select value={membership.organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{me.memberships.map((item) => <option value={item.organizationId} key={item.id}>{item.organizationName}</option>)}</select></label> : <p className="org-organization-name">{membership.organizationName} · {membership.role}</p>}
        {membership.role === "admin" ? <p className="org-status">Deine Ansicht ist auf die vom Organizer delegierten Berechtigungen begrenzt.</p> : null}
        {error ? <p className="org-error" role="alert">{error}</p> : null}
        {generatedLink ? <section className="org-warning"><strong>One-time-Link</strong><p>Dieser Link wird nur jetzt angezeigt. Der Token liegt ausschließlich im URL-Fragment.</p><code className="org-break-code">{generatedLink}</code><button type="button" onClick={() => void copyText(generatedLink)}>Link kopieren</button><button type="button" onClick={() => setGeneratedLink(null)}>Ausblenden</button></section> : null}
        {recoveryCodes ? <section className="org-warning"><strong>Neue Recovery-Codes</strong><pre>{recoveryCodes.join("\n")}</pre><button type="button" onClick={() => void copyText(recoveryCodes.join("\n"))}>Codes kopieren</button><button type="button" onClick={() => setRecoveryCodes(null)}>Ausblenden</button></section> : null}

        <section className="org-card org-card--wide">
          <h2>Eigener Account</h2>
          <div className="org-detail-grid"><div><dt>Benutzername</dt><dd>{me.account.username}</dd></div><div><dt>Sitzung</dt><dd>MFA bestätigt</dd></div></div>
          <AccountForms organizationId={membership.organizationId} onRecoveryCodes={setRecoveryCodes} onTotp={setTotpEnrollment} />
          {totpEnrollment ? <TotpReenrollment enrollment={totpEnrollment} factorCode={factorCode} setFactorCode={setFactorCode} onDone={() => window.location.replace("/login")} /> : null}
        </section>

        <section className="org-card org-card--wide">
          <h2>Aktive Sitzungen</h2>
          {sessions.length === 0 ? <p>Keine aktive Sitzung gefunden.</p> : sessions.map((session) => <div className="org-heading-row" key={session.id}><div><strong>{session.current ? "Diese Sitzung" : session.id}</strong><p>{session.assurance} · bis {new Date(session.expiresAt).toLocaleString("de-DE")}</p></div>{!session.current ? <button type="button" onClick={() => void revokeOrganizationSession(session.id).then(() => refresh())}>Widerrufen</button> : null}</div>)}
        </section>

        {has("account.manage") ? <MembersAndInvites organizationId={membership.organizationId} members={members} invites={invites} organizer={membership.role === "organizer"} allowedCapabilities={delegableCapabilities} onLink={setGeneratedLink} onRefresh={() => refresh()} /> : null}
        {has("role.manage") ? <RoleTemplates organizationId={membership.organizationId} roles={roles} allowedCapabilities={delegableCapabilities} onRefresh={() => refresh()} /> : null}
        {has("organization.manage") ? <FeatureSettings organizationId={membership.organizationId} features={features} onRefresh={() => refresh()} /> : null}
        {has("audit.read") ? <AuditLog events={events} /> : null}
      </section>
    </main>
  );
}

function AccountForms({ organizationId, onRecoveryCodes, onTotp }: { organizationId: string; onRecoveryCodes: (codes: string[]) => void; onTotp: (value: { otpauthUri: string; recoveryCodes: string[] }) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [username, setUsername] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await task(); setMessage(success); } catch (cause) { setMessage(errorMessage(cause)); } finally { setBusy(false); }
  };
  return (
    <div className="org-campaign-grid">
      <form className="org-form org-form--panel" onSubmit={(event) => { event.preventDefault(); void run(() => changeOrganizationUsername(organizationId, currentPassword, username), "Benutzername geändert."); }}><h3>Benutzername ändern</h3><label>Neuer Benutzername<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} required /></label><label>Aktuelles Passwort<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><button disabled={busy}>Speichern</button></form>
      <form className="org-form org-form--panel" onSubmit={(event) => { event.preventDefault(); void run(async () => { await changeOrganizationPassword(organizationId, currentPassword, nextPassword); window.location.replace("/login"); }, "Passwort geändert."); }}><h3>Passwort ändern</h3><label>Neues Passwort<input type="password" minLength={12} maxLength={256} value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} required /></label><label>Aktuelles Passwort<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><button disabled={busy}>Passwort ersetzen</button></form>
      <form className="org-form org-form--panel" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await rotateOrganizationRecoveryCodes(organizationId, currentPassword); onRecoveryCodes(result.recoveryCodes); }, "Recovery-Codes rotiert."); }}><h3>Recovery-Codes</h3><p>Alle bisherigen unbenutzten Codes werden ungültig.</p><label>Aktuelles Passwort<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><button disabled={busy}>Neue Codes erzeugen</button></form>
      <form className="org-form org-form--panel" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await restartOrganizationTotp(organizationId, currentPassword); onTotp({ otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes }); }, "TOTP-Rotation gestartet."); }}><h3>TOTP erneuern</h3><p>Alle aktiven Sitzungen werden widerrufen.</p><label>Aktuelles Passwort<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><button disabled={busy}>TOTP rotieren</button></form>
      {message ? <p className={message.includes("geändert") || message.includes("rotiert") || message.includes("gestartet") ? "org-status" : "org-error"}>{message}</p> : null}
    </div>
  );
}

function TotpReenrollment({ enrollment, factorCode, setFactorCode, onDone }: { enrollment: { otpauthUri: string; recoveryCodes: string[] }; factorCode: string; setFactorCode: (value: string) => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return <section className="org-warning"><h3>TOTP-Rotation abschließen</h3><div className="org-qr"><QRCodeSVG value={enrollment.otpauthUri} size={180} level="M" /></div><pre>{enrollment.recoveryCodes.join("\n")}</pre><form className="org-form" onSubmit={(event) => { event.preventDefault(); completeOrganizationTotp(factorCode).then(onDone).catch((cause: unknown) => setError(errorMessage(cause))); }}><label>6-stelliger Code<input value={factorCode} onChange={(event) => setFactorCode(event.target.value)} pattern="[0-9]{6}" maxLength={6} required /></label>{error ? <p className="org-error">{error}</p> : null}<button>Rotation bestätigen</button></form></section>;
}

function MembersAndInvites({ organizationId, members, invites, organizer, allowedCapabilities, onLink, onRefresh }: { organizationId: string; members: OrganizationMemberDto[]; invites: OrganizationInviteDto[]; organizer: boolean; allowedCapabilities: readonly string[]; onLink: (link: string) => void; onRefresh: () => Promise<void> | void }) {
  const [role, setRole] = useState<"organizer" | "admin">("admin");
  const [capabilities, setCapabilities] = useState<string[]>(() => ["campaign.create", "campaign.manage"].filter((capability) => allowedCapabilities.includes(capability)));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCapabilities((current) => current.filter((capability) => allowedCapabilities.includes(capability)));
    if (!organizer) setRole("admin");
  }, [allowedCapabilities, organizer]);
  const createInvite = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    try { const result = await createOrganizationInvite(organizationId, { role, capabilities, expiresInHours: 24 }); onLink(`${window.location.origin}/join#token=${encodeURIComponent(result.secret)}`); await onRefresh(); } catch (cause) { setError(errorMessage(cause)); }
  };
  const reset = async (accountId: string) => {
    try { const result = await createOrganizationPasswordReset(organizationId, accountId); onLink(`${window.location.origin}/reset#token=${encodeURIComponent(result.secret)}`); } catch (cause) { setError(errorMessage(cause)); }
  };
  return <section className="org-card org-card--wide"><h2>Mitglieder & Einladungen</h2><form className="org-form org-form--panel" onSubmit={(event) => void createInvite(event)}><label>Rolle<select value={role} onChange={(event) => setRole(event.target.value as "organizer" | "admin")}><option value="admin">Admin</option>{organizer ? <option value="organizer">Organizer</option> : null}</select></label><CapabilityPicker value={capabilities} onChange={setCapabilities} allowedCapabilities={allowedCapabilities} />{!organizer ? <p className="org-help">Du kannst nur Rechte weitergeben, die dein eigener Admin-Account besitzt.</p> : null}{error ? <p className="org-error">{error}</p> : null}<button className="org-primary">One-time-Einladung erzeugen</button></form><h3>Aktive Mitglieder</h3>{members.map((member) => <div className="org-heading-row" key={member.id}><div><strong>{member.username}</strong><p>{member.role} · {member.capabilities.join(", ") || "keine Zusatzrechte"}</p></div>{organizer || member.role !== "organizer" ? <button type="button" onClick={() => void reset(member.accountId)}>Passwort-Reset</button> : null}</div>)}<h3>Einladungen</h3>{invites.length === 0 ? <p>Keine Einladungen.</p> : invites.map((invite) => <div className="org-heading-row" key={invite.id}><div><strong>{invite.role}</strong><p>bis {new Date(invite.expiresAt).toLocaleString("de-DE")} · {invite.usedAt ? "verwendet" : invite.revokedAt ? "widerrufen" : "aktiv"}</p></div>{!invite.usedAt && !invite.revokedAt && (organizer || invite.role !== "organizer") ? <button type="button" onClick={() => void revokeOrganizationInvite(organizationId, invite.id).then(() => onRefresh())}>Widerrufen</button> : null}</div>)}</section>;
}

function RoleTemplates({ organizationId, roles, allowedCapabilities, onRefresh }: { organizationId: string; roles: OrganizationRoleDto[]; allowedCapabilities: readonly string[]; onRefresh: () => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>(() => ["campaign.create", "campaign.manage"].filter((capability) => allowedCapabilities.includes(capability)));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCapabilities((current) => current.filter((capability) => allowedCapabilities.includes(capability)));
  }, [allowedCapabilities]);
  return <section className="org-card org-card--wide"><h2>Rollen-Vorlagen</h2><form className="org-form org-form--panel" onSubmit={(event) => { event.preventDefault(); setError(null); createOrganizationRole(organizationId, name, capabilities).then(() => { setName(""); return onRefresh(); }).catch((cause: unknown) => setError(errorMessage(cause))); }}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></label><CapabilityPicker value={capabilities} onChange={setCapabilities} allowedCapabilities={allowedCapabilities} />{error ? <p className="org-error">{error}</p> : null}<button>Rolle anlegen</button></form>{roles.map((role) => <div className="org-heading-row" key={role.id}><div><strong>{role.name}</strong><p>{role.capabilities.join(", ")}</p></div><button type="button" onClick={() => void deleteOrganizationRole(organizationId, role.id).then(() => onRefresh())}>Löschen</button></div>)}</section>;
}

function FeatureSettings({ organizationId, features, onRefresh }: { organizationId: string; features: OrganizationFeatureDto[]; onRefresh: () => Promise<void> | void }) {
  const [key, setKey] = useState(""); const [enabled, setEnabled] = useState(true); const [error, setError] = useState<string | null>(null);
  return <section className="org-card org-card--wide"><h2>Feature-Flags</h2><p>Berechtigungen und Features bleiben getrennt. Ein Feature-Flag erteilt niemals automatisch Rechte.</p><form className="org-form org-form--panel" onSubmit={(event) => { event.preventDefault(); setError(null); updateOrganizationFeature(organizationId, key, enabled).then(() => { setKey(""); return onRefresh(); }).catch((cause: unknown) => setError(errorMessage(cause))); }}><label>Feature-Key<input value={key} onChange={(event) => setKey(event.target.value)} pattern="[a-z0-9][a-z0-9._-]{0,79}" required /></label><label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> aktiviert</label>{error ? <p className="org-error">{error}</p> : null}<button>Speichern</button></form>{features.map((feature) => <div className="org-heading-row" key={feature.key}><strong>{feature.key}</strong><button type="button" onClick={() => void updateOrganizationFeature(organizationId, feature.key, !feature.enabled).then(() => onRefresh())}>{feature.enabled ? "Deaktivieren" : "Aktivieren"}</button></div>)}</section>;
}

function AuditLog({ events }: { events: OrganizationAuditEventDto[] }) {
  return <section className="org-card org-card--wide"><h2>Audit</h2>{events.length === 0 ? <p>Noch keine Audit-Ereignisse.</p> : <div>{events.slice(0, 100).map((event) => <div className="org-heading-row" key={event.id}><div><strong>{event.type}</strong><p>{event.targetType ?? "-"} · {event.targetId ?? "-"}</p></div><time>{new Date(event.createdAt).toLocaleString("de-DE")}</time></div>)}</div>}</section>;
}