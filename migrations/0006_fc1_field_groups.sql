-- FC1 durable Field Groups, join credentials and scoped memberships.
-- This migration is intentionally additive. Do not apply remotely as part of application code.
-- Migration 0006 has not been applied remotely, so FC1 idempotency columns stay in this initial schema.
PRAGMA foreign_keys = ON;

CREATE TABLE field_groups (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  label TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'distribution'
    CHECK (mode IN ('distribution', 'collection')),
  discoverable INTEGER NOT NULL DEFAULT 1
    CHECK (discoverable IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'closed', 'expired')),
  participant_count INTEGER
    CHECK (participant_count IS NULL OR (participant_count >= 1 AND participant_count <= 500)),
  created_by_grant_id TEXT,
  create_request_id TEXT NOT NULL,
  create_payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  hard_expires_at TEXT NOT NULL,
  closed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (id, campaign_id),
  UNIQUE (campaign_id, create_request_id),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_grant_id)
    REFERENCES campaign_access_grants(id) ON DELETE SET NULL,
  CHECK (
    (state = 'active' AND closed_at IS NULL) OR
    (state IN ('closed', 'expired') AND closed_at IS NOT NULL)
  )
);

CREATE TABLE field_group_join_credentials (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('room-code', 'qr')),
  issuance_type TEXT NOT NULL CHECK (issuance_type IN ('create', 'rotate')),
  request_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (kind, secret_hash),
  UNIQUE (group_id, kind, issuance_type, request_id),
  FOREIGN KEY (group_id, campaign_id)
    REFERENCES field_groups(id, campaign_id) ON DELETE CASCADE
);

CREATE TABLE field_group_memberships (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  campaign_grant_id TEXT,
  temp_session_hash TEXT,
  joined_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  left_at TEXT,
  removed_at TEXT,
  UNIQUE (temp_session_hash),
  FOREIGN KEY (group_id, campaign_id)
    REFERENCES field_groups(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (campaign_grant_id)
    REFERENCES campaign_access_grants(id) ON DELETE CASCADE,
  CHECK (
    (campaign_grant_id IS NOT NULL AND temp_session_hash IS NULL) OR
    (campaign_grant_id IS NULL AND temp_session_hash IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_field_group_membership_grant
  ON field_group_memberships(group_id, campaign_grant_id)
  WHERE campaign_grant_id IS NOT NULL;
CREATE INDEX idx_field_groups_campaign_state
  ON field_groups(campaign_id, state, discoverable);
CREATE INDEX idx_field_groups_team_state
  ON field_groups(team_id, state);
CREATE INDEX idx_field_group_credentials_group
  ON field_group_join_credentials(group_id, kind, revoked_at);
CREATE INDEX idx_field_group_credentials_request
  ON field_group_join_credentials(group_id, issuance_type, request_id);
CREATE INDEX idx_field_group_memberships_group
  ON field_group_memberships(group_id, left_at, removed_at);
CREATE INDEX idx_field_group_memberships_campaign
  ON field_group_memberships(campaign_id, team_id);
