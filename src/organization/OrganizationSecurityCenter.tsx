import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  changeOrganizationPassword,
  changeOrganizationUsername,
  createOrganizationRole,
  deleteOrganizationRole,
  disableOrganizationMfa,
  getOrganizationMfaPreference,
  listOrganizationAudit,
  listOrganizationFeatures,
  listOrganizationRoles,
  listOrganizationSessions,
  restartOrganizationTotp,
  revokeOrganizationSession,
  rotateOrganizationRecoveryCodes,
  updateOrganizationFeature,
  type OrganizationAuditEventDto,
  type OrganizationFeatureDto,
  type OrganizationRoleDto,
  type OrganizationSessionDto,
} from "./organizationApiClient.ts";
import { AdminBar, OrganizationLine, PageLoading, TotpEnrollment, errorMessage, formatDate, useOrganizationMe } from "./shared.tsx";
import { Button, Card, Check, Facts, Field, Group, Heading, LinkButton, Notice, Page, Row, Secret, TextInput } from "../ui/index.ts";

/** Rights an Organizer may hand out. `campaign.create` is deliberately absent: new Campaigns are Organizer-only. */
const CAPABILITIES = [
  "organization.create",
  "organization.manage",
  "account.manage",
  "role.manage",
  "campaign.manage",
  "campaign.delete",
  "team.cross_manage",
  "audit.read",
  "security.manage",
] as const;

type Enrollment = { otpauthUri: string; recoveryCodes: string[] };

function CapabilityPicker({ value, onChange, allowed = CAPABILITIES }: { value: string[]; onChange: (next: string[]) => void; allowed?: readonly string[] }) {
  const visible = CAPABILITIES.filter((capability) => allowed.includes(capability));
  return (
    <Group legend="Berechtigungen">
      {visible.length === 0 ? <p>Keine delegierbaren Zusatzrechte.</p> : null}
      {visible.map((capability) => (
        <Check key={capability} label={capability} checked={value.includes(capability)} onChange={(event) => onChange(event.target.checked ? [...value, capability] : value.filter((item) => item !== capability))} />
      ))}
    </Group>
  );
}

/** A recovery session can do exactly one thing: confirm the password and start TOTP again. */
function RecoveryMfaCard({ organizationId }: { organizationId: string }) {
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
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

  if (enrollment) {
    return <TotpEnrollment enrollment={enrollment} title="TOTP neu bestätigen" intro="Recovery-Modus: Richte den Authenticator neu ein." confirmLabel="MFA abschließen" onConfirmed={() => window.location.replace("/admin/security")} />;
  }
  return (
    <Card eyebrow="Recovery-Sitzung" title="Privilegierte Aktionen sind gesperrt" icon="lock">
      <p>Bestätige dein aktuelles Passwort und richte TOTP neu ein. Die Recovery-Sitzung kann keine Admin-Änderungen ausführen.</p>
      <form className="ui-form" onSubmit={(event) => void restart(event)}>
        <Field label="Aktuelles Passwort"><TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button tone="primary" busy={busy}>TOTP sicher erneuern</Button>
      </form>
    </Card>
  );
}

