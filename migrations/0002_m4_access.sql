-- M4 access links, revocable sessions and shared campaign map focus.
-- 0001_initial.sql is production history and must remain unchanged.
PRAGMA foreign_keys = ON;

ALTER TABLE campaigns ADD COLUMN map_center_lng REAL;
ALTER TABLE campaigns ADD COLUMN map_center_lat REAL;
ALTER TABLE campaigns ADD COLUMN map_zoom REAL;
ALTER TABLE campaigns ADD COLUMN map_bearing REAL;

CREATE TABLE campaign_access_grants (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'team-editor', 'viewer')),
  team_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE CASCADE,
  CHECK (
    (role = 'team-editor' AND team_id IS NOT NULL) OR
    (role <> 'team-editor' AND team_id IS NULL)
  )
);

CREATE TABLE campaign_sessions (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES campaign_access_grants(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (grant_id, campaign_id)
    REFERENCES campaign_access_grants(id, campaign_id) ON DELETE CASCADE
);

CREATE INDEX idx_access_grants_campaign ON campaign_access_grants(campaign_id);
CREATE INDEX idx_access_grants_token_hash ON campaign_access_grants(token_hash);
CREATE INDEX idx_access_grants_team ON campaign_access_grants(campaign_id, team_id);
CREATE INDEX idx_sessions_campaign ON campaign_sessions(campaign_id);
CREATE INDEX idx_sessions_grant ON campaign_sessions(grant_id);
CREATE INDEX idx_sessions_hash ON campaign_sessions(session_hash);
