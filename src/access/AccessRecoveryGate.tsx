import { useEffect, useMemo, useState } from "react";
import {
  CampaignApiError,
  buildCampaignAccessUrl,
  campaignIdFromUrl,
  fetchCurrentAccess,
  recoverCampaignAdminAccess,
} from "../data/campaignApi";
import { detectLanguage } from "../i18n";

export function AccessRecoveryGate() {
  const language = useMemo(detectLanguage, []);
  const campaignId = campaignIdFromUrl();
  const [checking, setChecking] = useState(Boolean(campaignId));
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveredUrl, setRecoveredUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const de = language === "de";

  useEffect(() => {
    if (!campaignId) {
      setChecking(false);
      return;
    }

    let active = true;
    void fetchCurrentAccess(campaignId)
      .then(() => {
        if (active) setNeedsRecovery(false);
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof CampaignApiError && cause.status === 401) setNeedsRecovery(true);
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, [campaignId]);

  if (!campaignId || checking || (!needsRecovery && !recoveredUrl)) return null;

  const submit = async () => {
    if (!secret.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const recovered = await recoverCampaignAdminAccess(campaignId, secret);
      const accessUrl = buildCampaignAccessUrl(campaignId, recovered.initialAccessToken);
      setSecret("");
      setRecoveredUrl(accessUrl);
      setNeedsRecovery(false);
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
                  window.dispatchEvent(new Event("online"));
                }}
              >
                {de ? "Zur Karte" : "Open map"}
              </button>
            </div>
          </>
        ) : (
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
          </>
        )}
        {error && recoveredUrl ? <p className="access-recovery-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
