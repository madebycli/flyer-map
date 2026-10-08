-- v5 field notes: quick flags + short text on a street, house or Area. One row per note (identified by its
-- creation timestamp); edits and deletions are last-writer-wins on `rev`. Additive.
CREATE TABLE v5_note_counters (
  campaign_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE v5_notes (
  campaign_id TEXT NOT NULL,
  id TEXT NOT NULL,
  key TEXT NOT NULL,
  area_id TEXT NOT NULL,
  flag TEXT CHECK (flag IS NULL OR flag IN ('dog', 'locked', 'nope', 'full', 'again', 'danger', 'info')),
  body TEXT NOT NULL DEFAULT '',
  rev TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  actor TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX idx_v5_notes_seq ON v5_notes(campaign_id, seq);
CREATE INDEX idx_v5_notes_area_seq ON v5_notes(campaign_id, area_id, seq);
