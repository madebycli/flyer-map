import { useEffect, useMemo, useState } from "react";
import { CampaignApiError, campaignIdFromUrl } from "../data/campaignApi.ts";
import {
  fieldGroupQrTokenFromUrl,
  joinFieldGroup,
  removeFieldGroupQrTokenFromUrl,
} from "../data/fieldGroupApi.ts";

const joinAttempts = new Map<string, ReturnType<typeof joinFieldGroup>>();
const GROUP_ONBOARDING_KEY = "verteil-flyer:onboarding:group:v1";
const LANGUAGE_KEY = "verteil-flyer:language";

function linkLanguage() {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "de";
  } catch {
    return "de";
  }
}

function onboardingSeen() {
  try {
    return window.localStorage.getItem(GROUP_ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

function markOnboardingSeen() {
  try {
    window.localStorage.setItem(GROUP_ONBOARDING_KEY, "1");
  } catch {
    // Local storage is convenience only; the joined server session remains authoritative.
  }
}

function joinOnce(campaignId: string, token: string) {
  const key = `${campaignId}:${token}`;
  const existing = joinAttempts.get(key);
  if (existing) return existing;
  const created = joinFieldGroup(campaignId, "qr", token);
  joinAttempts.set(key, created);
  return created;
}

export function FieldGroupJoinGate() {
  const language = useMemo(linkLanguage, []);
  const campaignId = campaignIdFromUrl();
  const token = useMemo(fieldGroupQrTokenFromUrl, []);
  const [retryNonce, setRetryNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"joining" | "intro" | "error">(
    campaignId && token ? "joining" : "error",
  );

  useEffect(() => {
    if (!campaignId || !token) return;
    let cancelled = false;
    setPhase("joining");
    setError(null);

    void joinOnce(campaignId, token)
      .then(() => {
        if (cancelled) return;
        // Only scrub the secret after the server has accepted it and issued/confirmed
        // the membership session. The onboarding UI never participates in redemption.
        removeFieldGroupQrTokenFromUrl();
        if (onboardingSeen()) {
          window.dispatchEvent(new Event("online"));
          window.location.reload();
          return;
        }
        setPhase("intro");
      })
      .catch((cause) => {
        if (cancelled) return;
        setPhase("error");
        setError(
          cause instanceof CampaignApiError
            ? cause.message
            : language === "de"
              ? "Der Gruppenbeitritt konnte nicht abgeschlossen werden."
              : "The room join could not be completed.",
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

  const continueAfterIntro = () => {
    markOnboardingSeen();
    window.dispatchEvent(new Event("online"));
    window.location.reload();
  };

  return (
    <div className="access-recovery-backdrop" role="presentation">
      <section
        className="access-recovery-card"
        role="dialog"
        aria-modal="true"
        aria-label={language === "de" ? "Room beitreten" : "Join room"}
      >
        <span className="access-recovery-kicker">
          {language === "de" ? "Room / Gruppe" : "Room / group"}
        </span>

        {phase === "joining" ? (
          <>
            <strong>{language === "de" ? "Beitritt wird vorbereitet…" : "Preparing join…"}</strong>
            <p>
              {language === "de"
                ? "Der Gruppenlink wird sicher eingelöst. Dafür brauchst du keinen Admin-Login."
                : "The room link is being redeemed securely. No admin sign-in is required."}
            </p>
          </>
        ) : null}

        {phase === "intro" ? (
          <>
            <strong>{language === "de" ? "Du bist im Room" : "You joined the room"}</strong>
            <p>
              {language === "de"
                ? "Auf diesem Gerät siehst du nur den für deinen Room freigegebenen Team-Bereich. Markierungen und Statusänderungen werden mit der Aktion synchronisiert. Ein Room kann aus der Online-Liste ausgeblendet sein und trotzdem per gültigem Code oder QR-Link funktionieren."
                : "On this device you only see the team area assigned to your room. Updates sync with the campaign. A room may be hidden from the online list while valid codes and QR links continue to work."}
            </p>
            <button className="button primary full-width" type="button" onClick={continueAfterIntro}>
              {language === "de" ? "Karte öffnen" : "Open map"}
            </button>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <strong>{language === "de" ? "Beitritt fehlgeschlagen" : "Join failed"}</strong>
            <p>{error}</p>
            <button className="button primary full-width" type="button" onClick={retry}>
              {language === "de" ? "Erneut versuchen" : "Try again"}
            </button>
          </>
        ) : null}
      </section>
    </div>
  );
}
