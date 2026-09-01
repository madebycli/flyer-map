import { useEffect, useMemo, useState } from "react";
import {
  CampaignApiError,
  buildCampaignAccessUrl,
  campaignAdminPasswordResetTokenFromUrl,
  campaignAdminSetupTokenFromUrl,
  completeCampaignAdminPasswordReset,
  campaignIdFromUrl,
  completeCampaignAdminAccountSetup,
  loginCampaignAdminAccount,
  removeCampaignAdminPasswordResetTokenFromUrl,
  removeCampaignAdminSetupTokenFromUrl,
  recoverCampaignAdminAccess,
} from "../data/campaignApi";
import {
  subscribeCampaignStore,
  type CampaignAccessState,
} from "../data/campaignStore";
import { detectLanguage } from "../i18n";

export function AccessRecoveryGate() {
  const language = useMemo(detectLanguage, []);
  const campaignId = campaignIdFromUrl();
  const [checking, setChecking] = useState(Boolean(campaignId));
  const [accessState, setAccessState] = useState<CampaignAccessState>("idle");
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveredUrl, setRecoveredUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const de = language === "de";
  const resetToken = useMemo(campaignAdminPasswordResetTokenFromUrl, []);
  const setupToken = useMemo(campaignAdminSetupTokenFromUrl, []);
  const accountLinkOpen = Boolean(resetToken || setupToken);

  useEffect(() => {
    if (!campaignId) {
      setChecking(false);
      return;
    }

    setChecking(true);
    const unsubscribe = subscribeCampaignStore((update) => {
      const nextState = update.accessState ?? "idle";
      setAccessState(nextState);
      setChecking(nextState === "idle" || nextState === "pending");
    });

    return unsubscribe;
  }, [campaignId]);

  if (
    !campaignId ||
    (checking && !recoveredUrl && !accountLinkOpen) ||
    (accessState !== "required" && !recoveredUrl && !accountLinkOpen)
  ) return null;

  const submit = async () => {
    if (!secret.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const recovered = await recoverCampaignAdminAccess(campaignId, secret);
      const accessUrl = buildCampaignAccessUrl(campaignId, recovered.initialAccessToken);
      setSecret("");
      setRecoveredUrl(accessUrl);
      window.dispatchEvent(new Event("online"));
    } catch (cause) {
      setError(
        cause instanceof CampaignApiError
          ? cause.message
          : de
            ? "Admin-Zugriff konnte nicht wiederhergestellt werden."
            : "Admin access could not be recovered.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const login = async () => {
    if (!campaignId || !username.trim() || !password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await loginCampaignAdminAccount(campaignId, username, password);
      setPassword("");
      window.dispatchEvent(new Event("online"));
    } catch (cause) {
      setError(
        cause instanceof CampaignApiError
          ? cause.message
          : de
            ? "Anmeldung konnte nicht durchgeführt werden."
            : "Sign-in could not be completed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const completeSetup = async () => {
    if (!campaignId || !setupToken || !username.trim() || !password || password !== passwordConfirmation || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await completeCampaignAdminAccountSetup(campaignId, setupToken, username, password);
      setPassword("");
      setPasswordConfirmation("");
      removeCampaignAdminSetupTokenFromUrl();
      window.dispatchEvent(new Event("online"));
    } catch (cause) {
      setError(
        cause instanceof CampaignApiError
          ? cause.message
          : de
            ? "Admin-Konto konnte nicht eingerichtet werden."
            : "Admin account could not be set up.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const completePasswordReset = async () => {
    if (!campaignId || !resetToken || !password || password !== passwordConfirmation || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await completeCampaignAdminPasswordReset(campaignId, resetToken, password);
      setPassword("");
      setPasswordConfirmation("");
      removeCampaignAdminPasswordResetTokenFromUrl();
      window.dispatchEvent(new Event("online"));
    } catch (cause) {
      setError(
        cause instanceof CampaignApiError
          ? cause.message
          : de
            ? "Passwort konnte nicht zurückgesetzt werden."
            : "Password could not be reset.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!recoveredUrl) return;
    try {
      await navigator.clipboard.writeText(recoveredUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(de ? "Link konnte nicht automatisch kopiert werden." : "The link could not be copied automatically.");
    }
  };

  return (
    <div className="access-recovery-backdrop" role="presentation">
      <section className="access-recovery-card" aria-label={de ? "Admin-Zugriff" : "Admin access"}>
        {recoveredUrl ? (
          <>
            <span className="access-recovery-kicker">{de ? "Zugriff wiederhergestellt" : "Access recovered"}</span>
            <strong>{de ? "Neuer Admin-Link erstellt" : "New admin link created"}</strong>
            <p>
              {de
                ? "Die Session ist wieder aktiv. Speichere diesen Link als sicheren Wiederherstellungslink. Er wird nicht automatisch dauerhaft gespeichert."
                : "Your session is active again. Save this link as a secure recovery link. It is not persisted automatically."}
            </p>
            <input className="access-recovery-link" readOnly value={recoveredUrl} aria-label={de ? "Neuer Admin-Link" : "New admin link"} />
            <div className="access-recovery-actions">
              <button className="button secondary" type="button" onClick={copy}>
                {copied ? (de ? "Kopiert" : "Copied") : de ? "Link kopieren" : "Copy link"}
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() => {
                  setRecoveredUrl(null);
                  setAccessState("pending");
                  setChecking(true);
                  window.dispatchEvent(new Event("online"));
                }}
              >
                {de ? "Zur Karte" : "Open map"}
              </button>
            </div>
          </>
        ) : resetToken ? (
          <>
            <span className="access-recovery-kicker">{de ? "Campaign-Admin" : "Campaign Admin"}</span>
            <strong>{de ? "Passwort zurücksetzen" : "Reset password"}</strong>
            <p>
              {de
                ? "Lege über diesen einmaligen Link ein neues Passwort für dein kampagnenlokales Admin-Konto fest."
                : "Use this one-time link to set a new password for your Campaign-local admin account."}
            </p>
            <label className="access-recovery-field">
              <span>{de ? "Neues Passwort" : "New password"}</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} />
            </label>
            <label className="access-recovery-field">
              <span>{de ? "Passwort wiederholen" : "Confirm password"}</span>
              <input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} onKeyDown={(event) => { if (event.key === "Enter") void completePasswordReset(); }} />
            </label>
            <p className="access-recovery-note">
              {de ? "Mindestens 12 Zeichen. Der Link ist 24 Stunden gültig, nur einmal nutzbar und meldet dich danach direkt an." : "At least 12 characters. The link is valid for 24 hours, single-use and signs you in afterwards."}
            </p>
            {error ? <p className="access-recovery-error" role="alert">{error}</p> : null}
            <button className="button primary full-width" type="button" disabled={password.length < 12 || password !== passwordConfirmation || submitting} onClick={() => void completePasswordReset()}>
              {submitting ? (de ? "Wird zurückgesetzt…" : "Resetting…") : de ? "Neues Passwort speichern" : "Save new password"}
            </button>
          </>
        ) : setupToken ? (
          <>
            <span className="access-recovery-kicker">{de ? "Campaign-Admin einrichten" : "Set up Campaign Admin"}</span>
            <strong>{de ? "Eigenes Passwort festlegen" : "Set your password"}</strong>
            <p>
              {de
                ? "Dieser einmalige Link richtet ein lokales Admin-Konto nur für diese Campaign ein."
                : "This one-time link sets up a local admin account for this Campaign only."}
            </p>
            <label className="access-recovery-field">
              <span>{de ? "Benutzername" : "Username"}</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={40} />
            </label>
            <label className="access-recovery-field">
              <span>{de ? "Passwort" : "Password"}</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} />
            </label>
            <label className="access-recovery-field">
              <span>{de ? "Passwort wiederholen" : "Confirm password"}</span>
              <input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={12} maxLength={256} />
            </label>
            <p className="access-recovery-note">
              {de ? "Mindestens 12 Zeichen. Das Passwort wird nie im Browser gespeichert." : "At least 12 characters. The password is never stored in the browser."}
            </p>
            {error ? <p className="access-recovery-error" role="alert">{error}</p> : null}
            <button className="button primary full-width" type="button" disabled={!username.trim() || password.length < 12 || password !== passwordConfirmation || submitting} onClick={() => void completeSetup()}>
              {submitting ? (de ? "Wird eingerichtet…" : "Setting up…") : de ? "Admin-Konto einrichten" : "Set up admin account"}
            </button>
          </>
        ) : recoveryOpen ? (
          <>
            <span className="access-recovery-kicker">{de ? "Campaign geschützt" : "Campaign protected"}</span>
            <strong>{de ? "Admin-Zugriff wiederherstellen" : "Recover admin access"}</strong>
            <p>
              {de
                ? "Für diese Campaign fehlt in diesem Browser ein gültiger Access Link bzw. eine Session. Gib das Cloudflare-Recovery-Secret ein, das du für M4 gesetzt hast."
                : "This browser does not have a valid Access Link or session for this Campaign. Enter the Cloudflare recovery secret configured for M4."}
            </p>
            <label className="access-recovery-field">
              <span>{de ? "Recovery-Secret" : "Recovery secret"}</span>
              <input
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
                placeholder={de ? "Secret nur hier eingeben" : "Enter secret here only"}
              />
            </label>
            <p className="access-recovery-note">
              {de
                ? "Das Secret bleibt nur in diesem Formular und wird nicht im Browser gespeichert."
                : "The secret stays in this form only and is not stored in the browser."}
            </p>
            {error ? <p className="access-recovery-error" role="alert">{error}</p> : null}
            <button className="button primary full-width" type="button" disabled={!secret.trim() || submitting} onClick={() => void submit()}>
              {submitting ? (de ? "Wird wiederhergestellt…" : "Recovering…") : de ? "Admin-Zugriff wiederherstellen" : "Recover admin access"}
            </button>
            <button className="button secondary full-width" type="button" onClick={() => setRecoveryOpen(false)}>
              {de ? "Mit Passwort anmelden" : "Sign in with password"}
            </button>
          </>
        ) : (
          <>
            <span className="access-recovery-kicker">{de ? "Campaign geschützt" : "Campaign protected"}</span>
            <strong>{de ? "Als Admin anmelden" : "Sign in as admin"}</strong>
            <p>
              {de
                ? "Melde dich mit deinem kampagnenlokalen Admin-Konto an."
                : "Sign in with your Campaign-local admin account."}
            </p>
            <label className="access-recovery-field">
              <span>{de ? "Benutzername" : "Username"}</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={40} />
            </label>
            <label className="access-recovery-field">
              <span>{de ? "Passwort" : "Password"}</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" maxLength={256} onKeyDown={(event) => { if (event.key === "Enter") void login(); }} />
            </label>
            {error ? <p className="access-recovery-error" role="alert">{error}</p> : null}
            <button className="button primary full-width" type="button" disabled={!username.trim() || !password || submitting} onClick={() => void login()}>
              {submitting ? (de ? "Wird angemeldet…" : "Signing in…") : de ? "Anmelden" : "Sign in"}
            </button>
            <button className="button secondary full-width" type="button" onClick={() => setRecoveryOpen(true)}>
              {de ? "Recovery-Secret verwenden" : "Use recovery secret"}
            </button>
          </>
        )}
        {error && recoveredUrl ? <p className="access-recovery-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
