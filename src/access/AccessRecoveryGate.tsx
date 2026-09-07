import { useEffect, useMemo, useState } from "react";
import { campaignIdFromUrl } from "../data/campaignApi";
import {
  subscribeCampaignStore,
  type CampaignAccessState,
} from "../data/campaignStore";
import { fieldGroupQrTokenFromUrl } from "../data/fieldGroupApi.ts";
import { detectLanguage } from "../i18n";

function scrubLegacyAdminFragments() {
  if (typeof window === "undefined" || !window.location.hash) return;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const hadLegacyAdminToken = params.has("admin-setup") || params.has("admin-reset");
  if (!hadLegacyAdminToken) return;
  params.delete("admin-setup");
  params.delete("admin-reset");
  url.hash = params.toString();
  window.history.replaceState(null, "", url);
}

export function AccessRecoveryGate() {
  const language = useMemo(detectLanguage, []);
  const campaignId = campaignIdFromUrl();
  const [checking, setChecking] = useState(Boolean(campaignId));
  const [accessState, setAccessState] = useState<CampaignAccessState>("idle");
  const fieldGroupToken = useMemo(fieldGroupQrTokenFromUrl, []);
  const de = language === "de";

  useEffect(() => {
    scrubLegacyAdminFragments();
  }, []);

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

  if (!campaignId || fieldGroupToken || checking || accessState !== "required") return null;

  const next = `${window.location.pathname}${window.location.search}`;
  const loginUrl = `/login?next=${encodeURIComponent(next)}`;

  return (
    <div className="access-recovery-backdrop" role="presentation">
      <section className="access-recovery-card" aria-label={de ? "Organization-Anmeldung" : "Organization sign-in"}>
        <span className="access-recovery-kicker">
          {de ? "Campaign geschützt" : "Campaign protected"}
        </span>
        <strong>
          {de ? "Mit Organization-Konto anmelden" : "Sign in with your Organization account"}
        </strong>
        <p>
          {de
            ? "Organizer und Admins verwenden denselben zentralen Login mit Passwort und MFA. Kampagnenlokale Admin-Konten, Setup-Links und Recovery-Secrets werden nicht mehr verwendet."
            : "Organizers and admins use the same central password and MFA login. Campaign-local admin accounts, setup links and recovery secrets are no longer used."}
        </p>
        <a className="button primary full-width" href={loginUrl}>
          {de ? "Zum sicheren Login" : "Continue to secure sign-in"}
        </a>
        <p className="access-recovery-note">
          {de
            ? "Welche Bereiche du danach öffnen oder ändern darfst, wird durch deine Organization-Rolle und die vom Organizer vergebenen Berechtigungen bestimmt. Für noch nicht migrierte Alt-Campaigns bleibt ein gültiger Access-Link als Kompatibilitätszugang erforderlich."
            : "What you can open or change afterwards is determined by your Organization role and the permissions granted by an Organizer. Legacy campaigns that have not been migrated still require a valid access link for compatibility."}
        </p>
      </section>
    </div>
  );
}