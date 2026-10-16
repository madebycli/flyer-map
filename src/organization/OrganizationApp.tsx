import { Suspense, lazy, useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminMapPicker } from "./AdminMapPicker.tsx";
import {
  beginOrganizationLogin,
  bootstrapOrganizationAccount,
  completeOrganizationRecovery,
  completeOrganizationTotp,
  createOrganizationCampaign,
  getCampaignWindow,
  setCampaignWindow,
  type CampaignWindow,
  listOrganizationCampaigns,
  skipOrganizationMfaEnrollment,
  updateOrganizationCampaignLifecycle,
  type OrganizationCampaignDto,
} from "./organizationApiClient.ts";
import { campaignIdFromOrganizationPath, preserveDiagnosticFlag, safeOrganizationNext } from "./organizationRoutes.ts";
import { AdminBar, MeContext, OrganizationLine, PageLoading, TotpEnrollment, errorMessage, formatDate, useOrganizationMe, type AdminPage, type Navigate } from "./shared.tsx";
import { Button, Card, CenterPage, Chip, Facts, Field, Group, Heading, LinkButton, Notice, Page, Radio, Segmented, Select, ShellContext, TextInput } from "../ui/index.ts";

const InviteCenter = lazy(() => import("./OrganizationInviteCenter.tsx").then((m) => ({ default: m.OrganizationInviteCenter })));
const SecurityCenter = lazy(() => import("./OrganizationSecurityCenter.tsx").then((m) => ({ default: m.OrganizationSecurityCenter })));

const LIFECYCLE_LABEL: Record<string, string> = { draft: "Entwurf", active: "Aktiv", completed: "Beendet", archived: "Archiviert" };

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
const windowProblem = (start: string, end: string) => (start && end && new Date(end) <= new Date(start) ? "Das Ende muss nach dem Start liegen." : null);

/** Start and end of the Aktion, both optional: everybody sees the countdown. */
function WindowFields({ start, end, onStart, onEnd, disabled }: { start: string; end: string; onStart: (value: string) => void; onEnd: (value: string) => void; disabled?: boolean }) {
  const problem = windowProblem(start, end);
  return (
    <div className="ui-form">
      <Field label="Start (optional)"><TextInput type="datetime-local" value={start} onChange={(event) => onStart(event.target.value)} disabled={disabled} /></Field>
      <Field label="Ende (optional)"><TextInput type="datetime-local" value={end} onChange={(event) => onEnd(event.target.value)} disabled={disabled} /></Field>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
    </div>
  );
}

/** Said once on the Aktion page after creating, when the time window could not be saved together with it. */
let pendingNotice: string | null = null;

const Problem = ({ children }: { children: string | null }) => <CenterPage><Notice tone="error">{children ?? "Sitzung konnte nicht geladen werden."}</Notice></CenterPage>;

function StartPage({ navigate }: { navigate: Navigate }) {
  const [organizationName, setOrganizationName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [enrollment, setEnrollment] = useState<null | { otpauthUri: string; recoveryCodes: string[]; optionalMfaAllowed: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitSetup = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (password !== passwordAgain) { setError("Die Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await bootstrapOrganizationAccount({ organizationName, username, password, bootstrapSecret });
      setEnrollment({ otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes, optionalMfaAllowed: result.optionalMfaAllowed });
      setBootstrapSecret("");
      setPassword("");
      setPasswordAgain("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (enrollment) {
    return (
      <CenterPage>
        <TotpEnrollment
          enrollment={enrollment}
          title="MFA absichern"
          intro="QR-Code mit der Authenticator-App scannen."
          confirmLabel="MFA bestätigen & Admin öffnen"
          onConfirmed={() => navigate("/admin", true)}
          extra={enrollment.optionalMfaAllowed ? (
            <Button
              tone="quiet"
              busy={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void skipOrganizationMfaEnrollment().then(() => navigate("/admin", true)).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false));
              }}
            >
              2FA vorerst überspringen
            </Button>
          ) : null}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
      </CenterPage>
    );
  }

  return (
    <CenterPage>
      <Card eyebrow="Ersteinrichtung" title="Organisation & ersten Organizer anlegen" icon="shield">
        <p>Nur einmal möglich. Den Setup-Schlüssel kennst nur du.</p>
        <form className="ui-form" onSubmit={(event) => void submitSetup(event)}>
          <Field label="Organisation"><TextInput value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} minLength={2} maxLength={120} autoComplete="organization" required /></Field>
          <Field label="Benutzername"><TextInput value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} autoComplete="username" required /></Field>
          <Field label="Passwort"><TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></Field>
          <Field label="Passwort wiederholen"><TextInput type="password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></Field>
          <Field label="Setup-Schlüssel"><TextInput type="password" value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} autoComplete="off" required /></Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button tone="primary" busy={busy}>{busy ? "Wird angelegt …" : "Organisation sicher anlegen"}</Button>
        </form>
        <p>Bereits eingerichtet? <Button tone="quiet" onClick={() => navigate("/login")}>Zum Login</Button></p>
      </Card>
    </CenterPage>
  );
}

