import { useEffect, useState } from "react";
import { accessTokenFromUrl, campaignIdFromUrl, type AccessInfo } from "../data/campaignApi.ts";
import { subscribeCampaignStore } from "../data/campaignStore.ts";

const READONLY_ONBOARDING_KEY = "verteil-flyer:onboarding:readonly:v1";
const LANGUAGE_KEY = "verteil-flyer:language";

// Capture link intent before campaignStore redeems and scrubs the fragment.
const enteredWithAccessLink = typeof window !== "undefined" && Boolean(accessTokenFromUrl());
const enteredCampaignId = typeof window !== "undefined" ? campaignIdFromUrl() : null;

function linkLanguage() {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "de";
  } catch {
    return "de";
  }
}

function seen() {
  try {
    return window.localStorage.getItem(READONLY_ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(READONLY_ONBOARDING_KEY, "1");
  } catch {
    // Onboarding state is never part of authorization.
  }
}

export function AccessLinkOnboardingGate() {
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [open, setOpen] = useState(false);
  const language = linkLanguage();

  useEffect(() => {
    if (!enteredWithAccessLink || !enteredCampaignId || seen()) return;
    return subscribeCampaignStore((update) => {
      if (!update.access || update.access.campaignId !== enteredCampaignId) return;
      setAccess(update.access);
      if (update.access.role === "viewer") setOpen(true);
    });
  }, []);

  if (!open || !access || access.role !== "viewer") return null;

  const close = () => {
    markSeen();
    setOpen(false);
  };

  return (
    <div className="access-recovery-backdrop" role="presentation">
      <section className="access-recovery-card" role="dialog" aria-modal="true" aria-label={language === "de" ? "Nur-Lesen-Zugang" : "Read-only access"}>
        <span className="access-recovery-kicker">{language === "de" ? "Nur-Lesen-Link" : "Read-only link"}</span>
        <strong>{language === "de" ? "Diese Aktion ist für dich nur lesbar" : "This campaign is read-only for you"}</strong>
        <p>
          {language === "de"
            ? "Du kannst Karte, Gebiete, Straßen, Häuser, Fortschritt und freigegebene Informationen ansehen. Änderungen, neue Gebiete und Statusänderungen sind mit diesem Zugang gesperrt. Der Link wurde bereits sicher eingelöst und diese Anleitung beeinflusst deinen Zugang nicht."
            : "You can view the map and shared campaign information. Editing, new areas and status changes are disabled. The link has already been redeemed securely; this introduction does not affect your access."}
        </p>
        <button className="button primary full-width" type="button" onClick={close}>
          {language === "de" ? "Verstanden, Karte öffnen" : "Got it, open map"}
        </button>
      </section>
    </div>
  );
}
