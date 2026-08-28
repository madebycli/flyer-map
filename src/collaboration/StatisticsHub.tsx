import { useCallback, useEffect, useState } from "react";
import { CampaignApiError } from "../data/campaignApi.ts";
import { fetchCampaignStatistics } from "../data/statisticsApi.ts";
import type {
  CampaignStatistics,
  StatisticsProgress,
  StatisticsSessionTotals,
} from "../domain/statistics.ts";
import type { PlatformAppContext } from "../platform/platformContract.ts";
import "./statistics-hub.css";

type Props = {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
  onOpenSessions?: () => void;
};

type LoadState = "idle" | "loading";

function errorMessage(error: unknown) {
  if (error instanceof CampaignApiError) {
    if (error.code === "statistics_schema_unavailable") {
      return "Stats sind serverseitig vorbereitet, aber Migration 0007 ist noch nicht ausgerollt.";
    }
    if (error.status === 401) return "Für Stats fehlt ein gültiger Zugriff.";
    if (error.status === 403) return "Diese Stats liegen außerhalb deines Zugriffs.";
    if (error.code === "network_error") return "Stats sind gerade nicht erreichbar.";
    return error.message;
  }
  return "Stats konnten nicht geladen werden.";
}

function percentLabel(progress: StatisticsProgress) {
  if (progress.total === 0) return "Noch keine Aufgaben";
  return `${progress.completed} / ${progress.total} · ${Math.round(progress.percentCompleted ?? 0)} %`;
}

function denominatorLabel(denominator: StatisticsProgress["denominator"]) {
  return denominator === "street-tasks" ? "Straßen-Aufgaben" : "Haus-Aufgaben";
}

