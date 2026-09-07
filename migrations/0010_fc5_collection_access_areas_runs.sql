-- FC5.1 First-Class Collection Access, Areas and Runs.
-- Prepared only. Apply through the reviewed deployment procedure after approval.

CREATE TABLE IF NOT EXISTS collection_access_links (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS collection_access_links_campaign_idx
  ON collection_access_links(campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_collectors (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  access_link_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (access_link_id) REFERENCES collection_access_links(id) ON DELETE CASCADE,
  UNIQUE (id, campaign_id)
);

CREATE INDEX IF NOT EXISTS collection_collectors_campaign_idx
  ON collection_collectors(campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_collector_sessions (
  id TEXT PRIMARY KEY,
  collector_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (collector_id) REFERENCES collection_collectors(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS collection_collector_sessions_lookup_idx
  ON collection_collector_sessions(session_hash, campaign_id, expires_at);

CREATE TABLE IF NOT EXISTS collection_main_areas (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE (id, campaign_id)
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  main_area_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'cancelled')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_by_collector_id TEXT NOT NULL,
  area_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (main_area_id, campaign_id)
    REFERENCES collection_main_areas(id, campaign_id),
  UNIQUE (id, campaign_id)
);

CREATE INDEX IF NOT EXISTS collection_runs_campaign_idx
  ON collection_runs(campaign_id, main_area_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS collection_areas (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  main_area_id TEXT NOT NULL,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  color TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'in-progress', 'completed', 'archived')),
  run_id TEXT,
  claimed_by_collector_id TEXT,
  claimed_by_label TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (main_area_id, campaign_id)
    REFERENCES collection_main_areas(id, campaign_id),
  FOREIGN KEY (run_id, campaign_id)
    REFERENCES collection_runs(id, campaign_id),
  UNIQUE (id, campaign_id)
);

CREATE INDEX IF NOT EXISTS collection_areas_campaign_idx
  ON collection_areas(campaign_id, main_area_id, status, created_at);

CREATE INDEX IF NOT EXISTS collection_areas_run_idx
  ON collection_areas(campaign_id, run_id, status);

CREATE TABLE IF NOT EXISTS collection_run_members (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  collector_id TEXT NOT NULL,
  label TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  FOREIGN KEY (run_id, campaign_id)
    REFERENCES collection_runs(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (collector_id, campaign_id)
    REFERENCES collection_collectors(id, campaign_id) ON DELETE CASCADE,
  UNIQUE (run_id, collector_id)
);

CREATE INDEX IF NOT EXISTS collection_run_members_run_idx
  ON collection_run_members(run_id, left_at, joined_at);

CREATE TABLE IF NOT EXISTS collection_area_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  run_id TEXT,
  collector_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('claim', 'release', 'complete', 'force-release', 'archive')),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES collection_areas(id, campaign_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS collection_area_claims_area_idx
  ON collection_area_claims(campaign_id, area_id, occurred_at DESC);