function LoginPage({ navigate }: { navigate: Navigate }) {
  const next = preserveDiagnosticFlag(safeOrganizationNext(new URLSearchParams(window.location.search).get("next")), window.location.search);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [phase, setPhase] = useState<"password" | "factor" | "recovery-done">("password");
  const [factorMode, setFactorMode] = useState<"totp" | "recovery">("totp");
  const [factor, setFactor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await beginOrganizationLogin(username, password, rememberDevice);
      setPassword("");
      if (result.requiresFactor) setPhase("factor");
      else navigate(next, true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitFactor = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (factorMode === "totp") {
        await completeOrganizationTotp(factor, rememberDevice);
        navigate(next, true);
      } else {
        await completeOrganizationRecovery(factor);
        setPhase("recovery-done");
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (phase === "recovery-done") {
    return (
      <CenterPage>
        <Card eyebrow="Recovery bestätigt" title="Sicherheitsfaktor erneuern" icon="shield">
          <p>Eingeschränkte Sitzung. Richte den Authenticator neu ein, um alles freizuschalten.</p>
          <Button tone="primary" onClick={() => navigate(preserveDiagnosticFlag("/admin", window.location.search))}>Sitzungsstatus öffnen</Button>
        </Card>
      </CenterPage>
    );
  }

  return (
    <CenterPage>
      <Card eyebrow="Organizer Login" title={phase === "password" ? "Sicher anmelden" : "Zweiten Faktor bestätigen"} icon="lock">
        {phase === "password" ? (
          <form className="ui-form" onSubmit={(event) => void submitPassword(event)}>
            <Field label="Benutzername"><TextInput value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></Field>
            <Field label="Passwort"><TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></Field>
            <label className="ui-check">
              <input type="checkbox" checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} />
              <span>Angemeldet bleiben (nur auf eigenen Geräten)</span>
            </label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button tone="primary" busy={busy}>{busy ? "Prüfe …" : "Weiter"}</Button>
          </form>
        ) : (
          <form className="ui-form" onSubmit={(event) => void submitFactor(event)}>
            <Segmented
              label="MFA-Methode"
              value={factorMode}
              options={[{ value: "totp", label: "Authenticator" }, { value: "recovery", label: "Recovery-Code" }]}
              onChange={(mode) => { setFactorMode(mode); setFactor(""); }}
            />
            <Field label={factorMode === "totp" ? "6-stelliger Code" : "Recovery-Code"}>
              <TextInput value={factor} onChange={(event) => setFactor(event.target.value)} autoComplete={factorMode === "totp" ? "one-time-code" : "off"} inputMode={factorMode === "totp" ? "numeric" : "text"} required />
            </Field>
            {rememberDevice && factorMode === "totp" ? <p>Dieses Gerät bleibt angemeldet.</p> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button tone="primary" busy={busy}>Anmelden</Button>
            <Button tone="quiet" onClick={() => { setPhase("password"); setFactor(""); setError(null); }}>Zurück</Button>
          </form>
        )}
      </Card>
    </CenterPage>
  );
}

function DashboardPage({ navigate, reload = 0 }: { navigate: Navigate; reload?: number }) {
  const meState = useOrganizationMe("/admin", (path) => navigate(path, true));
  const [organizationId, setOrganizationId] = useState("");
  const [campaigns, setCampaigns] = useState<OrganizationCampaignDto[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  useEffect(() => {
    const me = meState.value;
    if (!me || organizationId) return;
    setOrganizationId(me.memberships[0]?.organizationId ?? "");
  }, [meState.value, organizationId]);

  useEffect(() => {
    if (!organizationId || meState.value?.assurance !== "mfa") return;
    let active = true;
    if (reload === 0) setLoadingCampaigns(true); // coming back to the tab refreshes quietly, the list stays on screen
    setCampaignError(null);
    listOrganizationCampaigns(organizationId)
      .then((result) => { if (active) setCampaigns(result.campaigns); })
      .catch((error: unknown) => { if (active) setCampaignError(errorMessage(error)); })
      .finally(() => { if (active) setLoadingCampaigns(false); });
    return () => { active = false; };
  }, [organizationId, meState.value?.assurance, reload]);

  if (meState.loading) return <Page><PageLoading>Admin wird geladen …</PageLoading></Page>;
  if (!meState.value) return <Problem>{meState.error}</Problem>;
  const me = meState.value;
  const membership = me.memberships.find((item) => item.organizationId === organizationId) ?? me.memberships[0] ?? null;
  const canCreateCampaign = Boolean(me.assurance === "mfa" && membership?.role === "organizer");
  const newPath = `/new${organizationId ? `?organization=${encodeURIComponent(organizationId)}` : ""}`;

  return (
    <Page>
      <Heading eyebrow="Organisation" title="Aktionen">
        {membership?.role === "organizer" ? <Button tone="primary" icon="plus" disabled={!canCreateCampaign} onClick={() => navigate(newPath)}>Neue Aktion</Button> : null}
      </Heading>
      <OrganizationLine me={me} organizationId={organizationId} onChange={setOrganizationId} />
      {me.assurance === "recovery" ? <Notice tone="warn">Eingeschränkte Sitzung: Richte den Authenticator neu ein.</Notice> : null}
      {me.memberships.length === 0 ? <Card title="Keine Organisation-Zuordnung" icon="info"><p>Dieser Account besitzt aktuell keine aktive Mitgliedschaft.</p></Card> : null}
      {campaignError ? <Notice tone="error">{campaignError}</Notice> : null}
      {loadingCampaigns ? <PageLoading>Aktionen werden geladen …</PageLoading> : null}
      {!loadingCampaigns && !campaignError && me.assurance === "mfa" && campaigns.length === 0 && organizationId ? (
        <Card title="Noch keine Aktion" icon="mailbox">
          <p>{membership?.role === "organizer" ? "Erstelle die erste Aktion für diese Organisation." : "Für diese Organisation ist noch keine für deinen Admin sichtbare Aktion vorhanden."}</p>
          {membership?.role === "organizer" ? <Button tone="primary" icon="plus" onClick={() => navigate(`/new?organization=${encodeURIComponent(organizationId)}`)}>Erste Aktion erstellen</Button> : null}
        </Card>
      ) : null}
      <div className="ui-grid">
        {campaigns.map((campaign) => (
          <button className="ui-campaign" type="button" key={campaign.id} onClick={() => navigate(preserveDiagnosticFlag(`/admin/campaign/${encodeURIComponent(campaign.id)}`, window.location.search))}>
            <div><Chip tone={campaign.lifecycle}>{LIFECYCLE_LABEL[campaign.lifecycle] ?? campaign.lifecycle}</Chip><h2>{campaign.name}</h2></div>
            <small>Aktualisiert {formatDate(campaign.updatedAt)}</small>
            <span className="go">Öffnen →</span>
          </button>
        ))}
      </div>
    </Page>
  );
}

function NewCampaignPage({ navigate }: { navigate: Navigate }) {
  const meState = useOrganizationMe("/new", (path) => navigate(path, true));
  const requestedOrganization = new URLSearchParams(window.location.search).get("organization") ?? "";
  const [organizationId, setOrganizationId] = useState(requestedOrganization);
  const [name, setName] = useState("");
  const [lifecycle, setLifecycle] = useState<"draft" | "active">("draft");
  const [map, setMap] = useState({ lng: 13.405, lat: 52.52, zoom: 11, bearing: 0 });
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!meState.value) return;
    const selected = meState.value.memberships.find((item) => item.organizationId === organizationId);
    if (selected?.role === "organizer") return;
    setOrganizationId(meState.value.memberships.find((item) => item.role === "organizer")?.organizationId ?? "");
  }, [organizationId, meState.value]);

  const canCreate = useMemo(() => {
    const membership = meState.value?.memberships.find((item) => item.organizationId === organizationId);
    return Boolean(meState.value?.assurance === "mfa" && membership?.role === "organizer");
  }, [meState.value, organizationId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate || busy) return;
    const problem = windowProblem(windowStart, windowEnd);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await createOrganizationCampaign(organizationId, { name, lifecycle, map });
      if (windowStart || windowEnd) {
        try { await setCampaignWindow(result.campaign.id, { startsAt: toIso(windowStart), endsAt: toIso(windowEnd) }); }
        catch { pendingNotice = "Die Aktion ist angelegt, das Zeitfenster konnte nicht gespeichert werden. Du kannst es hier nachtragen."; }
      }
      navigate(`/admin/campaign/${encodeURIComponent(result.campaign.id)}`, true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (meState.loading) return <Page><PageLoading>Admin wird geladen …</PageLoading></Page>;
  if (!meState.value) return <Problem>{meState.error}</Problem>;
  const me = meState.value;
  const organizerMemberships = me.memberships.filter((item) => item.role === "organizer");

  if (organizerMemberships.length === 0) {
    return (
      <Page narrow>
        <Button tone="quiet" className="ui-back" icon="back" onClick={() => navigate("/admin")}>Aktionen</Button>
        <Card title="Nur für Organizer" icon="lock"><p>Aktionen legen nur Organizer an.</p></Card>
      </Page>
    );
  }

  return (
    <Page narrow>
      <Button tone="quiet" className="ui-back" icon="back" onClick={() => navigate("/admin")}>Aktionen</Button>
      <Heading eyebrow="Neue Aktion" title="Aktion erstellen" />
      <p className="ui-muted">Name, Organisation, Startstatus und Kartenfokus werden serverseitig gespeichert.</p>
      <Card>
        <form className="ui-form" onSubmit={(event) => void submit(event)}>
          <Field label="Organisation"><Select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>{organizerMemberships.map((item) => <option key={item.id} value={item.organizationId}>{item.organizationName}</option>)}</Select></Field>
          <Field label="Name der Aktion"><TextInput value={name} minLength={2} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="z. B. Frühjahr 2027" required /></Field>
          <Group legend="Startstatus">
            <Radio name="lifecycle" label="Entwurf" checked={lifecycle === "draft"} onChange={() => setLifecycle("draft")} />
            <Radio name="lifecycle" label="Aktiv" checked={lifecycle === "active"} onChange={() => setLifecycle("active")} />
          </Group>
          <Group legend="Zeitfenster">
            <WindowFields start={windowStart} end={windowEnd} onStart={setWindowStart} onEnd={setWindowEnd} disabled={busy} />
          </Group>
          <div className="ui-form">
            <strong>Kartenfokus</strong>
            <AdminMapPicker value={map} onChange={setMap} />
          </div>
          {!canCreate ? <Notice tone="error">Für neue Aktionen ist eine Organizer-Rolle mit vollständig bestätigter MFA-Sitzung erforderlich.</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button tone="primary" busy={busy} disabled={!canCreate}>{busy ? "Aktion wird erstellt …" : "Aktion erstellen"}</Button>
        </form>
      </Card>
    </Page>
  );
}

const LIFECYCLES = ["draft", "active", "completed", "archived"] as const;

function CampaignPage({ navigate, campaignId }: { navigate: Navigate; campaignId: string }) {
  const meState = useOrganizationMe(`/admin/campaign/${encodeURIComponent(campaignId)}`, (path) => navigate(path, true));
  const [campaign, setCampaign] = useState<OrganizationCampaignDto | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [windowLoaded, setWindowLoaded] = useState<CampaignWindow | null | undefined>(undefined);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [windowNote, setWindowNote] = useState<string | null>(() => { const note = pendingNotice; pendingNotice = null; return note; });

  useEffect(() => {
    let active = true;
    getCampaignWindow(campaignId)
      .then((value) => { if (active) { setWindowLoaded(value); setWindowStart(toLocalInput(value?.startsAt ?? null)); setWindowEnd(toLocalInput(value?.endsAt ?? null)); } })
      .catch(() => { if (active) setWindowLoaded(null); });
    return () => { active = false; };
  }, [campaignId]);

  const saveWindow = async (next: CampaignWindow) => {
    if (busy) return;
    setBusy(true);
    setWindowNote(null);
    try { await setCampaignWindow(campaignId, next); setWindowLoaded(next); setWindowStart(toLocalInput(next.startsAt)); setWindowEnd(toLocalInput(next.endsAt)); setWindowNote("Zeitfenster gespeichert."); }
    catch (cause) { setWindowNote(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const me = meState.value;
    if (!me || me.assurance !== "mfa") return;
    let active = true;
    const findCampaign = async () => {
      setLoading(true);
      setError(null);
      for (const membership of me.memberships) {
        try {
          const result = await listOrganizationCampaigns(membership.organizationId);
          const found = result.campaigns.find((item) => item.id === campaignId);
          if (found) {
            if (active) { setCampaign(found); setOrganizationId(membership.organizationId); setLoading(false); }
            return;
          }
        } catch {
          // A membership without campaign.manage is intentionally skipped.
        }
      }
      if (active) { setError("Aktion wurde in keiner für diesen Account sichtbaren Organisation gefunden."); setLoading(false); }
    };
    void findCampaign();
    return () => { active = false; };
  }, [campaignId, meState.value]);

  const setLifecycle = async (next: OrganizationCampaignDto["lifecycle"]) => {
    if (!organizationId || !campaign || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateOrganizationCampaignLifecycle(organizationId, campaign.id, next);
      setCampaign({ ...campaign, lifecycle: next, updatedAt: new Date().toISOString() });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (meState.loading || loading) return <Page><PageLoading>Aktion wird geladen …</PageLoading></Page>;
  if (!meState.value) return <Problem>{meState.error}</Problem>;
  const me = meState.value;

  return (
    <Page narrow>
      <Button tone="quiet" className="ui-back" icon="back" onClick={() => navigate("/admin")}>Aktionen</Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {campaign ? (
        <>
          <Heading eyebrow={LIFECYCLE_LABEL[campaign.lifecycle] ?? campaign.lifecycle} title={campaign.name}>
            <LinkButton tone="primary" icon="mapPin" href={`/v5?campaign=${encodeURIComponent(campaign.id)}`}>Feldkarte öffnen</LinkButton>
          </Heading>
          <Card title="Lebenszyklus" icon="flag">
            <Segmented label="Lebenszyklus" value={campaign.lifecycle} options={LIFECYCLES.map((value) => ({ value, label: LIFECYCLE_LABEL[value] }))} onChange={(value) => { if (!busy && value !== campaign.lifecycle) void setLifecycle(value); }} />
          </Card>
          <Card title="Zeitfenster" icon="later">
            <p className="ui-muted">Start und Ende der Aktion. Alle sehen den Countdown in der Feldkarte.</p>
            <WindowFields start={windowStart} end={windowEnd} onStart={setWindowStart} onEnd={setWindowEnd} disabled={busy || windowLoaded === undefined} />
            {windowNote ? <Notice tone={windowNote.startsWith("Zeitfenster gespeichert") ? "ok" : "error"}>{windowNote}</Notice> : null}
            <div className="ui-actions">
              <Button tone="primary" busy={busy} disabled={busy || Boolean(windowProblem(windowStart, windowEnd))} onClick={() => void saveWindow({ startsAt: toIso(windowStart), endsAt: toIso(windowEnd) })}>Speichern</Button>
              {windowLoaded && (windowLoaded.startsAt || windowLoaded.endsAt) ? <Button disabled={busy} onClick={() => void saveWindow({ startsAt: null, endsAt: null })}>Entfernen</Button> : null}
            </div>
          </Card>
          <Card title="Kartenfokus" icon="mapPin">
            {campaign.map
              ? <Facts items={[["Breitengrad", campaign.map.lat.toFixed(6)], ["Längengrad", campaign.map.lng.toFixed(6)], ["Zoom", campaign.map.zoom.toFixed(2)], ["Ausrichtung", `${campaign.map.bearing.toFixed(1)}°`]]} />
              : <p>Nicht gesetzt.</p>}
          </Card>
          <Card title="Persistenz" icon="cloudOk">
            <p>Aktions-ID <code>{campaign.id}</code></p>
            
          </Card>
        </>
      ) : null}
    </Page>
  );
}

type Tab = "campaigns" | "new" | "invites" | "security";
const TITLES: Record<Tab, string> = { campaigns: "Aktionen", new: "Neue Aktion", invites: "Einladungen", security: "Sicherheit" };

/**
 * The signed-in part: one frame with the bar (a tab bar at the bottom of a phone) that stays where it is. The account is loaded once; a tab that has been
 * opened stays mounted (hidden), so switching back is instant and nothing is fetched again.
 */
function AdminShell({ navigate, pathname }: { navigate: Navigate; pathname: string }) {
  const meState = useOrganizationMe(pathname, (path) => navigate(path, true));
  const campaignId = campaignIdFromOrganizationPath(pathname);
  const tab: Tab = pathname === "/new" ? "new" : pathname === "/admin/invites" ? "invites" : pathname === "/admin/security" ? "security" : "campaigns";
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set([tab]));
  useEffect(() => { setOpened((current) => (current.has(tab) ? current : new Set(current).add(tab))); document.title = `${TITLES[tab]} | Flyer Map`; }, [tab]);
  const [dashboardReload, setDashboardReload] = useState(0);
  const [lastTab, setLastTab] = useState<Tab>(tab);
  if (tab !== lastTab) { setLastTab(tab); if (tab === "campaigns" && lastTab !== "campaigns") setDashboardReload((n) => n + 1); }
  if (meState.loading) return <Page><PageLoading>Wird geladen …</PageLoading></Page>;
  if (!meState.value) return <Problem>{meState.error}</Problem>;
  const me = meState.value;
  const show = (name: Tab) => opened.has(name) || name === tab;
  return (
    <div className="ui-page">
      <AdminBar me={me} current={tab as AdminPage} navigate={navigate} />
      <ShellContext.Provider value>
        <MeContext.Provider value={meState}>
          <Suspense fallback={<PageLoading>Wird geladen …</PageLoading>}>
            <div hidden={tab !== "campaigns" || Boolean(campaignId)}>{show("campaigns") ? <DashboardPage navigate={navigate} reload={dashboardReload} /> : null}</div>
            {campaignId ? <CampaignPage navigate={navigate} campaignId={campaignId} /> : null}
            {tab === "new" ? <NewCampaignPage navigate={navigate} /> : null}
            <div hidden={tab !== "invites"}>{show("invites") ? <InviteCenter /> : null}</div>
            <div hidden={tab !== "security"}>{show("security") ? <SecurityCenter /> : null}</div>
          </Suspense>
        </MeContext.Provider>
      </ShellContext.Provider>
    </div>
  );
}

export function OrganizationApp() {
  const [path, setPath] = useState(() => `${window.location.pathname}${window.location.search}`);
  useEffect(() => {
    const onPopState = () => setPath(`${window.location.pathname}${window.location.search}`);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = useMemo<Navigate>(() => (next, replace = false) => {
    if (replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
    setPath(`${window.location.pathname}${window.location.search}`);
  }, []);
  const pathname = path.split("?", 1)[0];
  const campaignId = campaignIdFromOrganizationPath(pathname);
  if (pathname === "/start") return <StartPage navigate={navigate} />;
  if (pathname === "/login") return <LoginPage navigate={navigate} />;
  if (pathname === "/new" || pathname === "/admin" || pathname === "/admin/invites" || pathname === "/admin/security" || campaignId) return <AdminShell navigate={navigate} pathname={pathname} />;
  return <CenterPage><Card title="Admin-Seite nicht gefunden" icon="info"><Button tone="primary" onClick={() => navigate("/admin", true)}>Zum Admin</Button></Card></CenterPage>;
}

