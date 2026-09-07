-- One-time, campaign-local password reset invitations for Mission Admin accounts.
-- Additive: this neither changes regular Access links nor introduces a shared identity model.
PRAGMA foreign_keys = ON;

CREATE TABLE campaign_admin_password_reset_invites (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (account_id, campaign_id)
    REFERENCES campaign_admin_accounts(id, campaign_id) ON DELETE CASCADE
);

CREATE INDEX idx_campaign_admin_password_reset_invites_account
  ON campaign_admin_password_reset_invites(campaign_id, account_id, expires_at, used_at);
