CREATE TABLE IF NOT EXISTS auth_trusted_devices (
  id TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('campaign_admin', 'organization_account')),
  subject_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  assurance TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  replaced_by_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_trusted_devices_subject
  ON auth_trusted_devices(subject_kind, subject_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_auth_trusted_devices_family
  ON auth_trusted_devices(family_id, revoked_at);
