-- Initial M3 schema. Apply only after the production D1 database has been created.
-- This migration has not been bound/applied by the repository before M3, so it is
-- intentionally aligned to the first real shared-persistence implementation.
PRAGMA foreign_keys = ON;

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision >= 0),
  -- Internal optimistic-concurrency guard. Never exposed as campaign data.
  write_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campaign_id, color),
  UNIQUE (id, campaign_id)
);

CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('street')),
  label TEXT NOT NULL,
  geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'later', 'not-deliverable')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES areas(id, campaign_id) ON DELETE CASCADE,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE INDEX idx_teams_campaign ON teams(campaign_id);
CREATE INDEX idx_areas_campaign ON areas(campaign_id);
CREATE INDEX idx_areas_team ON areas(team_id);
CREATE INDEX idx_tasks_area ON tasks(area_id);
CREATE INDEX idx_tasks_campaign_status ON tasks(campaign_id, status);
