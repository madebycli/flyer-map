-- FC2 deterministic automation configuration.
-- Additive only. Prepare this migration locally; do not apply it remotely as
-- part of application code or a branch preview deployment.
PRAGMA foreign_keys = ON;

CREATE TABLE automation_rules (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (
    rule_type = 'complete-parent-street-when-all-houses-complete'
  ),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, rule_type)
);
