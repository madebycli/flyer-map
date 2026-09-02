-- Server-prepared automatic Distribution Area work.
-- Prepared only: do not apply remotely from application code.
PRAGMA foreign_keys = ON;

CREATE TABLE area_task_preparations (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  geometry_hash TEXT NOT NULL,
  generation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  road_count INTEGER NOT NULL DEFAULT 0 CHECK (road_count >= 0),
  house_count INTEGER NOT NULL DEFAULT 0 CHECK (house_count >= 0),
  source_timestamp TEXT,
  started_at TEXT,
  ready_at TEXT,
  failed_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, area_id),
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES areas(id, campaign_id) ON DELETE CASCADE
);

CREATE INDEX idx_area_task_preparations_campaign_status
  ON area_task_preparations(campaign_id, status);

ALTER TABLE tasks
  ADD COLUMN area_preparation_generation TEXT;

ALTER TABLE house_tasks
  ADD COLUMN area_preparation_generation TEXT;

CREATE INDEX idx_tasks_campaign_area_preparation_generation
  ON tasks(campaign_id, area_id, area_preparation_generation);

CREATE INDEX idx_house_tasks_campaign_area_preparation_generation
  ON house_tasks(campaign_id, area_id, area_preparation_generation);
