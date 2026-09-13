-- FC5.3 Pickup Road Sections: additive actor attribution and section audit.
-- Prepared only. Apply through the reviewed D1 deployment procedure.
PRAGMA foreign_keys = ON;

ALTER TABLE collection_road_sections
  ADD COLUMN created_by_kind TEXT NOT NULL DEFAULT 'campaign-grant'
    CHECK (created_by_kind IN ('campaign-grant', 'collection-collector'));
ALTER TABLE collection_road_sections
  ADD COLUMN created_by_ref TEXT;
ALTER TABLE collection_road_sections
  ADD COLUMN updated_by_kind TEXT NOT NULL DEFAULT 'campaign-grant'
    CHECK (updated_by_kind IN ('campaign-grant', 'collection-collector'));
ALTER TABLE collection_road_sections
  ADD COLUMN updated_by_ref TEXT;

CREATE TABLE collection_road_section_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('create', 'update', 'set-status')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('campaign-grant', 'collection-collector')),
  actor_ref TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, campaign_id) REFERENCES collection_areas(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (section_id, campaign_id) REFERENCES collection_road_sections(id, campaign_id) ON DELETE CASCADE
);

CREATE INDEX collection_road_section_events_section_idx
  ON collection_road_section_events(campaign_id, section_id, created_at DESC, id);
