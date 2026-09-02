-- FC5.2 Pickup comments.
-- Forward migration only. Historical migrations 0007/0008 remain immutable.
-- SQLite cannot widen CHECK constraints in place, so the existing durable tables
-- are rebuilt with identical columns/data plus the new allowed enum values.
-- Prepared only: do not apply remotely as part of application code.
PRAGMA foreign_keys = ON;

CREATE TABLE comments_fc5_next (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (
    target_type IN ('campaign', 'area', 'street-task', 'house-task', 'pickup-task')
  ),
  target_id TEXT NOT NULL,
  team_id TEXT,
  author_kind TEXT NOT NULL CHECK (
    author_kind IN ('campaign-grant', 'temporary-member', 'collection-collector', 'unknown')
  ),
  author_ref TEXT,
  body TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_operation_id TEXT,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT,
  CHECK (
    (
      (target_type IN ('campaign', 'pickup-task') AND team_id IS NULL) OR
      (target_type IN ('area', 'street-task', 'house-task') AND team_id IS NOT NULL)
    ) AND
    ((deleted_at IS NULL AND body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 2000) OR
      (deleted_at IS NOT NULL AND body IS NULL))
  )
);

INSERT INTO comments_fc5_next (
  id, campaign_id, target_type, target_id, team_id,
  author_kind, author_ref, body, created_at, updated_at,
  deleted_at, version, last_operation_id
)
SELECT
  id, campaign_id, target_type, target_id, team_id,
  author_kind, author_ref, body, created_at, updated_at,
  deleted_at, version, last_operation_id
FROM comments;

DROP TABLE comments;
ALTER TABLE comments_fc5_next RENAME TO comments;

CREATE INDEX idx_comments_context
  ON comments(campaign_id, target_type, target_id, created_at DESC, id DESC);
CREATE INDEX idx_comments_scope
  ON comments(campaign_id, team_id, created_at DESC, id DESC);

CREATE TABLE domain_events_fc5_next (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT,
  field_session_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (
    actor_kind IN (
      'campaign-grant',
      'temporary-member',
      'collection-collector',
      'organization-account',
      'system',
      'unknown'
    )
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

INSERT INTO domain_events_fc5_next (
  id, campaign_id, team_id, field_session_id, entity_type, entity_id,
  event_type, occurred_at, actor_kind, actor_ref, payload_version,
  payload_json, dedupe_key, created_at
)
SELECT
  id, campaign_id, team_id, field_session_id, entity_type, entity_id,
  event_type, occurred_at, actor_kind, actor_ref, payload_version,
  payload_json, dedupe_key, created_at
FROM domain_events;

-- These two 0007 triggers write to domain_events. Leaving them installed while the
-- table is briefly absent makes SQLite reparse an invalid schema during RENAME.
-- Drop only the affected triggers, then recreate their historical behavior unchanged.
DROP TRIGGER IF EXISTS trg_field_group_close_history;
DROP TRIGGER IF EXISTS trg_field_group_expiry_history;

DROP TABLE domain_events;
ALTER TABLE domain_events_fc5_next RENAME TO domain_events;

CREATE INDEX idx_domain_events_campaign_time
  ON domain_events(campaign_id, occurred_at DESC, id DESC);
CREATE INDEX idx_domain_events_session_time
  ON domain_events(field_session_id, occurred_at, id);
CREATE INDEX idx_domain_events_entity
  ON domain_events(campaign_id, entity_type, entity_id, occurred_at);

CREATE TRIGGER trg_field_group_close_history
AFTER UPDATE OF state ON field_groups
WHEN OLD.state = 'active' AND NEW.state = 'closed'
BEGIN
  UPDATE field_sessions
  SET ended_at = NEW.closed_at,
      end_reason = 'manual-close',
      duration_seconds = MAX(
        0,
        CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)
      ),
      participant_count = NEW.participant_count,
      person_seconds = MAX(
        0,
        CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)
      ) * NEW.participant_count,
      status = 'closed',
      updated_at = NEW.closed_at
  WHERE campaign_id = NEW.campaign_id
    AND field_group_id = NEW.id
    AND status = 'active';

  INSERT OR IGNORE INTO field_sessions (
    id,
    campaign_id,
    team_id,
    field_group_id,
    mode,
    started_at,
    ended_at,
    end_reason,
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
    'manual-close',
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
    NEW.created_at,
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
    'domain_event_field_session_ended_' || NEW.id,
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
    'field-session.ended:field_session_group_' || NEW.id,
    NEW.closed_at
  );
END;

CREATE TRIGGER trg_field_group_expiry_history
AFTER UPDATE OF state ON field_groups
WHEN OLD.state = 'active' AND NEW.state = 'expired'
BEGIN
  UPDATE field_sessions
  SET ended_at = NEW.closed_at,
      end_reason = 'group-expired',
      duration_seconds = MAX(
        0,
        CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)
      ),
      participant_count = NEW.participant_count,
      person_seconds = CASE
        WHEN NEW.participant_count IS NULL THEN NULL
        ELSE MAX(
          0,
          CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)
        ) * NEW.participant_count
      END,
      status = 'closed',
      updated_at = NEW.closed_at
  WHERE campaign_id = NEW.campaign_id
    AND field_group_id = NEW.id
    AND status = 'active';

  INSERT OR IGNORE INTO field_sessions (
    id,
    campaign_id,
    team_id,
    field_group_id,
    mode,
    started_at,
    ended_at,
    end_reason,
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
    'group-expired',
    MAX(
      0,
      CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', NEW.created_at) AS INTEGER)
    ),
    NEW.participant_count,
    CASE
      WHEN NEW.participant_count IS NULL THEN NULL
      ELSE MAX(
        0,
        CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', NEW.created_at) AS INTEGER)
      ) * NEW.participant_count
    END,
    NULL,
    'closed',
    NEW.created_at,
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
    'domain_event_field_session_ended_' || NEW.id,
    NEW.campaign_id,
    NEW.team_id,
    'field_session_group_' || NEW.id,
    'field-session',
    'field_session_group_' || NEW.id,
    'field_session.expired',
    NEW.closed_at,
    'system',
    NULL,
    1,
    '{}',
    'field-session.ended:field_session_group_' || NEW.id,
    NEW.closed_at
  );
END;
