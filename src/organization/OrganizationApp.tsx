import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminMapPicker } from "./AdminMapPicker.tsx";
import {
  beginOrganizationLogin,
  bootstrapOrganizationAccount,
  completeOrganizationRecovery,
  completeOrganizationTotp,
  createOrganizationCampaign,
  listOrganizationCampaigns,
  skipOrganizationMfaEnrollment,
  updateOrganizationCampaignLifecycle,
  type OrganizationCampaignDto,
} from "./organizationApiClient.ts";
import { campaignIdFromOrganizationPath, preserveDiagnosticFlag, safeOrganizationNext } from "./organizationRoutes.ts";
import { AdminBar, OrganizationLine, PageLoading, TotpEnrollment, errorMessage, formatDate, useOrganizationMe, type Navigate } from "./shared.tsx";
import { Button, Card, CenterPage, Chip, Facts, Field, Group, Heading, LinkButton, Notice, Page, Radio, Segmented, Select, TextInput } from "../ui/index.ts";

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
          intro="Scanne den QR-Code mit deiner Authenticator-App. Sichere anschließend die Recovery-Codes offline."
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
      <Card eyebrow="Ersteinrichtung" title="Organization & ersten Organizer anlegen" icon="shield">
        <p>Dieser Vorgang ist global nur einmal möglich und benötigt den separaten Setup-Schlüssel der isolierten Umgebung.</p>
        <form className="ui-form" onSubmit={(event) => void submitSetup(event)}>
          <Field label="Organization"><TextInput value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} minLength={2} maxLength={120} autoComplete="organization" required /></Field>
          <Field label="Benutzername"><TextInput value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} autoComplete="username" required /></Field>
          <Field label="Passwort"><TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></Field>
          <Field label="Passwort wiederholen"><TextInput type="password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></Field>
          <Field label="Setup-Schlüssel"><TextInput type="password" value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} autoComplete="off" required /></Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button tone="primary" busy={busy}>{busy ? "Wird angelegt …" : "Organization sicher anlegen"}</Button>
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
  const [rememberDevice, setRememberDevice] = useState(false);
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
          <p>Die Recovery-Sitzung ist absichtlich eingeschränkt. Privilegierte Organizer-Aktionen bleiben gesperrt, bis TOTP neu eingerichtet wurde.</p>
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
              <span>Dieses Gerät merken<small>Die aktive Sitzung bleibt 12 Stunden kurzlebig. Dieses Gerät darf sie bis zu 60 Tage Inaktivität, maximal 90 Tage insgesamt, sicher erneuern.</small></span>
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
            {rememberDevice && factorMode === "totp" ? <p>Nach erfolgreicher MFA wird nur dieses Gerät als vertrauenswürdig registriert. Der Remember-Token ist HttpOnly und wird bei jeder Erneuerung rotiert.</p> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button tone="primary" busy={busy}>Anmelden</Button>
            <Button tone="quiet" onClick={() => { setPhase("password"); setFactor(""); setError(null); }}>Zurück</Button>
          </form>
        )}
      </Card>
    </CenterPage>
  );
}

