-- How many houses and street pieces each unit (a Gebiet, or one part of a big Gebiet) holds once derived. The device that derives a unit reports it
-- (admins only, the numbers come from the public map data), so the overview can show a whole Aktion without every unit being loaded on the device.
-- Additive; nothing here touches existing tables.
CREATE TABLE v5_area_stats (
  campaign_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  pack_version INTEGER NOT NULL,
  houses INTEGER NOT NULL,
  segments INTEGER NOT NULL,
  reported_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, unit_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX idx_v5_area_stats_area ON v5_area_stats(campaign_id, area_id);
