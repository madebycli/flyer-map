import { useCallback, useEffect, useState } from "react";
import { CampaignApiError } from "../data/campaignApi.ts";
import {
  fetchFieldSessions,
  type FieldSessionSummary,
} from "../data/fieldSessionApi.ts";
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { FieldSessionHistory } from "./FieldSessionHistory.tsx";
import "./field-sessions-hub.css";

type Props = {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
};

type LoadState = "idle" | "loading" | "loading-more";

function historyErrorMessage(error: unknown) {
  if (error instanceof CampaignApiError) {
    if (error.code === "field_session_schema_unavailable") {
      return "Die Einsatzhistorie ist serverseitig vorbereitet, aber Migration 0007 ist noch nicht ausgerollt.";
    }
    if (error.status === 401) return "Für die Einsatzhistorie fehlt ein gültiger Zugriff.";
    if (error.status === 403) return "Diese Einsatzhistorie liegt außerhalb deines Zugriffs.";
    if (error.code === "network_error") return "Die Einsatzhistorie ist gerade nicht erreichbar.";
    return error.message;
  }
  return "Die Einsatzhistorie konnte nicht geladen werden.";
}

export function FieldSessionsHub({ context, online, onClose }: Props) {
  const campaignId = context?.campaignId ?? null;
  const canFilterTeams =
    (context?.accessRole === "admin" || context?.accessRole === "viewer") &&
    (context?.teams.length ?? 0) > 1;
  const forcedTeamId =
    context?.accessRole === "team-editor" || context?.accessRole === "field-group-member"
      ? context.accessTeamId
      : null;
  const [teamFilter, setTeamFilter] = useState("all");
  const [sessions, setSessions] = useState<FieldSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  const effectiveTeamId = forcedTeamId ?? (teamFilter === "all" ? null : teamFilter);

  const load = useCallback(
    async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
      if (!campaignId || !context?.accessRole || !online) return;
      setLoadState(append ? "loading-more" : "loading");
      setError(null);
      try {
        const page = await fetchFieldSessions(campaignId, {
          teamId: effectiveTeamId,
          cursor,
          limit: 30,
          signal,
        });
        setSessions((current) => (append ? [...current, ...page.sessions] : page.sessions));
        setNextCursor(page.nextCursor);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(historyErrorMessage(loadError));
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

  return (
    <div className="field-sessions-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="field-sessions-hub"
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-sessions-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="field-sessions-handle" aria-hidden="true" />
        <header className="field-sessions-header">
          <div>
            <span>Historie</span>
            <strong id="field-sessions-title">Einsätze</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Einsätze schließen">×</button>
        </header>

        <div className="field-sessions-scroll">
          {!online ? (
            <div className="field-sessions-notice is-offline" role="status">
              Offline: bereits geladene Einsätze bleiben sichtbar. Neue Historie benötigt Internet.
            </div>
          ) : null}

          {!context?.accessRole ? (
            <div className="field-sessions-notice is-error" role="alert">
              Für die Einsatzhistorie ist ein gültiger Zugriff erforderlich.
            </div>
          ) : null}

          {error ? (
            <div className="field-sessions-notice is-error" role="alert">
              <span>{error}</span>
              {online ? (
                <button type="button" onClick={() => void load(null, false)}>
                  Erneut laden
                </button>
              ) : null}
            </div>
          ) : null}

          {canFilterTeams ? (
            <label className="field-sessions-filter">
              <span>Team</span>
              <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                <option value="all">Alle Teams</option>
                {(context?.teams ?? []).map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="field-sessions-toolbar">
            <span>
              {forcedTeamId
                ? context?.teams.find((team) => team.id === forcedTeamId)?.name ?? "Mein Team"
                : effectiveTeamId
                  ? context?.teams.find((team) => team.id === effectiveTeamId)?.name ?? "Team"
                  : "Gesamte Aktion"}
            </span>
            <button
              type="button"
              onClick={() => void load(null, false)}
              disabled={!online || loadState !== "idle" || !context?.accessRole}
            >
              Aktualisieren
            </button>
          </div>

          {loadState === "loading" && sessions.length === 0 ? (
            <div className="field-sessions-loading" role="status">Einsätze werden geladen ...</div>
          ) : (
            <FieldSessionHistory items={sessions} />
          )}

          {nextCursor ? (
            <button
              className="field-sessions-more"
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
