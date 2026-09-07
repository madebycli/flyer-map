-- RxDB HTTP replication change feed. Prepared locally only, never applied by application code.
PRAGMA foreign_keys = ON;

CREATE TABLE campaign_sync_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  collection_name TEXT NOT NULL CHECK (
    collection_name IN ('campaigns', 'teams', 'areas', 'streetTasks', 'houseTasks')
  ),
  document_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  -- Keeps Field Group pull filtering correct even after an Area/Task tombstone.
  scope_team_id TEXT,
  document_json TEXT NOT NULL CHECK (json_valid(document_json)) CHECK (length(document_json) <= 262144),
  changed_at TEXT NOT NULL
);

CREATE INDEX idx_campaign_sync_changes_campaign_collection_seq
  ON campaign_sync_changes(campaign_id, collection_name, seq);

CREATE INDEX idx_campaign_sync_changes_campaign_scope_collection_seq
  ON campaign_sync_changes(campaign_id, scope_team_id, collection_name, seq);
