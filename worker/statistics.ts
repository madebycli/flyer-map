import type {
  CampaignStatistics,
  StatisticsArea,
  StatisticsProgress,
  StatisticsProgressBucket,
  StatisticsRecentSession,
  StatisticsSessionMode,
  StatisticsSessionTotals,
  StatisticsTeam,
} from "../src/domain/statistics.ts";
import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

const RECENT_SESSION_LIMIT = 20;
const PROGRESS_HISTORY_DAYS = 90;

type StatisticsRoute = { campaignId: string };
type StatisticsScope = {
  kind: "campaign" | "team" | "field-group";
  teamId: string | null;
  groupId: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  color: string;
};

type AreaRow = {
  id: string;
  team_id: string;
  name: string;
};

type StatusRow = {
  area_id: string;
  total: number;
  completed: number;
  open: number;
  later: number;
  not_deliverable: number;
};

type SessionTotalsRow = {
  mode: StatisticsSessionMode;
  outings: number;
  active_outings: number;
  closed_outings: number;
  total_duration_seconds: number | null;
  known_participant_sessions: number;
  participant_count_total: number | null;
  total_person_seconds: number | null;
};

type SessionAffectedRow = {
  mode: StatisticsSessionMode;
  affected_task_count: number;
};

type RecentSessionRow = {
  id: string;
  team_id: string;
  team_name: string;
  mode: StatisticsSessionMode;
  started_at: string;
  ended_at: string | null;
  end_reason: "manual-close" | "group-expired" | null;
  duration_seconds: number | null;
  participant_count: number | null;
  person_seconds: number | null;
  affected_task_count: number;
  status: "active" | "closed";
};

type ProgressBucketRow = {
  date: string;
  status_changes: number;
  completed_transitions: number | null;
};

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

function errorResponse(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

function validSelector(value: string) {
  return /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

export function parseStatisticsRoute(pathname: string): StatisticsRoute | null {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/stats$/u);
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    return campaignId ? { campaignId } : null;
  } catch {
    return null;
  }
}

function nonNegativeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function nullableNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value);
}

function emptyProgress(denominator: StatisticsProgress["denominator"]): StatisticsProgress {
  return {
    denominator,
    total: 0,
    completed: 0,
    open: 0,
    later: 0,
    notDeliverable: 0,
    remaining: 0,
    percentCompleted: null,
  };
}

function progressFromRow(
  row: StatusRow | undefined,
  denominator: StatisticsProgress["denominator"],
): StatisticsProgress {
  const total = nonNegativeInteger(row?.total);
  const completed = Math.min(total, nonNegativeInteger(row?.completed));
  const open = nonNegativeInteger(row?.open);
  const later = nonNegativeInteger(row?.later);
  const notDeliverable = nonNegativeInteger(row?.not_deliverable);
  return {
    denominator,
    total,
    completed,
    open,
    later,
    notDeliverable,
    remaining: Math.max(0, total - completed),
    percentCompleted: total === 0 ? null : (completed / total) * 100,
  };
}

function addProgress(
  target: StatisticsProgress,
  source: StatisticsProgress,
): StatisticsProgress {
  const total = target.total + source.total;
  const completed = target.completed + source.completed;
  return {
    ...target,
    total,
    completed,
    open: target.open + source.open,
    later: target.later + source.later,
    notDeliverable: target.notDeliverable + source.notDeliverable,
    remaining: Math.max(0, total - completed),
    percentCompleted: total === 0 ? null : (completed / total) * 100,
  };
}

function progressForAreas(
  areas: readonly { streets: StatisticsProgress; houses: StatisticsProgress | null }[],
  denominator: "streets" | "houses",
) {
  const result = emptyProgress(denominator === "streets" ? "street-tasks" : "house-tasks");
  return areas.reduce(
    (summary, area) => {
      const progress = denominator === "streets" ? area.streets : area.houses;
      return progress ? addProgress(summary, progress) : summary;
    },
    result,
  );
}

