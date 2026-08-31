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

DROP TABLE domain_events;
ALTER TABLE domain_events_fc5_next RENAME TO domain_events;

CREATE INDEX idx_domain_events_campaign_time
  ON domain_events(campaign_id, occurred_at DESC, id DESC);
CREATE INDEX idx_domain_events_session_time
  ON domain_events(field_session_id, occurred_at, id);
CREATE INDEX idx_domain_events_entity
  ON domain_events(campaign_id, entity_type, entity_id, occurred_at);
