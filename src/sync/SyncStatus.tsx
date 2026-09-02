import { useEffect, useState } from "react";
import {
  subscribeCampaignStore,
  type SyncIssue,
  type MutationSyncState,
} from "../data/campaignStore";
import { detectLanguage, type Language } from "../i18n";

function statusLabel(language: Language, state: MutationSyncState, pendingCount: number) {
  if (language === "en") {
    if (state === "syncing") return "Syncing…";
    if (state === "offline") return "Offline";
    if (state === "conflict") return "Conflict";
    if (state === "blocked-auth") return "Access changed";
    if (state === "failed") return "Sync failed";
    if (state === "local-saved") return "Saved locally";
    if (state === "waiting-server") {
      return pendingCount === 1 ? "1 change waiting for server" : pendingCount > 1 ? `${pendingCount} changes waiting for server` : "Waiting for server";
    }
    return "Server confirmed";
  }

  if (state === "syncing") return "Wird synchronisiert…";
  if (state === "offline") return "Offline";
  if (state === "conflict") return "Konflikt";
  if (state === "blocked-auth") return "Zugriff geändert";
  if (state === "failed") return "Synchronisierung fehlgeschlagen";
  if (state === "local-saved") return "Lokal gespeichert";
  if (state === "waiting-server") {
    return pendingCount === 1 ? "1 Änderung wartet auf Server" : pendingCount > 1 ? `${pendingCount} Änderungen warten auf Server` : "Wartet auf Server";
  }
  return "Serverbestätigt";
}

export function SyncStatus() {
  const [language, setLanguage] = useState<Language>(detectLanguage);
  const [state, setState] = useState<MutationSyncState>("local-saved");
  const [pendingCount, setPendingCount] = useState(0);
  const [issue, setIssue] = useState<SyncIssue | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(
    () =>
      subscribeCampaignStore((update) => {
        if (update.syncState) setState(update.syncState);
        if (update.pendingCount !== undefined) setPendingCount(update.pendingCount);
        if (update.syncIssue) {
          setIssue(update.syncIssue);
          setOpen(true);
        }
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
    <div className="mutation-sync-status-wrap">
      <button
        className={`mutation-sync-status is-${state}`}
        type="button"
        onClick={() => issue && setOpen((visible) => !visible)}
        aria-expanded={issue ? open : undefined}
        aria-label={issue ? `${label}: ${issue.message}` : label}
      >
        <span className="mutation-sync-dot" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {issue && open ? (
        <section className="mutation-sync-issue" role="dialog" aria-label="Synchronisierungsinfo">
          <strong>{issue.kind === "server-wins" ? "Online-Version übernommen" : "Synchronisierungsinfo"}</strong>
          <p>{issue.message}</p>
          {issue.mutationType ? <small>Betroffen: {issue.mutationType}</small> : null}
          <button type="button" className="small-action" onClick={() => setOpen(false)}>Verstanden</button>
        </section>
      ) : null}
    </div>
  );
}
