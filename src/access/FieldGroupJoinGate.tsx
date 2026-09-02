import { useEffect, useMemo, useState } from "react";
import { CampaignApiError, campaignIdFromUrl } from "../data/campaignApi.ts";
import {
  fieldGroupQrTokenFromUrl,
  joinFieldGroup,
  removeFieldGroupQrTokenFromUrl,
} from "../data/fieldGroupApi.ts";
import { detectLanguage } from "../i18n.ts";

const joinAttempts = new Map<string, ReturnType<typeof joinFieldGroup>>();

function joinOnce(campaignId: string, token: string) {
  const key = `${campaignId}:${token}`;
  const existing = joinAttempts.get(key);
  if (existing) return existing;
  const created = joinFieldGroup(campaignId, "qr", token);
  joinAttempts.set(key, created);
  return created;
}

export function FieldGroupJoinGate() {
  const language = useMemo(detectLanguage, []);
  const campaignId = campaignIdFromUrl();
  const token = useMemo(fieldGroupQrTokenFromUrl, []);
  const [retryNonce, setRetryNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(Boolean(campaignId && token));

  useEffect(() => {
    if (!campaignId || !token) {
      setJoining(false);
      return;
    }

    let cancelled = false;
    setJoining(true);
    setError(null);

    void joinOnce(campaignId, token)
      .then(() => {
        if (cancelled) return;
        removeFieldGroupQrTokenFromUrl();
        window.dispatchEvent(new Event("online"));
        window.location.reload();
      })
      .catch((cause) => {
        if (cancelled) return;
        setJoining(false);
        setError(
          cause instanceof CampaignApiError
            ? cause.message
            : language === "de"
              ? "Der Gruppenbeitritt konnte nicht abgeschlossen werden."
              : "The group join could not be completed.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, language, retryNonce, token]);

  if (!campaignId || !token) return null;

  const retry = () => {
    joinAttempts.delete(`${campaignId}:${token}`);
    setRetryNonce((current) => current + 1);
  };

  return (
    <div className="access-recovery-backdrop" role="presentation">
      <section
        className="access-recovery-card"
        role="dialog"
        aria-modal="true"
        aria-label={language === "de" ? "Tour beitreten" : "Join tour"}
      >
        <span className="access-recovery-kicker">
          {language === "de" ? "Tour / Gruppe" : "Tour / group"}
        </span>
        <strong>
          {joining
            ? language === "de"
              ? "Beitritt wird vorbereitet…"
              : "Preparing join…"
            : language === "de"
              ? "Beitritt fehlgeschlagen"
              : "Join failed"}
        </strong>
        <p>
          {joining
            ? language === "de"
              ? "Der QR- oder Einladungslink wird eingelöst. Dafür ist kein Admin-Benutzername und kein Admin-Passwort nötig."
              : "The QR or invitation link is being redeemed. No admin username or password is required."
            : error}
        </p>
        {!joining ? (
          <button className="button primary full-width" type="button" onClick={retry}>
            {language === "de" ? "Erneut versuchen" : "Try again"}
          </button>
        ) : null}
      </section>
    </div>
  );
}
