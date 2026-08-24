import { useEffect, useState } from "react";
import {
  subscribeCampaignStore,
  type MutationSyncState,
} from "../data/campaignStore";
import { detectLanguage, type Language } from "../i18n";

function statusLabel(language: Language, state: MutationSyncState, pendingCount: number) {
  if (language === "en") {
    if (state === "syncing") return "Syncing…";
    if (state === "offline") return pendingCount > 0 ? "Saved offline" : "Saved";
    if (state === "conflict") return "Conflict";
    if (state === "blocked-auth") return "Access changed";
    if (state === "failed") return "Sync failed";
    if (state === "pending") {
      return pendingCount === 1 ? "1 change waiting" : `${pendingCount} changes waiting`;
    }
    return "Saved";
  }

  if (state === "syncing") return "Wird synchronisiert…";
  if (state === "offline") return pendingCount > 0 ? "Offline gespeichert" : "Gespeichert";
  if (state === "conflict") return "Konflikt";
  if (state === "blocked-auth") return "Zugriff geändert";
  if (state === "failed") return "Synchronisierung fehlgeschlagen";
  if (state === "pending") {
    return pendingCount === 1 ? "1 Änderung wartet" : `${pendingCount} Änderungen warten`;
  }
  return "Gespeichert";
}

export function SyncStatus() {
  const [language, setLanguage] = useState<Language>(detectLanguage);
  const [state, setState] = useState<MutationSyncState>("saved");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(
    () =>
      subscribeCampaignStore((update) => {
        if (update.syncState) setState(update.syncState);
        if (update.pendingCount !== undefined) setPendingCount(update.pendingCount);
      }),
    [],
  );

  useEffect(() => {
    const updateLanguage = () => setLanguage(detectLanguage());
    window.addEventListener("storage", updateLanguage);
    window.addEventListener("verteil-flyer-language", updateLanguage);
    return () => {
      window.removeEventListener("storage", updateLanguage);
      window.removeEventListener("verteil-flyer-language", updateLanguage);
    };
  }, []);

  const label = statusLabel(language, state, pendingCount);
  return (
    <div
      className={`mutation-sync-status is-${state}`}
      role="status"
      aria-live={state === "conflict" || state === "failed" || state === "blocked-auth" ? "assertive" : "polite"}
    >
      <span className="mutation-sync-dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
