-- Mission-local Campaign Admin accounts. This is deliberately separate from
-- the future Organization/TOTP model and is additive to M4 access grants.
PRAGMA foreign_keys = ON;

CREATE TABLE campaign_admin_accounts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  grant_id TEXT NOT NULL UNIQUE REFERENCES campaign_access_grants(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  password_algorithm TEXT NOT NULL CHECK (password_algorithm = 'pbkdf2-sha256-v1'),
  password_iterations INTEGER NOT NULL CHECK (password_iterations >= 600000),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled_at TEXT,
  UNIQUE (campaign_id, username_normalized),
  UNIQUE (id, campaign_id),
  FOREIGN KEY (grant_id, campaign_id)
    REFERENCES campaign_access_grants(id, campaign_id) ON DELETE CASCADE
);

CREATE TABLE campaign_admin_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (account_id, campaign_id)
    REFERENCES campaign_admin_accounts(id, campaign_id) ON DELETE CASCADE
);

CREATE TABLE campaign_admin_setup_invites (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE campaign_admin_login_throttles (
  scope TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL CHECK (failure_count >= 0),
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_campaign_admin_accounts_campaign ON campaign_admin_accounts(campaign_id, disabled_at);
CREATE INDEX idx_campaign_admin_sessions_account ON campaign_admin_sessions(account_id, expires_at, revoked_at);
CREATE INDEX idx_campaign_admin_sessions_hash ON campaign_admin_sessions(session_hash);
CREATE INDEX idx_campaign_admin_setup_invites_campaign ON campaign_admin_setup_invites(campaign_id, expires_at, used_at);