function DashboardPage({ navigate }: { navigate: Navigate }) {
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
    setLoadingCampaigns(true);
    setCampaignError(null);
    listOrganizationCampaigns(organizationId)
      .then((result) => { if (active) setCampaigns(result.campaigns); })
      .catch((error: unknown) => { if (active) setCampaignError(errorMessage(error)); })
      .finally(() => { if (active) setLoadingCampaigns(false); });
    return () => { active = false; };
  }, [organizationId, meState.value?.assurance]);

  if (meState.loading) return <Page><PageLoading>Admin wird geladen …</PageLoading></Page>;
  if (!meState.value) return <Problem>{meState.error}</Problem>;
  const me = meState.value;
  const membership = me.memberships.find((item) => item.organizationId === organizationId) ?? me.memberships[0] ?? null;
  const canCreateCampaign = Boolean(me.assurance === "mfa" && membership?.role === "organizer");
  const newPath = `/new${organizationId ? `?organization=${encodeURIComponent(organizationId)}` : ""}`;

  return (
    <Page bar={<AdminBar me={me} current="campaigns" navigate={navigate} />}>
      <Heading eyebrow="Organization" title="Aktionen">
        {membership?.role === "organizer" ? <Button tone="primary" icon="plus" disabled={!canCreateCampaign} onClick={() => navigate(newPath)}>Neue Aktion</Button> : null}
      </Heading>
      <OrganizationLine me={me} organizationId={organizationId} onChange={setOrganizationId} />
      {me.assurance === "recovery" ? <Notice tone="warn">Recovery-Sitzung: Privilegierte Aktionen sind serverseitig gesperrt, bis MFA wieder vollständig hergestellt ist.</Notice> : null}
      {me.memberships.length === 0 ? <Card title="Keine Organization-Zuordnung" icon="info"><p>Dieser Account besitzt aktuell keine aktive Mitgliedschaft.</p></Card> : null}
      {campaignError ? <Notice tone="error">{campaignError}</Notice> : null}
      {loadingCampaigns ? <PageLoading>Aktionen werden geladen …</PageLoading> : null}
      {!loadingCampaigns && !campaignError && me.assurance === "mfa" && campaigns.length === 0 && organizationId ? (
        <Card title="Noch keine Aktion" icon="mailbox">
          <p>{membership?.role === "organizer" ? "Erstelle die erste Aktion für diese Organization." : "Für diese Organization ist noch keine für deinen Admin sichtbare Aktion vorhanden."}</p>
          {membership?.role === "organizer" ? <Button tone="primary" icon="plus" onClick={() => navigate(`/new?organization=${encodeURIComponent(organizationId)}`)}>Erste Aktion erstellen</Button> : null}
        </Card>
      ) : null}
      <div className="ui-grid">
        {campaigns.map((campaign) => (
          <button className="ui-campaign" type="button" key={campaign.id} onClick={() => navigate(preserveDiagnosticFlag(`/admin/campaign/${encodeURIComponent(campaign.id)}`, window.location.search))}>
            <div><Chip tone={campaign.lifecycle}>{campaign.lifecycle}</Chip><h2>{campaign.name}</h2></div>
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
    setBusy(true);
    setError(null);
    try {
      const result = await createOrganizationCampaign(organizationId, { name, lifecycle, map });
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
  const bar = <AdminBar me={me} current="new" navigate={navigate} />;

  if (organizerMemberships.length === 0) {
    return (
      <Page bar={bar} narrow>
        <Button tone="quiet" className="ui-back" onClick={() => navigate("/admin")}>← Aktionen</Button>
        <Card title="Nur für Organizer" icon="lock"><p>Neue Campaigns können ausschließlich von einem Organizer mit vollständig bestätigter MFA-Sitzung angelegt werden.</p></Card>
      </Page>
    );
  }

  return (
    <Page bar={bar} narrow>
      <Button tone="quiet" className="ui-back" onClick={() => navigate("/admin")}>← Aktionen</Button>
      <Heading eyebrow="Neue Aktion" title="Aktion erstellen" />
      <p className="ui-muted">Name, Organization, Startstatus und Kartenfokus werden serverseitig gespeichert.</p>
      <Card>
        <form className="ui-form" onSubmit={(event) => void submit(event)}>
          <Field label="Organization"><Select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>{organizerMemberships.map((item) => <option key={item.id} value={item.organizationId}>{item.organizationName}</option>)}</Select></Field>
          <Field label="Name der Aktion"><TextInput value={name} minLength={2} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="z. B. Frühjahr 2027" required /></Field>
          <Group legend="Startstatus">
            <Radio name="lifecycle" label="Entwurf" checked={lifecycle === "draft"} onChange={() => setLifecycle("draft")} />
            <Radio name="lifecycle" label="Aktiv" checked={lifecycle === "active"} onChange={() => setLifecycle("active")} />
          </Group>
          <div className="ui-form">
            <strong>Kartenfokus</strong>
            <AdminMapPicker value={map} onChange={setMap} />
          </div>
          {!canCreate ? <Notice tone="error">Für neue Campaigns ist eine Organizer-Rolle mit vollständig bestätigter MFA-Sitzung erforderlich.</Notice> : null}
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
      if (active) { setError("Aktion wurde in keiner für diesen Account sichtbaren Organization gefunden."); setLoading(false); }
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
    <Page bar={<AdminBar me={me} current="campaigns" navigate={navigate} />} narrow>
      <Button tone="quiet" className="ui-back" onClick={() => navigate("/admin")}>← Aktionen</Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {campaign ? (
        <>
          <Heading eyebrow={campaign.lifecycle} title={campaign.name}>
            <LinkButton tone="primary" icon="mapPin" href={`/v5?campaign=${encodeURIComponent(campaign.id)}`}>Feldkarte öffnen</LinkButton>
          </Heading>
          <Card title="Lebenszyklus" icon="flag">
            <Segmented label="Lebenszyklus" value={campaign.lifecycle} options={LIFECYCLES.map((value) => ({ value, label: value }))} onChange={(value) => { if (!busy && value !== campaign.lifecycle) void setLifecycle(value); }} />
          </Card>
          <Card title="Kartenfokus" icon="mapPin">
            {campaign.map
              ? <Facts items={[["Breitengrad", campaign.map.lat.toFixed(6)], ["Längengrad", campaign.map.lng.toFixed(6)], ["Zoom", campaign.map.zoom.toFixed(2)], ["Ausrichtung", `${campaign.map.bearing.toFixed(1)}°`]]} />
              : <p>Nicht gesetzt.</p>}
          </Card>
          <Card title="Persistenz" icon="cloudOk">
            <p>Campaign-ID <code>{campaign.id}</code></p>
            <p>Diese Aktion ist der Organization serverseitig zugeordnet und bleibt nach Abmelden, Cookie-Löschung und erneutem Login erhalten.</p>
          </Card>
        </>
      ) : null}
    </Page>
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
  if (pathname === "/new") return <NewCampaignPage navigate={navigate} />;
  if (pathname === "/admin") return <DashboardPage navigate={navigate} />;
  if (campaignId) return <CampaignPage navigate={navigate} campaignId={campaignId} />;
  return <CenterPage><Card title="Admin-Seite nicht gefunden" icon="info"><Button tone="primary" onClick={() => navigate("/admin", true)}>Zum Admin</Button></Card></CenterPage>;
}

