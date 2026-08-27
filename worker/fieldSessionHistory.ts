import type { D1DatabaseLike } from "./campaignRepository.ts";

const REQUIRED_FIELD_SESSION_COLUMNS = new Set([
  "id",
  "campaign_id",
  "team_id",
  "field_group_id",
  "started_at",
  "ended_at",
  "end_reason",
  "duration_seconds",
  "participant_count",
  "person_seconds",
  "status",
]);

const REQUIRED_DOMAIN_EVENT_COLUMNS = new Set([
  "id",
  "campaign_id",
  "field_session_id",
  "entity_type",
  "entity_id",
  "event_type",
  "dedupe_key",
]);

async function hasColumns(
  db: D1DatabaseLike,
  table: "field_sessions" | "domain_events",
  required: Set<string>,
) {
  try {
    const result = await db
      .prepare(`PRAGMA table_info(${table})`)
      .all<{ name: string }>();
    const columns = new Set(result.results.map((column) => column.name));
    return [...required].every((column) => columns.has(column));
  } catch {
    return false;
  }
}

export async function hasFieldSessionHistorySchema(db: D1DatabaseLike) {
  const [hasSessions, hasEvents] = await Promise.all([
    hasColumns(db, "field_sessions", REQUIRED_FIELD_SESSION_COLUMNS),
    hasColumns(db, "domain_events", REQUIRED_DOMAIN_EVENT_COLUMNS),
  ]);
  return hasSessions && hasEvents;
}
