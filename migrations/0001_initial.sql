-- Initial schema proposal. Apply only after the D1 database has been created.
PRAGMA foreign_keys = ON;

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('street')),
  label TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'later', 'not-deliverable')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_teams_campaign ON teams(campaign_id);
CREATE INDEX idx_areas_campaign ON areas(campaign_id);
CREATE INDEX idx_areas_team ON areas(team_id);
CREATE INDEX idx_tasks_area ON tasks(area_id);
CREATE INDEX idx_tasks_campaign_status ON tasks(campaign_id, status);
