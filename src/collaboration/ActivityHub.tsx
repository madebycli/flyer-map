import { useCallback, useEffect, useState } from "react";
import { CampaignApiError } from "../data/campaignApi.ts";
import { fetchActivity } from "../data/activityApi.ts";
import type { ActivityItem, ActivityPage } from "../domain/activity.ts";
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { resolveRemoteReadState } from "./remoteReadState.ts";
import "./activity-hub.css";

type Props = {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
};

type LoadState = "idle" | "loading" | "loading-more";

function activityErrorMessage(error: unknown) {
  if (error instanceof CampaignApiError) {
    if (error.code === "activity_schema_unavailable") {
      return "Die Aktivität ist serverseitig vorbereitet, aber Migration 0007 ist noch nicht ausgerollt.";
    }
    if (error.status === 401) return "Für die Aktivität fehlt ein gültiger Zugriff.";
    if (error.status === 403) return "Diese Aktivität liegt außerhalb deines Zugriffs.";
    if (error.code === "network_error") return "Die Aktivität ist gerade nicht erreichbar.";
    return error.message;
  }
  return "Die Aktivität konnte nicht geladen werden.";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt unbekannt";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(value: string | null) {
  if (value === "open") return "Offen";
  if (value === "completed") return "Erledigt";
  if (value === "later") return "Später";
  if (value === "not-deliverable") return "Nicht zustellbar";
  return "Status geändert";
}

function actorLabel(item: ActivityItem) {
  if (item.actorCategory === "temporary-group") return "Temporäre Gruppe";
  if (item.actorCategory === "campaign-access") return "Campaign-Zugriff";
  if (item.actorCategory === "system") return "System";
  return "Zugriff";
}

function activityTitle(item: ActivityItem) {
  const details = item.details;
  if (details.kind === "task-status-changed") {
    const noun = details.taskType === "street" ? "Straße" : details.taskType === "house" ? "Haus" : "Aufgabe";
    return `${noun} ${details.targetLabel} wurde auf ${statusLabel(details.newStatus)} gesetzt`;
  }
  if (details.kind === "field-session-closed") {
    return `Einsatz von Team ${item.teamLabel ?? "unbekannt"} abgeschlossen`;
  }
  if (details.kind === "field-session-expired") return "Einsatz automatisch beendet";
  if (details.kind === "comment-created") {
    return `Kommentar zu ${details.targetLabel} hinzugefügt`;
  }
  if (details.kind === "comment-edited") return "Kommentar bearbeitet";
  if (details.kind === "automation-executed") {
    return `Straße ${details.targetLabel} automatisch abgeschlossen`;
  }
  return "Kommentar gelöscht";
}

function activityContext(item: ActivityItem) {
  const details = item.details;
  if (details.kind === "task-status-changed") return details.contextLabel;
  if (details.kind === "automation-executed") return details.contextLabel;
  if (details.kind === "comment-created" || details.kind === "comment-edited" || details.kind === "comment-deleted") {
    return details.contextLabel;
  }
  return item.teamLabel;
}

function sessionMetrics(item: ActivityItem) {
  if (item.details.kind !== "field-session-closed" && item.details.kind !== "field-session-expired") {
    return null;
  }
  const metrics: string[] = [];
  if (item.details.durationSeconds !== null) {
    metrics.push(`${Math.round(item.details.durationSeconds / 60)} Min.`);
  }
  if (item.details.participantCount !== null) {
    metrics.push(`${item.details.participantCount} Personen`);
  }
  return metrics.length > 0 ? metrics.join(" · ") : null;
}

