-- v5 Räume (rooms) for distribution Aktionen: a Gruppe works in a Gebiet in stages ("Runs"). Someone opens a room, sets how many people take part
-- (by hand: devices are never counted), the others join with a link or QR code. The row is also the record for later planning:
-- how long, how many people, how many houses. Additive; nothing here touches the existing tables except one nullable column on access grants.
CREATE TABLE v5_rooms (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  -- No foreign keys on the Gebiet and the Gruppe: the record has to outlive them; their names are copied.
  area_id TEXT NOT NULL,
  area_name TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  team_color TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'finished')),
  headcount INTEGER NOT NULL CHECK (headcount BETWEEN 1 AND 1000),
  -- link: only with the link or QR code; team: only members of the Gruppe (nobody new joins); password: link and password; open: the link alone, any Gruppe.
  join_mode TEXT NOT NULL CHECK (join_mode IN ('link', 'team', 'password', 'open')),
  join_secret TEXT NOT NULL,
  password_salt TEXT,
  password_hash TEXT,
  failed_joins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  started_by TEXT NOT NULL,
  -- The write counter of the Aktion when the room opened: houses marked done since then belong to this run.
  seq_start INTEGER NOT NULL,
  houses_total INTEGER,
  houses_done INTEGER,
  area_done INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_v5_rooms_active_area ON v5_rooms(campaign_id, area_id) WHERE status = 'active';
CREATE INDEX idx_v5_rooms_campaign ON v5_rooms(campaign_id, started_at);

CREATE TABLE v5_room_guests (
  room_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  label TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, grant_id),
  FOREIGN KEY (room_id) REFERENCES v5_rooms(id) ON DELETE CASCADE
);

-- A guest's access grant belongs to the room it was made for and ends with it.
ALTER TABLE campaign_access_grants ADD COLUMN room_id TEXT;
CREATE INDEX idx_campaign_access_grants_room ON campaign_access_grants(room_id) WHERE room_id IS NOT NULL;
