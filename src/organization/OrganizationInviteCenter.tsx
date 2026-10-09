import { useEffect, useMemo, useState } from "react";
import {
  createOrganizationInvite,
  createOrganizationPasswordReset,
  listOrganizationInvites,
  listOrganizationMembers,
  revokeOrganizationInvite,
  type OrganizationInviteDto,
  type OrganizationMemberDto,
} from "./organizationApiClient.ts";
import { AdminBar, OneTimeLinkDialog, OrganizationLine, PageLoading, errorMessage, formatDate, useOrganizationMe } from "./shared.tsx";
import { Button, Card, Check, Field, Group, Heading, LinkButton, Notice, Page, Row, Select } from "../ui/index.ts";

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

type LinkState = { kind: "invite" | "reset"; targetId: string; title: string; link: string };

/** The secret goes into the URL fragment, which browsers never send to a server. */
function buildSecretLink(path: string, secret: string) {
  const url = new URL(path, window.location.origin);
  url.hash = new URLSearchParams({ token: secret }).toString();
  return url.toString();
}

const roleName = (role: string) => (role === "organizer" ? "Organizer" : "Admin");

export function OrganizationInviteCenter() {
  const meState = useOrganizationMe("/admin/invites", (path) => window.location.replace(path));
  const me = meState.value;
  const [organizationId, setOrganizationId] = useState("");
  const [invites, setInvites] = useState<OrganizationInviteDto[]>([]);
  const [members, setMembers] = useState<OrganizationMemberDto[]>([]);
  const [role, setRole] = useState<"organizer" | "admin">("admin");
  const [capabilities, setCapabilities] = useState<string[]>(["campaign.manage"]);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const [dialog, setDialog] = useState<LinkState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (me && !organizationId) setOrganizationId(me.memberships[0]?.organizationId ?? ""); }, [me, organizationId]);

  const membership = useMemo(() => me?.memberships.find((item) => item.organizationId === organizationId) ?? me?.memberships[0] ?? null, [me, organizationId]);
  const organizer = membership?.role === "organizer";
  const canManageAccounts = Boolean(organizer || membership?.capabilities.includes("account.manage"));
  const delegable = useMemo(() => (organizer ? [...CAPABILITIES] : CAPABILITIES.filter((capability) => membership?.capabilities.includes(capability))), [membership, organizer]);

  const refresh = async (id = organizationId) => {
    if (!id || !canManageAccounts) return;
    setError(null);
    try {
      const [inviteResult, memberResult] = await Promise.all([listOrganizationInvites(id), listOrganizationMembers(id)]);
      setInvites(inviteResult.invites);
      setMembers(memberResult.members);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  useEffect(() => { if (me && organizationId && canManageAccounts) void refresh(organizationId); }, [canManageAccounts, me, organizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!organizer && role === "organizer") setRole("admin");
    setCapabilities((current) => current.filter((capability) => delegable.includes(capability as (typeof CAPABILITIES)[number])));
  }, [delegable, organizer, role]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await task(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };

  const createInvite = () => run(async () => {
    if (!membership || !canManageAccounts) return;
    const result = await createOrganizationInvite(membership.organizationId, { role, capabilities: role === "organizer" ? [] : capabilities, expiresInHours });
    const state: LinkState = { kind: "invite", targetId: result.invite.id, title: `${roleName(role)} einladen`, link: buildSecretLink("/join", result.secret) };
    setLinks((current) => ({ ...current, [result.invite.id]: state }));
    setDialog(state);
    await refresh(membership.organizationId);
  });

  const revokeInvite = (invite: OrganizationInviteDto) => run(async () => {
    if (!membership) return;
    await revokeOrganizationInvite(membership.organizationId, invite.id);
    setLinks((current) => { const next = { ...current }; delete next[invite.id]; return next; });
    await refresh(membership.organizationId);
  });

  const createReset = (member: OrganizationMemberDto) => run(async () => {
    if (!membership) return;
    const result = await createOrganizationPasswordReset(membership.organizationId, member.accountId, 30);
    const state: LinkState = { kind: "reset", targetId: member.accountId, title: `Passwort zurücksetzen: ${member.username}`, link: buildSecretLink("/reset", result.secret) };
    setLinks((current) => ({ ...current, [`reset:${member.accountId}`]: state }));
    setDialog(state);
  });

  if (meState.loading) return <Page><PageLoading>Einladungen werden geladen …</PageLoading></Page>;
  if (!me || !membership) return <Page narrow><Card title="Keine aktive Organization" icon="info"><Notice tone="error">{meState.error ?? error ?? "Keine aktive Mitgliedschaft gefunden."}</Notice></Card></Page>;

  const mfa = me.assurance === "mfa";
  return (
    <Page bar={<AdminBar me={me} current="invites" />}>
      <Heading eyebrow="Zugänge" title="Einladungen"><LinkButton href="/admin">Zurück zu Aktionen</LinkButton></Heading>
      <OrganizationLine me={me} organizationId={membership.organizationId} onChange={setOrganizationId} />
      {!mfa ? <Notice tone="warn">MFA erforderlich: Eine Recovery-Sitzung darf keine Einladungen oder Passwort-Resets erstellen. <a href="/admin/security">Sicherheit öffnen</a></Notice> : null}
      {!canManageAccounts ? <Card title="Keine Account-Berechtigung" icon="lock"><p>Für Einladungen brauchst du <code>account.manage</code> oder die Organizer-Rolle.</p></Card> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {canManageAccounts ? (
        <>
          <Card eyebrow="Neuer Zugang" title="Person einladen" icon="send">
            <p>Der Empfänger legt beim Einlösen selbst Benutzername, Passwort und MFA fest.</p>
            <div className="ui-grid">
              <Field label="Rolle">
                <Select value={role} onChange={(event) => { setRole(event.target.value as "organizer" | "admin"); setCapabilities([]); }}>
                  <option value="admin">Admin</option>{organizer ? <option value="organizer">Organizer</option> : null}
                </Select>
              </Field>
              <Field label="Gültigkeit">
                <Select value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))}>
                  <option value={24}>24 Stunden</option><option value={72}>3 Tage</option><option value={168}>7 Tage</option>
                </Select>
              </Field>
            </div>
            {role === "admin" ? (
              <Group legend="Berechtigungen">
                {delegable.map((capability) => (
                  <Check key={capability} label={CAPABILITY_LABELS[capability] ?? capability} hint={capability} checked={capabilities.includes(capability)}
                    onChange={(event) => setCapabilities(event.target.checked ? [...capabilities, capability] : capabilities.filter((item) => item !== capability))} />
                ))}
              </Group>
            ) : <Notice>Organizer besitzen die vollständige Organization-Verantwortung. Nur bestehende Organizer dürfen weitere Organizer einladen.</Notice>}
            <Button tone="primary" icon="send" busy={busy} disabled={!mfa} onClick={() => void createInvite()}>{busy ? "Wird erstellt …" : "Einladungslink erstellen"}</Button>
          </Card>

          <Card eyebrow="Einladungen" title="Offen & Verlauf" icon="mailbox">
            <div className="ui-actions"><Button icon="sync" disabled={busy} onClick={() => void refresh()}>Aktualisieren</Button></div>
            <div className="ui-list">
              {invites.length === 0 ? <p>Noch keine Einladungen.</p> : invites.map((invite) => {
                const active = !invite.usedAt && !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now();
                const stored = links[invite.id];
                const state = active ? `gültig bis ${formatDate(invite.expiresAt)}` : invite.usedAt ? "verwendet" : invite.revokedAt ? "widerrufen" : "abgelaufen";
                return (
                  <Row key={invite.id} title={roleName(invite.role)} text={<>{invite.capabilities.length > 0 ? invite.capabilities.join(" · ") : "Vollzugriff als Organizer"}<br />{state}</>}>
                    {active && stored ? <Button tone="primary" onClick={() => setDialog(stored)}>Link anzeigen</Button> : null}
                    {active && !stored ? <small className="ui-muted">Secret nach Reload nicht mehr abrufbar</small> : null}
                    {active ? <Button tone="danger" disabled={busy} onClick={() => void revokeInvite(invite)}>Widerrufen</Button> : null}
                  </Row>
                );
              })}
            </div>
          </Card>

          <Card eyebrow="Accounts" title="Passwort-Reset" icon="unlock">
            <p>Ein Reset-Link ist 30 Minuten gültig, einmalig und widerruft beim Einlösen die alten Sessions des Accounts.</p>
            <div className="ui-list">
              {members.map((member) => (
                <Row key={member.id} title={member.username} text={`${member.role} · ${member.capabilities.join(" · ") || "keine Zusatzrechte"}`}>
                  {links[`reset:${member.accountId}`] ? <Button tone="primary" onClick={() => setDialog(links[`reset:${member.accountId}`])}>Link anzeigen</Button> : null}
                  <Button disabled={busy || !mfa} onClick={() => void createReset(member)}>Reset-Link erstellen</Button>
                </Row>
              ))}
            </div>
          </Card>
        </>
      ) : null}
      {dialog ? <OneTimeLinkDialog title={dialog.title} link={dialog.link} onClose={() => setDialog(null)} /> : null}
    </Page>
  );
}
