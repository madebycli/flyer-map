-- Additive candidate migration. Never applied automatically to Production.
-- Retention stays disabled until a floor is explicitly advanced by a future,
-- guarded compaction path. The floor is the oldest checkpoint from which an
-- incremental pull is still safe. Feed rows at or below that checkpoint may
-- only be removed in the same guarded operation that advances this value.
PRAGMA foreign_keys = ON;

CREATE TABLE campaign_sync_retention (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  collection_name TEXT NOT NULL CHECK (
    collection_name IN ('campaigns', 'teams', 'areas', 'streetTasks', 'houseTasks')
  ),
  min_checkpoint_seq INTEGER NOT NULL CHECK (min_checkpoint_seq >= 0),
  epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, collection_name)
);
