import { useState, type FormEvent, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  completeOrganizationTotp,
  redeemOrganizationInvite,
  redeemOrganizationPasswordReset,
} from "./organizationApiClient.ts";
import "./organization-admin.css";

function consumeFragmentToken() {
  const params = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  const token = params.get("token") ?? "";
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <main className="org-page org-page--compact">
      <header className="org-public-header">
        <a className="org-brand" href="/">Flyer Map</a>
        <span>Organizer Admin</span>
      </header>
      {children}
    </main>
  );
}

export function OrganizationInviteRedeemPage() {
  const [token] = useState(consumeFragmentToken);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [enrollment, setEnrollment] = useState<{ otpauthUri: string; recoveryCodes: string[] } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "Einladungs-Token fehlt oder wurde bereits aus der URL entfernt.");

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    if (password !== passwordAgain) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await redeemOrganizationInvite({ inviteSecret: token, username, password });
      setEnrollment({ otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes });
      setPassword("");
      setPasswordAgain("");
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
      await completeOrganizationTotp(totpCode);
      window.location.replace("/admin");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (enrollment) {
    return (
      <PublicFrame>
        <section className="org-card org-enrollment-card">
          <span className="org-eyebrow">Einladung angenommen</span>
          <h1>MFA jetzt einrichten</h1>
          <p>Der Einladungs-Token ist bereits verbraucht. Scanne den QR-Code und sichere die neuen Recovery-Codes offline.</p>
          <div className="org-qr"><QRCodeSVG value={enrollment.otpauthUri} size={196} level="M" /></div>
          <details><summary>Setup-Schlüssel manuell anzeigen</summary><code className="org-break-code">{enrollment.otpauthUri}</code></details>
          <div className="org-recovery-box">
            <div><strong>Recovery-Codes</strong><small>Jeder Code ist genau einmal verwendbar.</small></div>
            <pre>{enrollment.recoveryCodes.join("\n")}</pre>
            <button type="button" onClick={() => void navigator.clipboard.writeText(enrollment.recoveryCodes.join("\n"))}>Codes kopieren</button>
          </div>
          <form className="org-form" onSubmit={(event) => void finish(event)}>
            <label>6-stelliger Code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value)} required /></label>
            {error ? <p className="org-error" role="alert">{error}</p> : null}
            <button className="org-primary" disabled={busy || totpCode.length !== 6}>MFA bestätigen & Admin öffnen</button>
          </form>
        </section>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      <section className="org-card">
        <span className="org-eyebrow">Organization-Einladung</span>
        <h1>Admin-Account sicher einrichten</h1>
        <p>Der Einladungs-Token wurde aus der Adresszeile entfernt und wird nur für diesen einmaligen Setup-Vorgang im Speicher gehalten.</p>
        <form className="org-form" onSubmit={(event) => void redeem(event)}>
          <label>Benutzername<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={40} autoComplete="username" required /></label>
          <label>Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></label>
          <label>Passwort wiederholen<input type="password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></label>
          {error ? <p className="org-error" role="alert">{error}</p> : null}
          <button className="org-primary" disabled={busy || !token}>{busy ? "Einladung wird eingelöst …" : "Account anlegen"}</button>
        </form>
      </section>
    </PublicFrame>
  );
}

export function OrganizationPasswordResetPage() {
  const [token] = useState(consumeFragmentToken);
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "Reset-Token fehlt oder wurde bereits aus der URL entfernt.");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    if (password !== passwordAgain) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await redeemOrganizationPasswordReset(token, password);
      setPassword("");
      setPasswordAgain("");
      setDone(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <PublicFrame>
        <section className="org-card">
          <span className="org-eyebrow">Passwort geändert</span>
          <h1>Alle alten Sitzungen wurden widerrufen</h1>
          <p>Der Reset-Link ist verbraucht. Melde dich mit dem neuen Passwort und deinem zweiten Faktor neu an.</p>
          <a className="org-primary org-inline-action" href="/login">Zum Login</a>
        </section>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      <section className="org-card">
        <span className="org-eyebrow">Sicherer Passwort-Reset</span>
        <h1>Neues Passwort setzen</h1>
        <p>Der One-time-Token wurde sofort aus der URL entfernt. Nach erfolgreichem Reset werden alle bestehenden Organizer-Sitzungen serverseitig widerrufen.</p>
        <form className="org-form" onSubmit={(event) => void submit(event)}>
          <label>Neues Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></label>
          <label>Passwort wiederholen<input type="password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></label>
          {error ? <p className="org-error" role="alert">{error}</p> : null}
          <button className="org-primary" disabled={busy || !token}>{busy ? "Passwort wird ersetzt …" : "Passwort sicher ersetzen"}</button>
        </form>
      </section>
    </PublicFrame>
  );
}
