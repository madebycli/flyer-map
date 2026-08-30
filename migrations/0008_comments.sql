-- FC2 durable context-bound comments.
-- Additive only. Prepare this migration locally; do not apply it remotely as part
-- of application code or a branch preview deployment.
PRAGMA foreign_keys = ON;

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('campaign', 'area', 'street-task', 'house-task', 'pickup-task')),
  target_id TEXT NOT NULL,
  team_id TEXT,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('campaign-grant', 'temporary-member', 'collection-collector', 'unknown')),
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
    (((target_type = 'campaign' OR target_type = 'pickup-task') AND team_id IS NULL) OR
      (target_type <> 'campaign' AND target_type <> 'pickup-task' AND team_id IS NOT NULL)) AND
    ((deleted_at IS NULL AND body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 2000) OR
      (deleted_at IS NOT NULL AND body IS NULL))
  )
);

CREATE INDEX idx_comments_context
  ON comments(campaign_id, target_type, target_id, created_at DESC, id DESC);
CREATE INDEX idx_comments_scope
  ON comments(campaign_id, team_id, created_at DESC, id DESC);