/** 2FA can be switched off per account only while the deployment allows it ("Unstable"). */
function MfaPreferenceCard({ organizationId, required, onDisabled, onEnrollment }: { organizationId: string; required: boolean | null; onDisabled: () => void; onEnrollment: (value: Enrollment) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (required === null) return null;
  const run = async (task: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try { setMessage({ tone: "ok", text: await task() }); } catch (cause) { setMessage({ tone: "error", text: errorMessage(cause) }); } finally { setBusy(false); }
  };
  const disable = () => run(async () => { await disableOrganizationMfa(organizationId, password); onDisabled(); setPassword(""); return "2FA ist für diesen Unstable-Account deaktiviert."; });
  const enable = () => run(async () => { const result = await restartOrganizationTotp(organizationId, password); onEnrollment({ otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes }); setPassword(""); return "TOTP-Einrichtung gestartet. Nach Bestätigung ist 2FA wieder aktiv."; });
  return (
    <Card eyebrow="Zweiter Faktor" title="2FA in Unstable" icon="shield">
      <p>{required ? "2FA ist aktiv. Du kannst sie nur in Unstable für diesen Account deaktivieren." : "2FA ist deaktiviert. Login funktioniert nur mit Benutzername und Passwort."}</p>
      <Field label="Aktuelles Passwort"><TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field>
      <Button busy={busy} disabled={!password} onClick={() => void (required ? disable() : enable())}>{required ? "2FA deaktivieren" : "2FA aktivieren"}</Button>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </Card>
  );
}

/** Username, password, recovery codes and TOTP: each is a small form that needs the current password. */
function AccountForms({ organizationId, onRecoveryCodes, onTotp }: { organizationId: string; onRecoveryCodes: (codes: string[]) => void; onTotp: (value: Enrollment) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [username, setUsername] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try { await task(); setMessage({ tone: "ok", text: success }); } catch (cause) { setMessage({ tone: "error", text: errorMessage(cause) }); } finally { setBusy(false); }
  };
  const submit = (task: () => Promise<unknown>, success: string) => (event: FormEvent) => { event.preventDefault(); void run(task, success); };
  const password = <Field label="Aktuelles Passwort"><TextInput type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></Field>;
  return (
    <>
      <div className="ui-grid">
        <Card title="Benutzername ändern">
          <form className="ui-form" onSubmit={submit(() => changeOrganizationUsername(organizationId, currentPassword, username), "Benutzername geändert.")}>
            <Field label="Neuer Benutzername"><TextInput value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} required /></Field>
            {password}
            <Button busy={busy}>Speichern</Button>
          </form>
        </Card>
        <Card title="Passwort ändern">
          <form className="ui-form" onSubmit={submit(async () => { await changeOrganizationPassword(organizationId, currentPassword, nextPassword); window.location.replace("/login"); }, "Passwort geändert.")}>
            <Field label="Neues Passwort"><TextInput type="password" minLength={12} maxLength={256} value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} autoComplete="new-password" required /></Field>
            {password}
            <Button busy={busy}>Passwort ersetzen</Button>
          </form>
        </Card>
        <Card title="Recovery-Codes">
          <form className="ui-form" onSubmit={submit(async () => { const result = await rotateOrganizationRecoveryCodes(organizationId, currentPassword); onRecoveryCodes(result.recoveryCodes); }, "Recovery-Codes rotiert.")}>
            <p>Alle bisherigen unbenutzten Codes werden ungültig.</p>
            {password}
            <Button busy={busy}>Neue Codes erzeugen</Button>
          </form>
        </Card>
        <Card title="TOTP erneuern">
          <form className="ui-form" onSubmit={submit(async () => { const result = await restartOrganizationTotp(organizationId, currentPassword); onTotp({ otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes }); }, "TOTP-Rotation gestartet.")}>
            <p>Alle aktiven Sitzungen werden widerrufen.</p>
            {password}
            <Button busy={busy}>TOTP rotieren</Button>
          </form>
        </Card>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </>
  );
}

function RoleTemplates({ organizationId, roles, allowed, onRefresh }: { organizationId: string; roles: OrganizationRoleDto[]; allowed: readonly string[]; onRefresh: () => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>(() => ["campaign.manage"].filter((capability) => allowed.includes(capability)));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setCapabilities((current) => current.filter((capability) => allowed.includes(capability))); }, [allowed]);
  const create = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createOrganizationRole(organizationId, name, capabilities).then(() => { setName(""); return onRefresh(); }).catch((cause: unknown) => setError(errorMessage(cause)));
  };
  return (
    <Card title="Rollen-Vorlagen" icon="users">
      <form className="ui-form" onSubmit={create}>
        <Field label="Name"><TextInput value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></Field>
        <CapabilityPicker value={capabilities} onChange={setCapabilities} allowed={allowed} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button>Rolle anlegen</Button>
      </form>
      <div className="ui-list">
        {roles.map((role) => (
          <Row key={role.id} title={role.name} text={role.capabilities.filter((capability) => capability !== "campaign.create").join(", ")}>
            <Button tone="danger" onClick={() => void deleteOrganizationRole(organizationId, role.id).then(() => onRefresh())}>Löschen</Button>
          </Row>
        ))}
      </div>
    </Card>
  );
}