function ProgressBlock({ id, title, progress }: { id: string; title: string; progress: StatisticsProgress }) {
  const percent = progress.percentCompleted === null ? null : Math.max(0, Math.min(100, progress.percentCompleted));
  return (
    <section className="statistics-progress" aria-labelledby={id}>
      <div className="statistics-progress-heading">
        <span id={id}>{title}</span>
        <strong>{percentLabel(progress)}</strong>
      </div>
      <div
        className="statistics-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? `Keine ${denominatorLabel(progress.denominator)}` : percentLabel(progress)}
      >
        <span style={{ width: `${percent ?? 0}%` }} />
      </div>
      <dl className="statistics-progress-details">
        <div><dt>Offen</dt><dd>{progress.open}</dd></div>
        <div><dt>Später</dt><dd>{progress.later}</dd></div>
        <div><dt>Nicht zustellbar</dt><dd>{progress.notDeliverable}</dd></div>
        <div><dt>Restlich</dt><dd>{progress.remaining}</dd></div>
      </dl>
    </section>
  );
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "–";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} Std. ${rest} Min.` : `${rest} Min.`;
}

function formatDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function sessionTitle(session: { status: string; endReason: string | null }) {
  if (session.status === "active") return "Einsatz läuft";
  if (session.endReason === "group-expired") return "Einsatz automatisch beendet";
  return "Einsatz abgeschlossen";
}

function SessionTotals({ title, totals }: { title: string; totals: StatisticsSessionTotals }) {
  return (
    <section className="statistics-card">
      <div className="statistics-card-heading">
        <span>Einsätze</span>
        <strong>{title}</strong>
      </div>
      <dl className="statistics-metric-grid">
        <div><dt>Einsätze</dt><dd>{totals.outings}</dd></div>
        <div><dt>Abgeschlossen</dt><dd>{totals.closedOutings}</dd></div>
        <div><dt>Gesamtdauer</dt><dd>{formatDuration(totals.totalDurationSeconds)}</dd></div>
        <div><dt>Teilnehmer-Summen</dt><dd>{totals.participantCountTotal}</dd></div>
        <div><dt>Angaben vorhanden</dt><dd>{totals.knownParticipantSessions}</dd></div>
        <div><dt>Personenzeit</dt><dd>{formatDuration(totals.totalPersonSeconds)}</dd></div>
        <div><dt>Betroffene Aufgaben</dt><dd>{totals.affectedTaskCount}</dd></div>
      </dl>
      <p className="statistics-card-caption">
        Teilnehmer-Summen zählen Angaben pro Einsatz und sind keine eindeutigen Personen.
      </p>
    </section>
  );
}

function AreaRows({ data }: { data: CampaignStatistics }) {
  if (data.areas.length === 0) return null;
  return (
    <section className="statistics-card">
      <div className="statistics-card-heading">
        <span>Aufschlüsselung</span>
        <strong>Gebiete</strong>
      </div>
      <div className="statistics-area-list">
        {data.areas.map((area) => (
          <article key={area.areaId}>
            <div className="statistics-row-heading">
              <strong>{area.name}</strong>
              <span>{area.teamName}</span>
            </div>
            <ProgressBlock id={`statistics-area-streets-${area.areaId}`} title="Straßen" progress={area.streets} />
            {area.houses ? (
              <ProgressBlock id={`statistics-area-houses-${area.areaId}`} title="Häuser" progress={area.houses} />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function StatisticsHub({ context, online, onClose, onOpenSessions }: Props) {
  const campaignId = context?.campaignId ?? null;
  const canFilterTeams =
    (context?.accessRole === "admin" || context?.accessRole === "viewer") &&
    (context?.teams.length ?? 0) > 1;
  const [teamFilter, setTeamFilter] = useState("all");
  const [statistics, setStatistics] = useState<CampaignStatistics | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const effectiveTeamId = canFilterTeams && teamFilter !== "all" ? teamFilter : null;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!campaignId || !context?.accessRole || !online) return;
      setLoadState("loading");
      setError(null);
      try {
        const next = await fetchCampaignStatistics(campaignId, {
          teamId: effectiveTeamId,
          signal,
        });
        if (!signal?.aborted) setStatistics(next);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!signal?.aborted) setError(errorMessage(loadError));
      } finally {
        if (!signal?.aborted) setLoadState("idle");
      }
    },
    [campaignId, context?.accessRole, effectiveTeamId, online],
  );

  useEffect(() => {
    if (!online || !campaignId || !context?.accessRole) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [campaignId, context?.accessRole, effectiveTeamId, load, online]);

  const scopeLabel = statistics
    ? statistics.scope.kind === "campaign"
      ? "Gesamte Aktion"
      : statistics.scope.kind === "field-group"
        ? "Deine temporäre Gruppe"
        : context?.teams.find((team) => team.id === statistics.scope.teamId)?.name ?? "Mein Team"
    : "Stats";

  return (
    <div className="statistics-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="statistics-hub"
        role="dialog"
        aria-modal="true"
        aria-labelledby="statistics-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="statistics-handle" aria-hidden="true" />
        <header className="statistics-header">
          <div>
            <span>Überblick</span>
            <strong id="statistics-title">Stats</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Stats schließen">×</button>
        </header>

        <div className="statistics-scroll">
          {!online ? (
            <div className="statistics-notice is-offline" role="status">
              {statistics
                ? "Offline: bereits geladene Stats bleiben sichtbar. Neue Stats benötigen Internet."
                : "Offline: Stats wurden noch nicht geladen. Neue Stats benötigen Internet."}
            </div>
          ) : null}

          {!context?.accessRole ? (
            <div className="statistics-notice is-error" role="alert">
              Für Stats ist ein gültiger Zugriff erforderlich.
            </div>
          ) : null}

          {error ? (
            <div className="statistics-notice is-error" role="alert">
              <span>{error}</span>
              {online ? (
                <button type="button" onClick={() => void load()} disabled={loadState === "loading"}>
                  Erneut laden
                </button>
              ) : null}
            </div>
          ) : null}

          {canFilterTeams ? (
            <label className="statistics-filter">
              <span>Team</span>
              <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                <option value="all">Alle Teams</option>
                {(context?.teams ?? []).map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="statistics-toolbar">
            <span>{scopeLabel}</span>
            <div>
              {onOpenSessions ? (
                <button type="button" onClick={onOpenSessions}>Einsätze</button>
              ) : null}
              <button
                type="button"
                onClick={() => void load()}
                disabled={!online || loadState === "loading" || !context?.accessRole}
              >
                Aktualisieren
              </button>
            </div>
          </div>

          {loadState === "loading" && !statistics ? (
            <div className="statistics-loading" role="status">Stats werden geladen ...</div>
          ) : null}

          {statistics && statistics.teams.length === 0 && statistics.areas.length === 0 ? (
            <div className="statistics-empty" role="status">Noch keine Aufgaben oder Einsätze vorhanden.</div>
          ) : null}

          {statistics ? (
            <>
              {statistics.campaign ? (
                <section className="statistics-card">
                  <div className="statistics-card-heading">
                    <span>Fortschritt</span>
                    <strong>Gesamte Aktion</strong>
                  </div>
                  <div className="statistics-progress-grid">
                    <ProgressBlock id="statistics-campaign-streets" title="Straßen" progress={statistics.campaign.streets} />
                    {statistics.campaign.houses ? (
                      <ProgressBlock id="statistics-campaign-houses" title="Häuser" progress={statistics.campaign.houses} />
                    ) : null}
                  </div>
                </section>
              ) : null}

              {!statistics.housesAvailable ? (
                <div className="statistics-notice" role="status">
                  Haus-Aufgaben werden erst angezeigt, sobald ihre additive Datenbankmigration ausgerollt ist.
                </div>
              ) : null}

              {statistics.teams.length > 0 ? (
                <section className="statistics-card">
                  <div className="statistics-card-heading">
                    <span>Fortschritt</span>
                    <strong>{statistics.scope.kind === "campaign" ? "Teams" : "Arbeitsbereich"}</strong>
                  </div>
                  <div className="statistics-team-list">
                    {statistics.teams.map((team) => (
                      <article key={team.teamId}>
                        <div className="statistics-row-heading">
                          <strong><span className="statistics-team-dot" style={{ backgroundColor: team.color }} aria-hidden="true" />{team.name}</strong>
                          <span>{team.areaCount} Gebiete</span>
                        </div>
                        <div className="statistics-progress-grid">
                          <ProgressBlock id={`statistics-team-streets-${team.teamId}`} title="Straßen" progress={team.streets} />
                          {team.houses ? (
                            <ProgressBlock id={`statistics-team-houses-${team.teamId}`} title="Häuser" progress={team.houses} />
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              <AreaRows data={statistics} />

              <div className="statistics-two-column">
                <SessionTotals title="Flyer-Verteilung" totals={statistics.sessions.distribution} />
                <SessionTotals title="Kleider-Sammlung" totals={statistics.sessions.collection} />
              </div>

              <section className="statistics-card">
                <div className="statistics-card-heading">
                  <span>Verlauf</span>
                  <strong>Statusänderungen</strong>
                </div>
                {statistics.progressOverTime.length === 0 ? (
                  <p className="statistics-card-caption">Im letzten Zeitraum sind noch keine Statusänderungen erfasst.</p>
                ) : (
                  <ul className="statistics-time-list">
                    {statistics.progressOverTime.map((bucket) => (
                      <li key={bucket.date}>
                        <strong>{bucket.date}</strong>
                        <span>{bucket.statusChanges} Änderungen · {bucket.completedTransitions} neu erledigt</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="statistics-card">
                <div className="statistics-card-heading">
                  <span>Historie</span>
                  <strong>Letzte Einsätze</strong>
                </div>
                {statistics.recentSessions.length === 0 ? (
                  <p className="statistics-card-caption">Noch keine Einsätze vorhanden.</p>
                ) : (
                  <ul className="statistics-session-list">
                    {statistics.recentSessions.map((session) => (
                      <li key={session.id}>
                        <div>
                          <strong>{sessionTitle(session)}</strong>
                          <span>{session.teamName} · {session.mode === "distribution" ? "Flyer-Verteilung" : "Kleider-Sammlung"}</span>
                        </div>
                        <div>
                          <span>{formatDate(session.startedAt)}</span>
                          <span>{formatDuration(session.durationSeconds)} · {session.participantCount ?? "–"} Teilnehmer</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {statistics.recentSessionsTruncated ? (
                  <p className="statistics-card-caption">Weitere Einsätze stehen in der vollständigen Einsatzhistorie.</p>
                ) : null}
              </section>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
