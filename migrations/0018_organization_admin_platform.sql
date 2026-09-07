-- Organization-scoped administrator identity, MFA, authorization and campaign ownership.
-- Additive only. This migration is prepared on the feature branch and must not be applied to production implicitly.
PRAGMA foreign_keys = ON;

CREATE TABLE organization_bootstrap_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  completed_at TEXT NOT NULL
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_password_credentials (
  account_id TEXT PRIMARY KEY REFERENCES organization_accounts(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL CHECK (algorithm = 'pbkdf2-sha256-v1'),
  iterations INTEGER NOT NULL CHECK (iterations >= 600000),
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_totp_credentials (
  account_id TEXT PRIMARY KEY REFERENCES organization_accounts(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  secret_nonce TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  verified_at TEXT,
  last_counter INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_recovery_codes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES organization_accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE organization_role_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE TABLE organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES organization_accounts(id) ON DELETE CASCADE,
  role_kind TEXT NOT NULL CHECK (role_kind IN ('organizer', 'admin')),
  role_template_id TEXT REFERENCES organization_role_templates(id) ON DELETE SET NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json)),
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, account_id)
);

CREATE TABLE organization_team_assignments (
  membership_id TEXT NOT NULL REFERENCES organization_memberships(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (membership_id, team_id)
);

CREATE TABLE organization_account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES organization_accounts(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  assurance TEXT NOT NULL CHECK (assurance IN ('mfa', 'recovery')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE organization_login_challenges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES organization_accounts(id) ON DELETE CASCADE,
  challenge_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('bootstrap', 'login')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE organization_login_throttles (
  scope TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_invites (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_account_id TEXT NOT NULL REFERENCES organization_accounts(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  role_kind TEXT NOT NULL CHECK (role_kind IN ('organizer', 'admin')),
  capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE organization_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_account_id TEXT REFERENCES organization_accounts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL
);

ALTER TABLE campaigns ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE campaigns ADD COLUMN admin_lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (admin_lifecycle_status IN ('draft', 'active', 'completed', 'archived'));

CREATE INDEX idx_org_memberships_account ON organization_memberships(account_id, disabled_at);
CREATE INDEX idx_org_memberships_org ON organization_memberships(organization_id, disabled_at, role_kind);
CREATE INDEX idx_org_sessions_account ON organization_account_sessions(account_id, expires_at, revoked_at);
CREATE INDEX idx_org_login_challenges_hash ON organization_login_challenges(challenge_hash);
CREATE INDEX idx_org_recovery_account ON organization_recovery_codes(account_id, used_at);
CREATE INDEX idx_org_invites_org ON organization_invites(organization_id, expires_at, used_at, revoked_at);
CREATE INDEX idx_org_audit_org_created ON organization_audit_events(organization_id, created_at);
CREATE INDEX idx_campaigns_organization ON campaigns(organization_id, admin_lifecycle_status);
