-- FC5.2 additive Pickup visibility capability for Collection collectors.
-- Prepared only. Apply through the reviewed deployment procedure after approval.
PRAGMA foreign_keys = ON;

ALTER TABLE collection_collectors
  ADD COLUMN can_view_pickups INTEGER NOT NULL DEFAULT 1
    CHECK (can_view_pickups IN (0, 1));
