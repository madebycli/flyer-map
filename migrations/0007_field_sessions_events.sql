-- ADR-0017 durable Field Sessions and minimized operational domain events.
-- Additive only. Do not apply remotely as part of application code.
PRAGMA foreign_keys = ON;

CREATE TABLE field_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  field_group_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('distribution', 'collection')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  participant_count INTEGER
    CHECK (participant_count IS NULL OR (participant_count >= 1 AND participant_count <= 500)),
  person_seconds INTEGER CHECK (person_seconds IS NULL OR person_seconds >= 0),
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, field_group_id),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (field_group_id, campaign_id)
    REFERENCES field_groups(id, campaign_id) ON DELETE CASCADE,
  CHECK (
    (status = 'active' AND ended_at IS NULL AND duration_seconds IS NULL AND person_seconds IS NULL) OR
    (status = 'closed' AND ended_at IS NOT NULL AND duration_seconds IS NOT NULL
      AND participant_count IS NOT NULL AND person_seconds IS NOT NULL)
  )
);

CREATE TABLE domain_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT,
  field_session_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (
    actor_kind IN ('campaign-grant', 'temporary-member', 'organization-account', 'system', 'unknown')
  ),
  actor_ref TEXT,
  payload_version INTEGER NOT NULL CHECK (payload_version >= 1),
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, dedupe_key),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (field_session_id)
    REFERENCES field_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_field_sessions_campaign_started
  ON field_sessions(campaign_id, started_at DESC, id DESC);
CREATE INDEX idx_field_sessions_team_started
  ON field_sessions(team_id, started_at DESC, id DESC);
CREATE INDEX idx_field_sessions_group
  ON field_sessions(field_group_id);
CREATE INDEX idx_domain_events_campaign_time
  ON domain_events(campaign_id, occurred_at DESC, id DESC);
CREATE INDEX idx_domain_events_session_time
  ON domain_events(field_session_id, occurred_at, id);
CREATE INDEX idx_domain_events_entity
  ON domain_events(campaign_id, entity_type, entity_id, occurred_at);

-- Backfill groups that may have been closed while FC1 was under development before
-- ADR-0017 was accepted. The application-owned group id gives the one-to-one session
-- a deterministic id and prevents duplicate history when the migration is retried in a
-- disposable/local database.
INSERT OR IGNORE INTO field_sessions (
  id,
  campaign_id,
  team_id,
  field_group_id,
  mode,
  started_at,
  ended_at,
  duration_seconds,
  participant_count,
  person_seconds,
  note,
  status,
  created_at,
  updated_at
)
SELECT
  'field_session_group_' || g.id,
  g.campaign_id,
  g.team_id,
  g.id,
  g.mode,
  g.created_at,
  g.closed_at,
  MAX(
    0,
    CAST(strftime('%s', g.closed_at) AS INTEGER) - CAST(strftime('%s', g.created_at) AS INTEGER)
  ),
  g.participant_count,
  MAX(
    0,
    CAST(strftime('%s', g.closed_at) AS INTEGER) - CAST(strftime('%s', g.created_at) AS INTEGER)
  ) * g.participant_count,
  NULL,
  'closed',
  g.closed_at,
  g.closed_at
FROM field_groups g
WHERE g.state = 'closed'
  AND g.closed_at IS NOT NULL
  AND g.participant_count IS NOT NULL;

INSERT OR IGNORE INTO domain_events (
  id,
  campaign_id,
  team_id,
  field_session_id,
  entity_type,
  entity_id,
  event_type,
  occurred_at,
  actor_kind,
  actor_ref,
  payload_version,
  payload_json,
  dedupe_key,
  created_at
)
SELECT
  'domain_event_field_session_closed_' || s.field_group_id,
  s.campaign_id,
  s.team_id,
  s.id,
  'field-session',
  s.id,
  'field_session.closed',
  s.ended_at,
  'unknown',
  NULL,
  1,
  '{}',
  'field-session.closed:' || s.id,
  s.ended_at
FROM field_sessions s
WHERE s.field_group_id IS NOT NULL
  AND s.status = 'closed'
  AND s.ended_at IS NOT NULL;

-- Keep Field Group close and its durable operational history in one SQLite transaction.
-- The existing Worker UPDATE remains the authoritative authorization boundary. The trigger
-- only reacts after an authorized active -> closed state transition has actually applied.
CREATE TRIGGER trg_field_group_close_history
AFTER UPDATE OF state ON field_groups
WHEN OLD.state = 'active' AND NEW.state = 'closed'
BEGIN
  INSERT OR IGNORE INTO field_sessions (
    id,
    campaign_id,
    team_id,
    field_group_id,
    mode,
    started_at,
    ended_at,
    duration_seconds,
    participant_count,
    person_seconds,
    note,
    status,
    created_at,
    updated_at
  )
  VALUES (
    'field_session_group_' || NEW.id,
    NEW.campaign_id,
    NEW.team_id,
    NEW.id,
    NEW.mode,
    NEW.created_at,
    NEW.closed_at,
    MAX(
      0,
      CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', NEW.created_at) AS INTEGER)
    ),
    NEW.participant_count,
    MAX(
      0,
      CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', NEW.created_at) AS INTEGER)
    ) * NEW.participant_count,
    NULL,
    'closed',
    NEW.closed_at,
    NEW.closed_at
  );

  INSERT OR IGNORE INTO domain_events (
    id,
    campaign_id,
    team_id,
    field_session_id,
    entity_type,
    entity_id,
    event_type,
    occurred_at,
    actor_kind,
    actor_ref,
    payload_version,
    payload_json,
    dedupe_key,
    created_at
  )
  VALUES (
    'domain_event_field_session_closed_' || NEW.id,
    NEW.campaign_id,
    NEW.team_id,
    'field_session_group_' || NEW.id,
    'field-session',
    'field_session_group_' || NEW.id,
    'field_session.closed',
    NEW.closed_at,
    'unknown',
    NULL,
    1,
    '{}',
    'field-session.closed:field_session_group_' || NEW.id,
    NEW.closed_at
  );
END;