function FeatureSettings({ organizationId, features, onRefresh }: { organizationId: string; features: OrganizationFeatureDto[]; onRefresh: () => Promise<void> | void }) {
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const save = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    updateOrganizationFeature(organizationId, key, enabled).then(() => { setKey(""); return onRefresh(); }).catch((cause: unknown) => setError(errorMessage(cause)));
  };
  return (
    <Card title="Feature-Flags" icon="flag">
      <p>Berechtigungen und Features bleiben getrennt. Ein Feature-Flag erteilt niemals automatisch Rechte.</p>
      <form className="ui-form" onSubmit={save}>
        <Field label="Feature-Key"><TextInput value={key} onChange={(event) => setKey(event.target.value)} pattern="[a-z0-9][a-z0-9._-]{0,79}" required /></Field>
        <Check label="aktiviert" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button>Speichern</Button>
      </form>
      <div className="ui-list">
        {features.map((feature) => (
          <Row key={feature.key} title={feature.key}>
            <Button onClick={() => void updateOrganizationFeature(organizationId, feature.key, !feature.enabled).then(() => onRefresh())}>{feature.enabled ? "Deaktivieren" : "Aktivieren"}</Button>
          </Row>
        ))}
      </div>
    </Card>
  );
}

function AuditLog({ events }: { events: OrganizationAuditEventDto[] }) {
  return (
    <Card title="Audit" icon="eye">
      {events.length === 0 ? <p>Noch keine Audit-Ereignisse.</p> : (
        <div className="ui-list">
          {events.slice(0, 100).map((event) => <Row key={event.id} title={event.type} text={`${event.targetType ?? "-"} · ${event.targetId ?? "-"}`}><time className="ui-muted">{formatDate(event.createdAt)}</time></Row>)}
        </div>
      )}
    </Card>
  );
}