export function ActivityHub({ context, online, onClose }: Props) {
  const campaignId = context?.campaignId ?? null;
  const canFilterTeams =
    (context?.accessRole === "admin" || context?.accessRole === "viewer") &&
    (context?.teams.length ?? 0) > 1;
  const forcedTeamId =
    context?.accessRole === "team-editor" || context?.accessRole === "field-group-member"
      ? context.accessTeamId
      : null;
  const [teamFilter, setTeamFilter] = useState("all");
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  const effectiveTeamId = forcedTeamId ?? (teamFilter === "all" ? null : teamFilter);
  const readState = resolveRemoteReadState({
    loading: loadState === "loading",
    error,
    itemCount: activities.length,
  });

  const load = useCallback(
    async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
      if (!campaignId || !context?.accessRole || !online) return;
      setLoadState(append ? "loading-more" : "loading");
      setError(null);
      if (!append) {
        setActivities([]);
        setNextCursor(null);
      }
      try {
        const page: ActivityPage = await fetchActivity(campaignId, {
          teamId: effectiveTeamId,
          cursor,
          limit: 30,
          signal,
        });
        setActivities((current) => (append ? [...current, ...page.activities] : page.activities));
        setNextCursor(page.nextCursor);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(activityErrorMessage(loadError));
      } finally {
        if (!signal?.aborted) setLoadState("idle");
      }
    },
    [campaignId, context?.accessRole, effectiveTeamId, online],
  );

  useEffect(() => {
    if (!online || !campaignId || !context?.accessRole) return;
    const controller = new AbortController();
    void load(null, false, controller.signal);
    return () => controller.abort();
  }, [campaignId, context?.accessRole, effectiveTeamId, load, online]);

  const scopeLabel = forcedTeamId
    ? context?.teams.find((team) => team.id === forcedTeamId)?.name ?? "Mein Team"
    : effectiveTeamId
      ? context?.teams.find((team) => team.id === effectiveTeamId)?.name ?? "Team"
      : "Gesamte Aktion";

  return (
    <div className="activity-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="activity-hub"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="activity-handle" aria-hidden="true" />
        <header className="activity-header">
          <div>
            <span>Verlauf</span>
            <strong id="activity-title">Aktivität</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Aktivität schließen">×</button>
        </header>

        <div className="activity-scroll">
          {!online ? (
            <div className="activity-notice is-offline" role="status">
              Offline: bereits geladene Aktivität bleibt sichtbar. Neue Aktivität benötigt Internet.
            </div>
          ) : null}

          {!context?.accessRole ? (
            <div className="activity-notice is-error" role="alert">
              Für die Aktivität ist ein gültiger Zugriff erforderlich.
            </div>
          ) : null}

          {error ? (
            <div className="activity-notice is-error" role="alert">
              <span>{error}</span>
              {online ? (
                <button type="button" onClick={() => void load(null, false)}>
                  Erneut laden
                </button>
              ) : null}
            </div>
          ) : null}

          {canFilterTeams ? (
            <label className="activity-filter">
              <span>Team</span>
              <select
                value={teamFilter}
                onChange={(event) => {
                  setTeamFilter(event.target.value);
                  if (!online) {
                    setActivities([]);
                    setNextCursor(null);
                  }
                }}
              >
                <option value="all">Alle Teams</option>
                {(context?.teams ?? []).map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="activity-toolbar">
            <span>{scopeLabel}</span>
            <button
              type="button"
              onClick={() => void load(null, false)}
              disabled={!online || loadState !== "idle" || !context?.accessRole}
            >
              Aktualisieren
            </button>
          </div>

          {readState === "loading" ? (
            <div className="activity-loading" role="status">Aktivität wird geladen ...</div>
          ) : null}

          {readState === "empty" ? (
            <div className="activity-empty" role="status">
              {online ? "Noch keine Aktivität vorhanden." : "Aktivität ist offline nicht abrufbar."}
            </div>
          ) : null}

          {readState === "data" ? (
            <ol className="activity-list" aria-label="Aktivitätsverlauf">
              {activities.map((item) => {
                const contextText = activityContext(item);
                const metrics = sessionMetrics(item);
                return (
                  <li className="activity-card" key={item.id}>
                    <div className="activity-card-marker" aria-hidden="true" />
                    <div className="activity-card-content">
                      <strong>{activityTitle(item)}</strong>
                      {contextText || metrics ? (
                        <span className="activity-card-context">
                          {contextText ?? metrics}
                          {contextText && metrics ? ` · ${metrics}` : ""}
                        </span>
                      ) : null}
                      <span className="activity-card-meta">
                        <time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
                        <span aria-hidden="true"> · </span>
                        <span>{actorLabel(item)}</span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {nextCursor ? (
            <button
              className="activity-more"
              type="button"
              disabled={!online || loadState !== "idle"}
              onClick={() => void load(nextCursor, true)}
            >
              {loadState === "loading-more" ? "Wird geladen ..." : "Mehr laden"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
