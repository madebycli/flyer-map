import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AdminMapPicker } from "./AdminMapPicker.tsx";
import {
  OrganizationApiError,
  beginOrganizationLogin,
  bootstrapOrganizationAccount,
  completeOrganizationRecovery,
  completeOrganizationTotp,
  createOrganizationCampaign,
  getOrganizationMe,
  listOrganizationCampaigns,
  logoutOrganization,
  updateOrganizationCampaignLifecycle,
  type OrganizationCampaignDto,
  type OrganizationMeDto,
} from "./organizationApiClient.ts";
import {
  campaignIdFromOrganizationPath,
  safeOrganizationNext,
} from "./organizationRoutes.ts";
import "./organization-admin.css";

type Navigate = (path: string, replace?: boolean) => void;

type AsyncState<T> = {
  loading: boolean;
  value: T | null;
  error: string | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

function useOrganizationMe(navigate: Navigate): AsyncState<OrganizationMeDto> {
  const [state, setState] = useState<AsyncState<OrganizationMeDto>>({ loading: true, value: null, error: null });
  useEffect(() => {
    let active = true;
    getOrganizationMe()
      .then((value) => {
        if (active) setState({ loading: false, value, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof OrganizationApiError && error.status === 401) {
          const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
          navigate(`/login?next=${next}`, true);
          return;
        }
        setState({ loading: false, value: null, error: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [navigate]);
  return state;
}

function PageFrame({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <main className={compact ? "org-page org-page--compact" : "org-page"}>
      <header className="org-public-header">
        <a className="org-brand" href="/">Flyer Map</a>
        <span>Organizer Admin</span>
      </header>
      {children}
    </main>
  );
}

function AdminTopbar({ me, navigate }: { me: OrganizationMeDto; navigate: Navigate }) {
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logoutOrganization();
    } finally {
      navigate("/login", true);
    }
  };
  return (
    <header className="org-admin-topbar">
      <button className="org-brand org-brand--button" type="button" onClick={() => navigate("/admin")}>Flyer Map</button>
      <nav aria-label="Organizer Navigation">
        <button type="button" onClick={() => navigate("/admin")}>Aktionen</button>
        <button type="button" onClick={() => navigate("/new")}>Neue Aktion</button>
        <a href="/admin/security">Sicherheit</a>
        <a href="/">Feldkarte</a>
      </nav>
      <div className="org-account-chip">
        <span>{me.account.username}</span>
        <button type="button" disabled={busy} onClick={() => void logout()}>Abmelden</button>
      </div>
    </header>
  );
}

function StartPage({ navigate }: { navigate: Navigate }) {
  const [organizationName, setOrganizationName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [enrollment, setEnrollment] = useState<null | { otpauthUri: string; recoveryCodes: string[] }>(null);
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitSetup = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (password !== passwordAgain) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await bootstrapOrganizationAccount({ organizationName, username, password, bootstrapSecret });
      setEnrollment({ otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes });
      setBootstrapSecret("");
      setPassword("");
      setPasswordAgain("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const finishSetup = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await completeOrganizationTotp(totpCode);
      navigate("/admin", true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (enrollment) {
    return (
      <PageFrame compact>
        <section className="org-card org-enrollment-card">
          <span className="org-eyebrow">Schritt 2 von 2</span>
          <h1>MFA absichern</h1>
          <p>Scanne den QR-Code mit deiner Authenticator-App. Sichere anschließend die Recovery-Codes offline.</p>
          <div className="org-qr"><QRCodeSVG value={enrollment.otpauthUri} size={196} level="M" /></div>
          <details>
            <summary>Setup-Schlüssel manuell anzeigen</summary>
            <code className="org-break-code">{enrollment.otpauthUri}</code>
          </details>
          <div className="org-recovery-box">
            <div>
              <strong>Recovery-Codes</strong>
              <small>Jeder Code funktioniert nur einmal.</small>
            </div>
            <pre>{enrollment.recoveryCodes.join("\n")}</pre>
            <button type="button" onClick={() => void navigator.clipboard.writeText(enrollment.recoveryCodes.join("\n"))}>Codes kopieren</button>
          </div>
          <form className="org-form" onSubmit={(event) => void finishSetup(event)}>
            <label>6-stelliger Code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value)} required /></label>
            {error ? <p className="org-error" role="alert">{error}</p> : null}
            <button className="org-primary" disabled={busy || totpCode.length !== 6}>MFA bestätigen & Admin öffnen</button>
          </form>
        </section>
      </PageFrame>
    );
  }

  return (
    <PageFrame compact>
      <section className="org-card">
        <span className="org-eyebrow">Ersteinrichtung</span>
        <h1>Organization & ersten Organizer anlegen</h1>
        <p>Dieser Vorgang ist global nur einmal möglich und benötigt den separaten Setup-Schlüssel der isolierten Umgebung.</p>
        <form className="org-form" onSubmit={(event) => void submitSetup(event)}>
          <label>Organization<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} minLength={2} maxLength={120} autoComplete="organization" required /></label>
          <label>Benutzername<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} autoComplete="username" required /></label>
          <label>Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></label>
          <label>Passwort wiederholen<input type="password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></label>
          <label>Setup-Schlüssel<input type="password" value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} autoComplete="off" required /></label>
          {error ? <p className="org-error" role="alert">{error}</p> : null}
          <button className="org-primary" disabled={busy}>{busy ? "Wird angelegt …" : "Organization sicher anlegen"}</button>
        </form>
        <p className="org-secondary-copy">Bereits eingerichtet? <button type="button" className="org-link-button" onClick={() => navigate("/login")}>Zum Login</button></p>
      </section>
    </PageFrame>
  );
}

function LoginPage({ navigate }: { navigate: Navigate }) {
  const next = safeOrganizationNext(new URLSearchParams(window.location.search).get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      await beginOrganizationLogin(username, password);
      setPassword("");
      setPhase("factor");
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
        await completeOrganizationTotp(factor);
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
      <PageFrame compact>
        <section className="org-card">
          <span className="org-eyebrow">Recovery bestätigt</span>
          <h1>Sicherheitsfaktor erneuern</h1>
          <p>Die Recovery-Sitzung ist absichtlich eingeschränkt. Privilegierte Organizer-Aktionen bleiben gesperrt, bis TOTP neu eingerichtet wurde.</p>
          <button className="org-primary" type="button" onClick={() => navigate("/admin")}>Sitzungsstatus öffnen</button>
        </section>
      </PageFrame>
    );
  }

  return (
    <PageFrame compact>
      <section className="org-card">
        <span className="org-eyebrow">Organizer Login</span>
        <h1>{phase === "password" ? "Sicher anmelden" : "Zweiten Faktor bestätigen"}</h1>
        {phase === "password" ? (
          <form className="org-form" onSubmit={(event) => void submitPassword(event)}>
            <label>Benutzername<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
            <label>Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
            {error ? <p className="org-error" role="alert">{error}</p> : null}
            <button className="org-primary" disabled={busy}>{busy ? "Prüfe …" : "Weiter"}</button>
          </form>
        ) : (
          <form className="org-form" onSubmit={(event) => void submitFactor(event)}>
            <div className="org-segmented" role="group" aria-label="MFA-Methode">
              <button type="button" className={factorMode === "totp" ? "is-active" : ""} onClick={() => { setFactorMode("totp"); setFactor(""); }}>Authenticator</button>
              <button type="button" className={factorMode === "recovery" ? "is-active" : ""} onClick={() => { setFactorMode("recovery"); setFactor(""); }}>Recovery-Code</button>
            </div>
            <label>{factorMode === "totp" ? "6-stelliger Code" : "Recovery-Code"}<input value={factor} onChange={(event) => setFactor(event.target.value)} autoComplete={factorMode === "totp" ? "one-time-code" : "off"} inputMode={factorMode === "totp" ? "numeric" : "text"} required /></label>
            {error ? <p className="org-error" role="alert">{error}</p> : null}
            <button className="org-primary" disabled={busy}>Anmelden</button>
            <button className="org-link-button" type="button" onClick={() => { setPhase("password"); setFactor(""); setError(null); }}>Zurück</button>
          </form>
        )}
      </section>
    </PageFrame>
  );
}

function DashboardPage({ navigate }: { navigate: Navigate }) {
  const meState = useOrganizationMe(navigate);
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
      .then((result) => {
        if (active) setCampaigns(result.campaigns);
      })
      .catch((error: unknown) => {
        if (active) setCampaignError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoadingCampaigns(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId, meState.value?.assurance]);

  if (meState.loading) return <PageFrame><section className="org-status">Admin wird geladen …</section></PageFrame>;
  if (!meState.value) return <PageFrame><section className="org-status org-error">{meState.error ?? "Sitzung konnte nicht geladen werden."}</section></PageFrame>;
  const me = meState.value;
  const membership = me.memberships.find((item) => item.organizationId === organizationId) ?? me.memberships[0] ?? null;

  return (
    <main className="org-admin-page">
      <AdminTopbar me={me} navigate={navigate} />
      <section className="org-admin-content">
        <div className="org-heading-row">
          <div><span className="org-eyebrow">Organization</span><h1>Aktionen</h1></div>
          <button className="org-primary" type="button" disabled={me.assurance !== "mfa" || me.memberships.length === 0} onClick={() => navigate(`/new${organizationId ? `?organization=${encodeURIComponent(organizationId)}` : ""}`)}>+ Neue Aktion</button>
        </div>
        {me.memberships.length > 1 ? (
          <label className="org-select-label">Organization<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{me.memberships.map((item) => <option key={item.id} value={item.organizationId}>{item.organizationName}</option>)}</select></label>
        ) : membership ? <p className="org-organization-name">{membership.organizationName} · {membership.role === "organizer" ? "Organizer" : "Admin"}</p> : null}
        {me.assurance === "recovery" ? <div className="org-warning"><strong>Recovery-Sitzung</strong><p>Privilegierte Aktionen sind serverseitig gesperrt, bis MFA wieder vollständig hergestellt ist.</p></div> : null}
        {me.memberships.length === 0 ? <div className="org-empty"><h2>Keine Organization-Zuordnung</h2><p>Dieser Account besitzt aktuell keine aktive Mitgliedschaft.</p></div> : null}
        {campaignError ? <p className="org-error" role="alert">{campaignError}</p> : null}
        {loadingCampaigns ? <p className="org-status">Aktionen werden geladen …</p> : null}
        {!loadingCampaigns && !campaignError && me.assurance === "mfa" && campaigns.length === 0 && organizationId ? <div className="org-empty"><h2>Noch keine Aktion</h2><p>Erstelle die erste serverseitig persistierte Aktion für diese Organization.</p><button className="org-primary" type="button" onClick={() => navigate(`/new?organization=${encodeURIComponent(organizationId)}`)}>Erste Aktion erstellen</button></div> : null}
        <div className="org-campaign-grid">
          {campaigns.map((campaign) => (
            <button className="org-campaign-card" type="button" key={campaign.id} onClick={() => navigate(`/admin/campaign/${encodeURIComponent(campaign.id)}`)}>
              <div><span className={`org-lifecycle org-lifecycle--${campaign.lifecycle}`}>{campaign.lifecycle}</span><h2>{campaign.name}</h2></div>
              <dl><div><dt>Kartenfokus</dt><dd>{campaign.map ? `${campaign.map.lat.toFixed(3)}, ${campaign.map.lng.toFixed(3)} · z${campaign.map.zoom.toFixed(1)}` : "Nicht gesetzt"}</dd></div><div><dt>Aktualisiert</dt><dd>{new Date(campaign.updatedAt).toLocaleString("de-DE")}</dd></div></dl>
              <span>Öffnen →</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function NewCampaignPage({ navigate }: { navigate: Navigate }) {
  const meState = useOrganizationMe(navigate);
  const requestedOrganization = new URLSearchParams(window.location.search).get("organization") ?? "";
  const [organizationId, setOrganizationId] = useState(requestedOrganization);
  const [name, setName] = useState("");
  const [lifecycle, setLifecycle] = useState<"draft" | "active">("draft");
  const [map, setMap] = useState({ lng: 13.405, lat: 52.52, zoom: 11, bearing: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (organizationId || !meState.value) return;
    setOrganizationId(meState.value.memberships[0]?.organizationId ?? "");
  }, [organizationId, meState.value]);

  const canCreate = useMemo(() => {
    const membership = meState.value?.memberships.find((item) => item.organizationId === organizationId);
    return Boolean(meState.value?.assurance === "mfa" && membership?.capabilities.includes("campaign.create"));
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

  if (meState.loading) return <PageFrame><section className="org-status">Admin wird geladen …</section></PageFrame>;
  if (!meState.value) return <PageFrame><section className="org-status org-error">{meState.error}</section></PageFrame>;
  const me = meState.value;

  return (
    <main className="org-admin-page">
      <AdminTopbar me={me} navigate={navigate} />
      <section className="org-admin-content org-admin-content--narrow">
        <button className="org-back" type="button" onClick={() => navigate("/admin")}>← Aktionen</button>
        <div><span className="org-eyebrow">Neue Aktion</span><h1>Aktion erstellen</h1><p>Name, Organization, Startstatus und Kartenfokus werden serverseitig gespeichert.</p></div>
        <form className="org-form org-form--panel" onSubmit={(event) => void submit(event)}>
          <label>Organization<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>{me.memberships.map((item) => <option key={item.id} value={item.organizationId}>{item.organizationName}</option>)}</select></label>
          <label>Name der Aktion<input value={name} minLength={2} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="z. B. Frühjahr 2027" required /></label>
          <fieldset className="org-radio"><legend>Startstatus</legend><label><input type="radio" checked={lifecycle === "draft"} onChange={() => setLifecycle("draft")} /> Entwurf</label><label><input type="radio" checked={lifecycle === "active"} onChange={() => setLifecycle("active")} /> Aktiv</label></fieldset>
          <div><strong>Kartenfokus</strong><p className="org-help">Verschiebe die Karte an den Arbeitsbereich. Die Mitte und Zoomstufe werden mit der Aktion gespeichert.</p><AdminMapPicker value={map} onChange={setMap} /></div>
          {!canCreate ? <p className="org-error">Für diese Organization fehlt eine vollständig bestätigte MFA-Sitzung oder die Berechtigung <code>campaign.create</code>.</p> : null}
          {error ? <p className="org-error" role="alert">{error}</p> : null}
          <button className="org-primary" disabled={!canCreate || busy}>{busy ? "Aktion wird erstellt …" : "Aktion erstellen"}</button>
        </form>
      </section>
    </main>
  );
}

function CampaignPage({ navigate, campaignId }: { navigate: Navigate; campaignId: string }) {
  const meState = useOrganizationMe(navigate);
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
            if (active) {
              setCampaign(found);
              setOrganizationId(membership.organizationId);
              setLoading(false);
            }
            return;
          }
        } catch {
          // A membership without campaign.manage is intentionally skipped.
        }
      }
      if (active) {
        setError("Aktion wurde in keiner für diesen Account sichtbaren Organization gefunden.");
        setLoading(false);
      }
    };
    void findCampaign();
    return () => {
      active = false;
    };
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

  if (meState.loading || loading) return <PageFrame><section className="org-status">Aktion wird geladen …</section></PageFrame>;
  if (!meState.value) return <PageFrame><section className="org-status org-error">{meState.error}</section></PageFrame>;
  const me = meState.value;

  return (
    <main className="org-admin-page">
      <AdminTopbar me={me} navigate={navigate} />
      <section className="org-admin-content org-admin-content--narrow">
        <button className="org-back" type="button" onClick={() => navigate("/admin")}>← Aktionen</button>
        {error ? <p className="org-error" role="alert">{error}</p> : null}
        {campaign ? (
          <>
            <div className="org-heading-row"><div><span className={`org-lifecycle org-lifecycle--${campaign.lifecycle}`}>{campaign.lifecycle}</span><h1>{campaign.name}</h1></div><a className="org-secondary" href={`/?campaign=${encodeURIComponent(campaign.id)}`}>Feldkarte öffnen</a></div>
            <section className="org-card org-card--wide">
              <h2>Lebenszyklus</h2>
              <div className="org-lifecycle-actions">{(["draft", "active", "completed", "archived"] as const).map((value) => <button type="button" key={value} disabled={busy || campaign.lifecycle === value} className={campaign.lifecycle === value ? "is-current" : ""} onClick={() => void setLifecycle(value)}>{value}</button>)}</div>
            </section>
            <section className="org-card org-card--wide"><h2>Kartenfokus</h2>{campaign.map ? <dl className="org-detail-grid"><div><dt>Breitengrad</dt><dd>{campaign.map.lat.toFixed(6)}</dd></div><div><dt>Längengrad</dt><dd>{campaign.map.lng.toFixed(6)}</dd></div><div><dt>Zoom</dt><dd>{campaign.map.zoom.toFixed(2)}</dd></div><div><dt>Ausrichtung</dt><dd>{campaign.map.bearing.toFixed(1)}°</dd></div></dl> : <p>Nicht gesetzt.</p>}</section>
            <section className="org-card org-card--wide"><h2>Persistenz</h2><p>Campaign-ID <code>{campaign.id}</code></p><p>Diese Aktion ist der Organization serverseitig zugeordnet und bleibt nach Abmelden, Cookie-Löschung und erneutem Login erhalten.</p></section>
          </>
        ) : null}
      </section>
    </main>
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
  return <PageFrame compact><section className="org-card"><h1>Admin-Seite nicht gefunden</h1><button className="org-primary" type="button" onClick={() => navigate("/admin", true)}>Zum Admin</button></section></PageFrame>;
}
