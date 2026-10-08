-- v5 field core: status overlay keyed by stable derived ids, one row per key (latest write wins),
-- plus compressed raw OSM packs per Area. Additive; nothing here touches the legacy task tables.
CREATE TABLE v5_counters (
  campaign_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE v5_state (
  campaign_id TEXT NOT NULL,
  key TEXT NOT NULL,
  op_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'later', 'not-deliverable')),
  area_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, key),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX idx_v5_state_seq ON v5_state(campaign_id, seq);
CREATE INDEX idx_v5_state_area_seq ON v5_state(campaign_id, area_id, seq);

CREATE TABLE v5_pack_meta (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  engine TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  built_at TEXT NOT NULL,
  -- Hash of the Area polygon the pack was built for; a changed polygon makes the pack stale.
  geometry_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (campaign_id, area_id)
  -- No foreign key on area_id: an Area is either a distribution `areas` row or a `collection_areas` row; the Worker checks which.
);

CREATE TABLE v5_packs (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  chunk INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (campaign_id, area_id, version, chunk)
);

-- Claim row for pack builds: acquired atomically before the upstream request, so concurrent or repeated
-- builds (including failed ones) cannot hammer Overpass.
CREATE TABLE v5_pack_attempts (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, area_id)
);
