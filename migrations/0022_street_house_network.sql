-- Additive, repository-only. Production migration requires a separate release.
PRAGMA foreign_keys = ON;
CREATE TABLE street_network_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  network_json TEXT NOT NULL CHECK(json_valid(network_json))
);
CREATE TABLE house_road_positions (
  house_id TEXT PRIMARY KEY REFERENCES house_tasks(id) ON DELETE CASCADE,
  position_json TEXT NOT NULL CHECK(json_valid(position_json))
);
CREATE TABLE street_network_jobs (
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
CREATE TABLE street_network_staging (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  kind TEXT NOT NULL,
  chunk_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(campaign_id,area_id,generation,kind,chunk_key),
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);
CREATE TABLE street_network_intents (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  intent_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(campaign_id,intent_id)
);
