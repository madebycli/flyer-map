-- M6 durable House Tasks.
-- This migration is intentionally additive. Existing Street Tasks remain in the
-- established `tasks` table. Do not apply remotely as part of application code.
PRAGMA foreign_keys = ON;

CREATE TABLE house_tasks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL,
  parent_street_task_id TEXT,
  label TEXT NOT NULL,
  geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
  source_json TEXT CHECK (source_json IS NULL OR json_valid(source_json)),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'later', 'not-deliverable')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES areas(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_street_task_id)
    REFERENCES tasks(id) ON DELETE SET NULL,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE INDEX idx_house_tasks_campaign ON house_tasks(campaign_id);
CREATE INDEX idx_house_tasks_area ON house_tasks(area_id);
CREATE INDEX idx_house_tasks_parent_street ON house_tasks(parent_street_task_id);
CREATE INDEX idx_house_tasks_campaign_status ON house_tasks(campaign_id, status);
