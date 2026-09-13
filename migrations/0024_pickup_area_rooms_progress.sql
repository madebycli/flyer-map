-- FC5.3 Pickup Actions: action type, one active Room per pickup Area and
-- first-class pickup road sections. Prepared only. Do not apply remotely from
-- the application; use the reviewed D1 deployment procedure.
PRAGMA foreign_keys = ON;

ALTER TABLE campaigns
  ADD COLUMN action_type TEXT NOT NULL DEFAULT 'distribution'
    CHECK (action_type IN ('distribution', 'pickup'));

CREATE INDEX IF NOT EXISTS campaigns_action_type_idx
  ON campaigns(action_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS collection_rooms (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'released', 'completed', 'force-released')),
  owner_collector_id TEXT NOT NULL,
  owner_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, campaign_id) REFERENCES collection_areas(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_collector_id, campaign_id)
    REFERENCES collection_collectors(id, campaign_id),
  UNIQUE (id, campaign_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS collection_rooms_one_active_area_idx
  ON collection_rooms(campaign_id, area_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS collection_rooms_campaign_status_idx
  ON collection_rooms(campaign_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS collection_room_participants (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  collector_id TEXT NOT NULL,
  label TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  FOREIGN KEY (room_id, campaign_id) REFERENCES collection_rooms(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (collector_id, campaign_id)
    REFERENCES collection_collectors(id, campaign_id),
  UNIQUE (room_id, collector_id)
);

CREATE INDEX IF NOT EXISTS collection_room_participants_active_idx
  ON collection_room_participants(campaign_id, room_id, left_at, joined_at);

CREATE TABLE IF NOT EXISTS collection_road_sections (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  label TEXT NOT NULL,
  geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'driven', 'later', 'unavailable')),
  coverage_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(coverage_json) AND json_type(coverage_json) = 'array'),
  source_task_id TEXT,
  source_generation TEXT,
  source_json TEXT CHECK (source_json IS NULL OR json_valid(source_json)),
  smart_marking_json TEXT CHECK (smart_marking_json IS NULL OR json_valid(smart_marking_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, campaign_id) REFERENCES collection_areas(id, campaign_id) ON DELETE CASCADE,
  UNIQUE (id, campaign_id)
);

CREATE INDEX IF NOT EXISTS collection_road_sections_area_status_idx
  ON collection_road_sections(campaign_id, area_id, status, created_at, id);

CREATE TABLE IF NOT EXISTS collection_room_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('claim', 'join', 'release', 'complete', 'force-release')),
  actor_collector_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, campaign_id) REFERENCES collection_areas(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, campaign_id) REFERENCES collection_rooms(id, campaign_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS collection_room_events_area_idx
  ON collection_room_events(campaign_id, area_id, created_at DESC, id);
