-- Organization account lifecycle hardening: transactional one-time claims, password resets and feature settings.
-- Additive only; production remains untouched until an explicitly isolated deployment applies this migration.
PRAGMA foreign_keys = ON;

CREATE TABLE organization_invite_claims (
  invite_id TEXT PRIMARY KEY REFERENCES organization_invites(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE REFERENCES organization_accounts(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL
);

CREATE TABLE organization_password_resets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES organization_accounts(id) ON DELETE CASCADE,
  created_by_account_id TEXT NOT NULL REFERENCES organization_accounts(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE organization_password_reset_claims (
  reset_id TEXT PRIMARY KEY REFERENCES organization_password_resets(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL
);

CREATE TABLE organization_feature_settings (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL CHECK (length(feature_key) BETWEEN 1 AND 80),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_by_account_id TEXT NOT NULL REFERENCES organization_accounts(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, feature_key)
);

CREATE INDEX idx_org_password_resets_account
  ON organization_password_resets(account_id, expires_at, used_at, revoked_at);
CREATE INDEX idx_org_password_resets_org
  ON organization_password_resets(organization_id, created_at);
CREATE INDEX idx_org_feature_settings_org
  ON organization_feature_settings(organization_id, feature_key);
