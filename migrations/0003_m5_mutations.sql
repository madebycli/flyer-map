-- M5 durable mutation idempotency ledger.
-- 0001_initial.sql and 0002_m4_access.sql are immutable production history.
PRAGMA foreign_keys = ON;

CREATE TABLE campaign_mutations (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  mutation_type TEXT NOT NULL,
  mutation_fingerprint TEXT NOT NULL
    CHECK (length(mutation_fingerprint) = 64),
  requested_base_revision INTEGER NOT NULL CHECK (requested_base_revision >= 0),
  applied_from_revision INTEGER NOT NULL CHECK (applied_from_revision >= 0),
  applied_revision INTEGER NOT NULL CHECK (applied_revision > applied_from_revision),
  client_created_at TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id, mutation_id)
);

CREATE INDEX idx_campaign_mutations_applied
  ON campaign_mutations(campaign_id, applied_revision);