export function OrganizationSecurityCenter() {
  const meState = useOrganizationMe("/admin/security", (path) => window.location.replace(path));
  const me = meState.value;
  const [organizationId, setOrganizationId] = useState("");
  const [sessions, setSessions] = useState<OrganizationSessionDto[]>([]);
  const [roles, setRoles] = useState<OrganizationRoleDto[]>([]);
  const [features, setFeatures] = useState<OrganizationFeatureDto[]>([]);
  const [events, setEvents] = useState<OrganizationAuditEventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [totpEnrollment, setTotpEnrollment] = useState<Enrollment | null>(null);
  const [mfaRequired, setMfaRequired] = useState<boolean | null>(null);

  useEffect(() => { if (me && !organizationId) setOrganizationId(me.memberships[0]?.organizationId ?? ""); }, [me, organizationId]);
  const membership = useMemo(() => me?.memberships.find((item) => item.organizationId === organizationId) ?? me?.memberships[0] ?? null, [me, organizationId]);
  const has = (capability: string) => Boolean(membership?.role === "organizer" || membership?.capabilities.includes(capability));
  const delegable = membership?.role === "organizer" ? [...CAPABILITIES] : membership?.capabilities.filter((capability) => capability !== "campaign.create") ?? [];

  const refresh = async (nextOrganizationId = organizationId) => {
    if (!nextOrganizationId) return;
    setError(null);
    const tasks: Promise<void>[] = [
      listOrganizationSessions().then((result) => setSessions(result.sessions)),
      getOrganizationMfaPreference().then((result) => setMfaRequired(result.required)),
    ];
    if (has("role.manage")) tasks.push(listOrganizationRoles(nextOrganizationId).then((result) => setRoles(result.roles)));
    if (has("organization.manage")) tasks.push(listOrganizationFeatures(nextOrganizationId).then((result) => setFeatures(result.features)));
    if (has("audit.read")) tasks.push(listOrganizationAudit(nextOrganizationId).then((result) => setEvents(result.events)));
    try { await Promise.all(tasks); } catch (cause) { setError(errorMessage(cause)); }
  };

  useEffect(() => { if (me && organizationId) void refresh(organizationId); }, [me, organizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (meState.loading) return <Page><PageLoading>Security Center wird geladen …</PageLoading></Page>;
  if (!me || !membership) return <Page narrow><Card title="Keine aktive Organization" icon="info"><Notice tone="error">{meState.error ?? error ?? "Für diesen Account existiert keine aktive Mitgliedschaft."}</Notice><LinkButton href="/admin">Zurück</LinkButton></Card></Page>;

  const bar = <AdminBar me={me} current="security" />;
  if (me.assurance === "recovery") return <Page bar={bar} narrow><RecoveryMfaCard organizationId={membership.organizationId} /></Page>;

  return (
    <Page bar={bar}>
      <Heading eyebrow="Organization Security" title="Sicherheit & Zugriffe"><LinkButton href="/admin">Zurück zu Aktionen</LinkButton></Heading>
      <OrganizationLine me={me} organizationId={membership.organizationId} onChange={setOrganizationId} />
      {membership.role === "admin" ? <Notice>Deine Ansicht ist auf die vom Organizer delegierten Berechtigungen begrenzt.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {recoveryCodes ? (
        <Card eyebrow="Einmalig sichtbar" title="Neue Recovery-Codes" icon="shield" tone="warn">
          <Secret value={recoveryCodes.join("\n")} copyLabel="Codes kopieren" />
          <Button onClick={() => setRecoveryCodes(null)}>Ausblenden</Button>
        </Card>
      ) : null}

      <Card title="Eigener Account" icon="users">
        <Facts items={[["Benutzername", me.account.username], ["2FA", mfaRequired === false ? "deaktiviert (Unstable)" : "aktiv"]]} />
        <MfaPreferenceCard organizationId={membership.organizationId} required={mfaRequired} onDisabled={() => setMfaRequired(false)} onEnrollment={setTotpEnrollment} />
        <AccountForms organizationId={membership.organizationId} onRecoveryCodes={setRecoveryCodes} onTotp={setTotpEnrollment} />
        {totpEnrollment ? <TotpEnrollment enrollment={totpEnrollment} title="TOTP-Rotation abschließen" intro="Scanne den neuen QR-Code und bestätige mit einem Code." confirmLabel="Rotation bestätigen" onConfirmed={() => window.location.replace("/login")} /> : null}
      </Card>

      <Card title="Aktive Sitzungen" icon="lock">
        {sessions.length === 0 ? <p>Keine aktive Sitzung gefunden.</p> : (
          <div className="ui-list">
            {sessions.map((session) => (
              <Row key={session.id} title={session.current ? "Diese Sitzung" : session.id} text={`${session.assurance} · bis ${formatDate(session.expiresAt)}`}>
                {!session.current ? <Button tone="danger" onClick={() => void revokeOrganizationSession(session.id).then(() => refresh())}>Widerrufen</Button> : null}
              </Row>
            ))}
          </div>
        )}
      </Card>

      {has("account.manage") ? <Card title="Mitglieder & Einladungen" icon="send"><p>Einladungen, Passwort-Resets und Mitglieder verwaltest du auf der Seite Einladungen.</p><LinkButton href="/admin/invites" icon="send">Einladungen öffnen</LinkButton></Card> : null}
      {has("role.manage") ? <RoleTemplates organizationId={membership.organizationId} roles={roles} allowed={delegable} onRefresh={() => refresh()} /> : null}
      {has("organization.manage") ? <FeatureSettings organizationId={membership.organizationId} features={features} onRefresh={() => refresh()} /> : null}
      {has("audit.read") ? <AuditLog events={events} /> : null}
    </Page>
  );
}
