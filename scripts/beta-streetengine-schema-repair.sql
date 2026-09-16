PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS area_task_preparations (
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
CREATE INDEX IF NOT EXISTS idx_area_task_preparations_campaign_status
  ON area_task_preparations(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_campaign_area_preparation_generation
  ON tasks(campaign_id, area_id, area_preparation_generation);
CREATE INDEX IF NOT EXISTS idx_house_tasks_campaign_area_preparation_generation
  ON house_tasks(campaign_id, area_id, area_preparation_generation);

CREATE TABLE IF NOT EXISTS street_network_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  network_json TEXT NOT NULL CHECK(json_valid(network_json))
);
CREATE TABLE IF NOT EXISTS house_road_positions (
  house_id TEXT PRIMARY KEY REFERENCES house_tasks(id) ON DELETE CASCADE,
  position_json TEXT NOT NULL CHECK(json_valid(position_json))
);
CREATE TABLE IF NOT EXISTS street_network_jobs (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  phase TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(campaign_id, area_id),
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS street_network_staging (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  kind TEXT NOT NULL,
  chunk_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(campaign_id,area_id,generation,kind,chunk_key),
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS street_network_intents (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  intent_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(campaign_id,intent_id)
);
