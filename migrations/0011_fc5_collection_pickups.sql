-- FC5.2 First-Class Collection Pickup Tasks and narrow Collector capabilities.
-- Prepared only. Apply through the reviewed deployment procedure after approval.
PRAGMA foreign_keys = ON;

ALTER TABLE collection_collectors
  ADD COLUMN can_create_pickups INTEGER NOT NULL DEFAULT 0 CHECK (can_create_pickups IN (0, 1));
ALTER TABLE collection_collectors
  ADD COLUMN can_edit_pickups INTEGER NOT NULL DEFAULT 0 CHECK (can_edit_pickups IN (0, 1));
ALTER TABLE collection_collectors
  ADD COLUMN can_assign_pickups INTEGER NOT NULL DEFAULT 0 CHECK (can_assign_pickups IN (0, 1));

CREATE TABLE collection_pickups (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  area_id TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  address TEXT NOT NULL CHECK (length(trim(address)) BETWEEN 1 AND 320),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'collected', 'unavailable', 'needs-follow-up')),
  archived_at TEXT,
  assigned_run_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assigned_run_ids_json)),
  assigned_collector_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assigned_collector_ids_json)),
  source_json TEXT CHECK (source_json IS NULL OR json_valid(source_json)),
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('campaign-grant', 'collection-collector')),
  created_by_ref TEXT,
  updated_by_kind TEXT NOT NULL CHECK (updated_by_kind IN ('campaign-grant', 'collection-collector')),
  updated_by_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES collection_areas(id, campaign_id) ON DELETE SET NULL,
  UNIQUE (id, campaign_id),
  CHECK (archived_at IS NULL OR status <> 'collected')
);

CREATE INDEX collection_pickups_campaign_status_idx
  ON collection_pickups(campaign_id, archived_at, status, created_at DESC);
CREATE INDEX collection_pickups_area_idx
  ON collection_pickups(campaign_id, area_id, archived_at, created_at DESC);