async function hasColumns(
  db: D1DatabaseLike,
  table: "field_sessions" | "domain_events" | "house_tasks",
  required: readonly string[],
) {
  try {
    const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const columns = new Set(result.results.map((column) => column.name));
    return required.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

export async function hasStatisticsSchema(db: D1DatabaseLike) {
  const [sessions, events] = await Promise.all([
    hasColumns(db, "field_sessions", [
      "id",
      "campaign_id",
      "team_id",
      "field_group_id",
      "mode",
      "started_at",
      "ended_at",
      "end_reason",
      "duration_seconds",
      "participant_count",
      "person_seconds",
      "status",
    ]),
    hasColumns(db, "domain_events", [
      "id",
      "campaign_id",
      "team_id",
      "field_session_id",
      "event_type",
      "occurred_at",
      "payload_json",
    ]),
  ]);
  return sessions && events;
}

async function hasHouseTaskSchema(db: D1DatabaseLike) {
  return hasColumns(db, "house_tasks", [
    "id",
    "campaign_id",
    "area_id",
    "status",
  ]);
}

function scopeForAccess(
  access: AccessContext,
  requestedTeamId: string | null,
): { ok: true; scope: StatisticsScope } | { ok: false; response: Response } {
  if (access.role === "field-group-member") {
    if (!access.teamId || !access.groupId || !access.membershipId) {
      return {
        ok: false,
        response: errorResponse(
          403,
          "statistics_scope_missing",
          "Temporärer Stats-Scope ist nicht vollständig autorisiert.",
        ),
      };
    }
    if (requestedTeamId && requestedTeamId !== access.teamId) {
      return {
        ok: false,
        response: errorResponse(
          403,
          "statistics_scope_forbidden",
          "Dieses Team liegt außerhalb deines Zugriffs.",
        ),
      };
    }
    return {
      ok: true,
      scope: { kind: "field-group", teamId: access.teamId, groupId: access.groupId },
    };
  }

  if (access.role === "team-editor") {
    if (!access.teamId) {
      return {
        ok: false,
        response: errorResponse(403, "statistics_scope_missing", "Team-Scope fehlt."),
      };
    }
    if (requestedTeamId && requestedTeamId !== access.teamId) {
      return {
        ok: false,
        response: errorResponse(
          403,
          "statistics_scope_forbidden",
          "Dieses Team liegt außerhalb deines Zugriffs.",
        ),
      };
    }
    return {
      ok: true,
      scope: { kind: "team", teamId: access.teamId, groupId: null },
    };
  }

  return {
    ok: true,
    scope: {
      kind: requestedTeamId ? "team" : "campaign",
      teamId: requestedTeamId,
      groupId: null,
    },
  };
}

function teamPredicate(alias: string, scope: StatisticsScope) {
  return scope.teamId ? { sql: ` AND ${alias}.team_id = ?`, bindings: [scope.teamId] } : { sql: "", bindings: [] };
}

function teamRowPredicate(alias: string, scope: StatisticsScope) {
  return scope.teamId ? { sql: ` AND ${alias}.id = ?`, bindings: [scope.teamId] } : { sql: "", bindings: [] };
}

function sessionPredicate(alias: string, scope: StatisticsScope) {
  const team = teamPredicate(alias, scope);
  if (!scope.groupId) return team;
  return {
    sql: `${team.sql} AND ${alias}.field_group_id = ?`,
    bindings: [...team.bindings, scope.groupId],
  };
}

function eventPredicate(alias: string, campaignId: string, scope: StatisticsScope) {
  if (!scope.groupId) return teamPredicate(alias, scope);
  return {
    sql: ` AND ${alias}.field_session_id IN (
      SELECT scoped_session.id
      FROM field_sessions scoped_session
      WHERE scoped_session.campaign_id = ?
        AND scoped_session.team_id = ?
        AND scoped_session.field_group_id = ?
    )`,
    bindings: [campaignId, scope.teamId, scope.groupId],
  };
}

function sessionTotals(mode: StatisticsSessionMode): StatisticsSessionTotals {
  return {
    mode,
    outings: 0,
    activeOutings: 0,
    closedOutings: 0,
    totalDurationSeconds: 0,
    knownParticipantSessions: 0,
    participantCountTotal: 0,
    totalPersonSeconds: 0,
    affectedTaskCount: 0,
  };
}

function sumSessionRows(
  totals: Record<StatisticsSessionMode, StatisticsSessionTotals>,
  rows: SessionTotalsRow[],
) {
  for (const row of rows) {
    const target = totals[row.mode];
    if (!target) continue;
    target.outings = nonNegativeInteger(row.outings);
    target.activeOutings = nonNegativeInteger(row.active_outings);
    target.closedOutings = nonNegativeInteger(row.closed_outings);
    target.totalDurationSeconds = nonNegativeInteger(row.total_duration_seconds);
    target.knownParticipantSessions = nonNegativeInteger(row.known_participant_sessions);
    target.participantCountTotal = nonNegativeInteger(row.participant_count_total);
    target.totalPersonSeconds = nonNegativeInteger(row.total_person_seconds);
  }
}

function addAffectedTaskCounts(
  totals: Record<StatisticsSessionMode, StatisticsSessionTotals>,
  rows: SessionAffectedRow[],
) {
  for (const row of rows) {
    if (totals[row.mode]) totals[row.mode].affectedTaskCount = nonNegativeInteger(row.affected_task_count);
  }
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table.*(?:field_sessions|domain_events|house_tasks)|(?:field_sessions|domain_events|house_tasks).*does not exist|no such column.*(?:field_sessions|domain_events|house_tasks)/iu.test(
    message,
  );
}

export async function handleStatisticsApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = parseStatisticsRoute(new URL(request.url).pathname);
  if (!route) return null;
  if (request.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Für Stats ist nur GET erlaubt.");
  }

  try {
    const access = await resolveAccess(db, request, route.campaignId);
    if (!access) return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");

    if (!(await hasStatisticsSchema(db))) {
      return errorResponse(
        503,
        "statistics_schema_unavailable",
        "Stats sind vorbereitet, aber die Field-Session-Datenbankmigration ist noch nicht angewendet.",
      );
    }

    const url = new URL(request.url);
    const rawTeamId = url.searchParams.get("team");
    const requestedTeamId = rawTeamId === null || rawTeamId === "" ? null : rawTeamId;
    if (requestedTeamId && !validSelector(requestedTeamId)) {
      return errorResponse(400, "invalid_team_filter", "Team-Filter ist ungültig.");
    }
    const scopeResult = scopeForAccess(access, requestedTeamId);
    if (!scopeResult.ok) return scopeResult.response;
    const scope = scopeResult.scope;
    const teamScope = teamRowPredicate("t", scope);
    const areaScope = teamPredicate("a", scope);
    const taskScope = teamPredicate("a", scope);
    const sessionScope = sessionPredicate("s", scope);
    const eventScope = eventPredicate("e", route.campaignId, scope);

    const [teamResult, areaResult, streetResult, housesAvailable] = await Promise.all([
      db
        .prepare(
          `SELECT t.id, t.name, t.color
           FROM teams t
           WHERE t.campaign_id = ?${teamScope.sql}
           ORDER BY t.created_at, t.id`,
        )
        .bind(route.campaignId, ...teamScope.bindings)
        .all<TeamRow>(),
      db
        .prepare(
          `SELECT a.id, a.team_id, a.name
           FROM areas a
           WHERE a.campaign_id = ?${areaScope.sql}
           ORDER BY a.created_at, a.id`,
        )
        .bind(route.campaignId, ...areaScope.bindings)
        .all<AreaRow>(),
      db
        .prepare(
          `SELECT
             t.area_id,
             COUNT(*) AS total,
             SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN t.status = 'later' THEN 1 ELSE 0 END) AS later,
             SUM(CASE WHEN t.status = 'not-deliverable' THEN 1 ELSE 0 END) AS not_deliverable
           FROM tasks t
           JOIN areas a ON a.id = t.area_id AND a.campaign_id = t.campaign_id
           WHERE t.campaign_id = ?
             AND t.task_type = 'street'${taskScope.sql}
           GROUP BY t.area_id`,
        )
        .bind(route.campaignId, ...taskScope.bindings)
        .all<StatusRow>(),
      hasHouseTaskSchema(db),
    ]);

    const houseResult = housesAvailable
      ? await db
          .prepare(
            `SELECT
               h.area_id,
               COUNT(*) AS total,
               SUM(CASE WHEN h.status = 'completed' THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN h.status = 'open' THEN 1 ELSE 0 END) AS open,
               SUM(CASE WHEN h.status = 'later' THEN 1 ELSE 0 END) AS later,
               SUM(CASE WHEN h.status = 'not-deliverable' THEN 1 ELSE 0 END) AS not_deliverable
             FROM house_tasks h
             JOIN areas a ON a.id = h.area_id AND a.campaign_id = h.campaign_id
             WHERE h.campaign_id = ?${teamPredicate("a", scope).sql}
             GROUP BY h.area_id`,
          )
          .bind(route.campaignId, ...teamPredicate("a", scope).bindings)
          .all<StatusRow>()
      : { results: [] as StatusRow[] };

    const areaStreetRows = new Map(streetResult.results.map((row) => [row.area_id, row]));
    const areaHouseRows = new Map(houseResult.results.map((row) => [row.area_id, row]));
    const teams = new Map(teamResult.results.map((team) => [team.id, team]));
    const areas: StatisticsArea[] = areaResult.results.map((area) => {
      const team = teams.get(area.team_id);
      return {
        areaId: area.id,
        teamId: area.team_id,
        name: area.name,
        teamName: team?.name ?? "Team",
        teamColor: team?.color ?? "#64748b",
        streets: progressFromRow(areaStreetRows.get(area.id), "street-tasks"),
        houses: housesAvailable
          ? progressFromRow(areaHouseRows.get(area.id), "house-tasks")
          : null,
      };
    });
    const teamRows: StatisticsTeam[] = teamResult.results.map((team) => {
      const teamAreas = areas.filter((area) => area.teamId === team.id);
      return {
        teamId: team.id,
        name: team.name,
        color: team.color,
        areaCount: teamAreas.length,
        streets: progressForAreas(teamAreas, "streets"),
        houses: housesAvailable ? progressForAreas(teamAreas, "houses") : null,
      };
    });

    const [sessionTotalsResult, sessionAffectedResult, recentSessionsResult, progressResult] =
      await Promise.all([
        db
          .prepare(
            `SELECT
               s.mode,
               COUNT(*) AS outings,
               SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) AS active_outings,
               SUM(CASE WHEN s.status = 'closed' THEN 1 ELSE 0 END) AS closed_outings,
               COALESCE(SUM(CASE WHEN s.duration_seconds IS NULL THEN 0 ELSE s.duration_seconds END), 0) AS total_duration_seconds,
               COUNT(s.participant_count) AS known_participant_sessions,
               COALESCE(SUM(CASE WHEN s.participant_count IS NULL THEN 0 ELSE s.participant_count END), 0) AS participant_count_total,
               COALESCE(SUM(CASE WHEN s.person_seconds IS NULL THEN 0 ELSE s.person_seconds END), 0) AS total_person_seconds
             FROM field_sessions s
             WHERE s.campaign_id = ?${sessionScope.sql}
             GROUP BY s.mode`,
          )
          .bind(route.campaignId, ...sessionScope.bindings)
          .all<SessionTotalsRow>(),
        db
          .prepare(
            `SELECT
               s.mode,
               COUNT(DISTINCT e.entity_type || '|' || e.entity_id) AS affected_task_count
             FROM field_sessions s
             LEFT JOIN domain_events e
               ON e.field_session_id = s.id
              AND e.event_type = 'task.status.changed'
             WHERE s.campaign_id = ?${sessionScope.sql}
             GROUP BY s.mode`,
          )
          .bind(route.campaignId, ...sessionScope.bindings)
          .all<SessionAffectedRow>(),
        db
          .prepare(
            `SELECT
               s.id,
               s.team_id,
               t.name AS team_name,
               s.mode,
               s.started_at,
               s.ended_at,
               s.end_reason,
               s.duration_seconds,
               s.participant_count,
               s.person_seconds,
               COUNT(DISTINCT CASE WHEN e.event_type = 'task.status.changed' THEN e.entity_type || '|' || e.entity_id END) AS affected_task_count,
               s.status
             FROM field_sessions s
             JOIN teams t ON t.id = s.team_id AND t.campaign_id = s.campaign_id
             LEFT JOIN domain_events e ON e.field_session_id = s.id
             WHERE s.campaign_id = ?${sessionScope.sql}
             GROUP BY s.id, s.team_id, t.name, s.mode, s.started_at, s.ended_at,
                      s.end_reason, s.duration_seconds, s.participant_count,
                      s.person_seconds, s.status
             ORDER BY s.started_at DESC, s.id DESC
             LIMIT ?`,
          )
          .bind(route.campaignId, ...sessionScope.bindings, RECENT_SESSION_LIMIT + 1)
          .all<RecentSessionRow>(),
        db
          .prepare(
            `SELECT
               substr(e.occurred_at, 1, 10) AS date,
               COUNT(*) AS status_changes,
               SUM(
                 CASE
                   WHEN json_valid(e.payload_json)
                    AND json_extract(e.payload_json, '$.newStatus') = 'completed'
                   THEN 1 ELSE 0
                 END
               ) AS completed_transitions
             FROM domain_events e
             WHERE e.campaign_id = ?
               AND e.event_type = 'task.status.changed'
               AND e.occurred_at >= ?${eventScope.sql}
             GROUP BY substr(e.occurred_at, 1, 10)
             ORDER BY date ASC
             LIMIT ?`,
          )
          .bind(
            route.campaignId,
            new Date(Date.now() - PROGRESS_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
            ...eventScope.bindings,
            PROGRESS_HISTORY_DAYS,
          )
          .all<ProgressBucketRow>(),
      ]);

    const totals = {
      distribution: sessionTotals("distribution"),
      collection: sessionTotals("collection"),
    } satisfies Record<StatisticsSessionMode, StatisticsSessionTotals>;
    sumSessionRows(totals, sessionTotalsResult.results);
    addAffectedTaskCounts(totals, sessionAffectedResult.results);

    const recentRows = recentSessionsResult.results;
    const recentSessions: StatisticsRecentSession[] = recentRows
      .slice(0, RECENT_SESSION_LIMIT)
      .map((row) => ({
        id: row.id,
        teamId: row.team_id,
        teamName: row.team_name,
        mode: row.mode,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        endReason: row.end_reason,
        durationSeconds: nullableNonNegativeInteger(row.duration_seconds),
        participantCount: nullableNonNegativeInteger(row.participant_count),
        personSeconds: nullableNonNegativeInteger(row.person_seconds),
        affectedTaskCount: nonNegativeInteger(row.affected_task_count),
        status: row.status,
      }));
    const campaignAreas = areas;
    const response: CampaignStatistics = {
      schemaVersion: 1,
      scope: { kind: scope.kind, teamId: scope.teamId },
      campaign:
        scope.kind === "campaign"
          ? {
              streets: progressForAreas(campaignAreas, "streets"),
              houses: housesAvailable ? progressForAreas(campaignAreas, "houses") : null,
            }
          : null,
      housesAvailable,
      teams: teamRows,
      areas,
      sessions: totals,
      recentSessions,
      recentSessionsTruncated: recentRows.length > RECENT_SESSION_LIMIT,
      progressOverTime: progressResult.results.map(
        (row): StatisticsProgressBucket => ({
          date: row.date,
          statusChanges: nonNegativeInteger(row.status_changes),
          completedTransitions: nonNegativeInteger(row.completed_transitions),
        }),
      ),
    };
    return json(response);
  } catch (error) {
    if (schemaUnavailable(error)) {
      return errorResponse(
        503,
        "statistics_schema_unavailable",
        "Stats sind vorbereitet, aber die Field-Session-Datenbankmigration ist noch nicht angewendet.",
      );
    }
    return errorResponse(500, "statistics_failed", "Stats konnten nicht geladen werden.");
  }
}
