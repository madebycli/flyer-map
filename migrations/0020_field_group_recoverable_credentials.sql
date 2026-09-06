
-- Recoverable current Field Group join material for manager-only reveal.
-- Lookup authorization continues to use SHA-256 hashes in field_group_join_credentials.
-- Plaintext is never persisted. Ciphertext is AES-256-GCM with Worker-held key material.
-- This migration is additive and must not be applied to Production by application code.
PRAGMA foreign_keys = ON;

CREATE TABLE field_group_recoverable_credentials (
  credential_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('room-code', 'qr')),
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version = 1),
  iv_b64 TEXT NOT NULL,
  ciphertext_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (credential_id)
    REFERENCES field_group_join_credentials(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, campaign_id)
    REFERENCES field_groups(id, campaign_id) ON DELETE CASCADE
);

CREATE INDEX idx_field_group_recoverable_group
  ON field_group_recoverable_credentials(campaign_id, group_id, kind);
