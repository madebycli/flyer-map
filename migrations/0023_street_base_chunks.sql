-- Additive candidate migration. Never applied automatically to Production.
PRAGMA foreign_keys = ON;
CREATE TABLE campaign_sync_heads (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  collection_name TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY(campaign_id,collection_name)
);
-- One-time candidate migration backfill. Review existing feed size before staging.
INSERT INTO campaign_sync_heads(campaign_id,collection_name,seq)
  SELECT campaign_id,collection_name,MAX(seq) FROM campaign_sync_changes GROUP BY campaign_id,collection_name;
CREATE TRIGGER campaign_sync_update_head AFTER INSERT ON campaign_sync_changes BEGIN
  INSERT INTO campaign_sync_heads(campaign_id,collection_name,seq) VALUES(NEW.campaign_id,NEW.collection_name,NEW.seq)
  ON CONFLICT(campaign_id,collection_name) DO UPDATE SET seq=excluded.seq;
END;
CREATE TABLE street_base_areas (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  PRIMARY KEY(campaign_id,area_id),
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);
CREATE TABLE street_base_chunks (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('street','house')),
  bucket INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(length(payload_json)<1000000),
  PRIMARY KEY(campaign_id,area_id,content_hash),
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);
CREATE INDEX street_base_entity_lookup ON street_base_chunks(campaign_id,kind,bucket,area_id);
CREATE TABLE street_work_overlays (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(length(payload_json)<1000000),
  PRIMARY KEY(campaign_id,area_id,bucket),
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);
-- Public OSM data only. A bounded shared cache avoids repeated Area test fetches.
CREATE TABLE street_source_tiles (
  cache_key TEXT NOT NULL,
  part INTEGER NOT NULL,
  cached_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(length(payload_json)<1000000),
  PRIMARY KEY(cache_key,part)
);

-- Manual Houses can refer to immutable Streets that have no legacy tasks row.
CREATE TABLE street_manual_house_parents (
  campaign_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  parent_task_id TEXT NOT NULL,
  PRIMARY KEY(campaign_id,house_id),
  FOREIGN KEY(house_id,campaign_id) REFERENCES house_tasks(id,campaign_id) ON DELETE CASCADE,
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);

-- Physical history batches preserve individual event identities through a read view.
CREATE TABLE street_network_history (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  intent_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  team_id TEXT,
  field_session_id TEXT REFERENCES field_sessions(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_ref TEXT,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(length(payload_json)<1000000),
  PRIMARY KEY(campaign_id,intent_id,part)
);
CREATE INDEX street_history_session ON street_network_history(field_session_id,occurred_at);
CREATE VIEW domain_event_history AS
  SELECT id,campaign_id,team_id,field_session_id,entity_type,entity_id,event_type,occurred_at,actor_kind,actor_ref,payload_version,payload_json,dedupe_key,created_at FROM domain_events
  UNION ALL
  SELECT json_extract(e.value,'$.id'),b.campaign_id,b.team_id,b.field_session_id,
    json_extract(e.value,'$.entityType'),json_extract(e.value,'$.entityId'),json_extract(e.value,'$.eventType'),b.occurred_at,b.actor_kind,b.actor_ref,
    1,json_extract(e.value,'$.payload'),json_extract(e.value,'$.dedupeKey'),b.created_at
  FROM street_network_history b,json_each(b.payload_json) e;
