PRAGMA foreign_keys=OFF;
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision >= 0),
  -- Internal optimistic-concurrency guard. Never exposed as campaign data.
  write_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, map_center_lng REAL, map_center_lat REAL, map_zoom REAL, map_bearing REAL, organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT, admin_lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (admin_lifecycle_status IN ('draft', 'active', 'completed', 'archived')), window_starts_at TEXT, window_ends_at TEXT);
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campaign_id, color),
  UNIQUE (id, campaign_id)
);
CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('street')),
  label TEXT NOT NULL,
  geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'later', 'not-deliverable')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, source_json TEXT
  CHECK (source_json IS NULL OR json_valid(source_json)), area_preparation_generation TEXT,
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES areas(id, campaign_id) ON DELETE CASCADE,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL)
  )
);
CREATE INDEX idx_teams_campaign ON teams(campaign_id);
CREATE INDEX idx_areas_campaign ON areas(campaign_id);
CREATE INDEX idx_areas_team ON areas(team_id);
CREATE INDEX idx_tasks_area ON tasks(area_id);
CREATE INDEX idx_tasks_campaign_status ON tasks(campaign_id, status);
CREATE TABLE campaign_access_grants (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'team-editor', 'viewer')),
  team_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT, room_id TEXT,
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
CREATE TABLE house_tasks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL,
  parent_street_task_id TEXT,
  label TEXT NOT NULL,
  geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
  source_json TEXT CHECK (source_json IS NULL OR json_valid(source_json)),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'later', 'not-deliverable')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, area_preparation_generation TEXT,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES areas(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_street_task_id)
    REFERENCES tasks(id) ON DELETE SET NULL,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL)
  )
);
CREATE INDEX idx_house_tasks_campaign ON house_tasks(campaign_id);
CREATE INDEX idx_house_tasks_area ON house_tasks(area_id);
CREATE INDEX idx_house_tasks_parent_street ON house_tasks(parent_street_task_id);
CREATE INDEX idx_house_tasks_campaign_status ON house_tasks(campaign_id, status);
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
CREATE TABLE field_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  field_group_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('distribution', 'collection')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('manual-close', 'group-expired')),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  participant_count INTEGER
    CHECK (participant_count IS NULL OR (participant_count >= 1 AND participant_count <= 500)),
  person_seconds INTEGER CHECK (person_seconds IS NULL OR person_seconds >= 0),
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, field_group_id),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (field_group_id, campaign_id)
    REFERENCES field_groups(id, campaign_id) ON DELETE CASCADE,
  CHECK (
    (status = 'active' AND ended_at IS NULL AND end_reason IS NULL
      AND duration_seconds IS NULL AND person_seconds IS NULL) OR
    (status = 'closed' AND ended_at IS NOT NULL AND end_reason IS NOT NULL
      AND duration_seconds IS NOT NULL
      AND (
        (participant_count IS NULL AND person_seconds IS NULL) OR
        (participant_count IS NOT NULL AND person_seconds IS NOT NULL)
      ))
  )
);
CREATE INDEX idx_field_sessions_campaign_started
  ON field_sessions(campaign_id, started_at DESC, id DESC);
CREATE INDEX idx_field_sessions_team_started
  ON field_sessions(team_id, started_at DESC, id DESC);
CREATE INDEX idx_field_sessions_group
  ON field_sessions(field_group_id);
CREATE TRIGGER trg_field_group_start_session
AFTER INSERT ON field_groups
WHEN NEW.state = 'active'
BEGIN
  INSERT OR IGNORE INTO field_sessions (
    id,
    campaign_id,
    team_id,
    field_group_id,
    mode,
    started_at,
    ended_at,
    end_reason,
    duration_seconds,
    participant_count,
    person_seconds,
    note,
    status,
    created_at,
    updated_at
  )
  VALUES (
    'field_session_group_' || NEW.id,
    NEW.campaign_id,
    NEW.team_id,
    NEW.id,
    NEW.mode,
    NEW.created_at,
    NULL,
    NULL,
    NULL,
    NEW.participant_count,
    NULL,
    NULL,
    'active',
    NEW.created_at,
    NEW.created_at
  );
END;
CREATE TRIGGER trg_field_group_participant_session_sync
AFTER UPDATE OF participant_count ON field_groups
WHEN NEW.state = 'active' AND OLD.participant_count IS NOT NEW.participant_count
BEGIN
  UPDATE field_sessions
  SET participant_count = NEW.participant_count,
      updated_at = NEW.updated_at
  WHERE campaign_id = NEW.campaign_id
    AND field_group_id = NEW.id
    AND status = 'active';
END;
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
CREATE TABLE collection_access_links (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX collection_access_links_campaign_idx
  ON collection_access_links(campaign_id, created_at DESC);
CREATE TABLE collection_collectors (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  access_link_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT, can_create_pickups INTEGER NOT NULL DEFAULT 0 CHECK (can_create_pickups IN (0, 1)), can_edit_pickups INTEGER NOT NULL DEFAULT 0 CHECK (can_edit_pickups IN (0, 1)), can_assign_pickups INTEGER NOT NULL DEFAULT 0 CHECK (can_assign_pickups IN (0, 1)), can_view_pickups INTEGER NOT NULL DEFAULT 1
    CHECK (can_view_pickups IN (0, 1)),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (access_link_id) REFERENCES collection_access_links(id) ON DELETE CASCADE,
  UNIQUE (id, campaign_id)
);
CREATE INDEX collection_collectors_campaign_idx
  ON collection_collectors(campaign_id, created_at DESC);
CREATE TABLE collection_collector_sessions (
  id TEXT PRIMARY KEY,
  collector_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (collector_id) REFERENCES collection_collectors(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX collection_collector_sessions_lookup_idx
  ON collection_collector_sessions(session_hash, campaign_id, expires_at);
CREATE TABLE collection_main_areas (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE (id, campaign_id)
);
CREATE TABLE collection_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  main_area_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'cancelled')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_by_collector_id TEXT NOT NULL,
  area_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (main_area_id, campaign_id)
    REFERENCES collection_main_areas(id, campaign_id),
  UNIQUE (id, campaign_id)
);
CREATE INDEX collection_runs_campaign_idx
  ON collection_runs(campaign_id, main_area_id, status, started_at DESC);
CREATE TABLE collection_areas (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  main_area_id TEXT NOT NULL,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  color TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'in-progress', 'completed', 'archived')),
  run_id TEXT,
  claimed_by_collector_id TEXT,
  claimed_by_label TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (main_area_id, campaign_id)
    REFERENCES collection_main_areas(id, campaign_id),
  FOREIGN KEY (run_id, campaign_id)
    REFERENCES collection_runs(id, campaign_id),
  UNIQUE (id, campaign_id)
);
CREATE INDEX collection_areas_campaign_idx
  ON collection_areas(campaign_id, main_area_id, status, created_at);
CREATE INDEX collection_areas_run_idx
  ON collection_areas(campaign_id, run_id, status);
CREATE TABLE collection_run_members (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  collector_id TEXT NOT NULL,
  label TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  FOREIGN KEY (run_id, campaign_id)
    REFERENCES collection_runs(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (collector_id, campaign_id)
    REFERENCES collection_collectors(id, campaign_id) ON DELETE CASCADE,
  UNIQUE (run_id, collector_id)
);
CREATE INDEX collection_run_members_run_idx
  ON collection_run_members(run_id, left_at, joined_at);
CREATE TABLE collection_area_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  run_id TEXT,
  collector_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('claim', 'release', 'complete', 'force-release', 'archive')),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES collection_areas(id, campaign_id) ON DELETE CASCADE
);
CREATE INDEX collection_area_claims_area_idx
  ON collection_area_claims(campaign_id, area_id, occurred_at DESC);
CREATE TABLE collection_pickups (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  area_id TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  address TEXT NOT NULL CHECK (length(trim(address)) BETWEEN 1 AND 320),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'collected', 'unavailable', 'needs-follow-up')),
  archived_at TEXT,
  assigned_run_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(assigned_run_ids_json) AND json_type(assigned_run_ids_json) = 'array'),
  assigned_collector_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(assigned_collector_ids_json) AND json_type(assigned_collector_ids_json) = 'array'),
  source_json TEXT CHECK (source_json IS NULL OR json_valid(source_json)),
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('campaign-grant', 'collection-collector')),
  created_by_ref TEXT,
  updated_by_kind TEXT NOT NULL CHECK (updated_by_kind IN ('campaign-grant', 'collection-collector')),
  updated_by_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES collection_areas(id, campaign_id),
  UNIQUE (id, campaign_id)
);
CREATE INDEX collection_pickups_campaign_status_idx
  ON collection_pickups(campaign_id, archived_at, status, created_at DESC);
CREATE INDEX collection_pickups_area_idx
  ON collection_pickups(campaign_id, area_id, archived_at, created_at DESC);
CREATE TABLE "comments" (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (
    target_type IN ('campaign', 'area', 'street-task', 'house-task', 'pickup-task')
  ),
  target_id TEXT NOT NULL,
  team_id TEXT,
  author_kind TEXT NOT NULL CHECK (
    author_kind IN ('campaign-grant', 'temporary-member', 'collection-collector', 'unknown')
  ),
  author_ref TEXT,
  body TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_operation_id TEXT,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT,
  CHECK (
    (
      (target_type IN ('campaign', 'pickup-task') AND team_id IS NULL) OR
      (target_type IN ('area', 'street-task', 'house-task') AND team_id IS NOT NULL)
    ) AND
    ((deleted_at IS NULL AND body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 2000) OR
      (deleted_at IS NOT NULL AND body IS NULL))
  )
);
CREATE INDEX idx_comments_context
  ON comments(campaign_id, target_type, target_id, created_at DESC, id DESC);
CREATE INDEX idx_comments_scope
  ON comments(campaign_id, team_id, created_at DESC, id DESC);
CREATE TABLE "domain_events" (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id TEXT,
  field_session_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (
    actor_kind IN (
      'campaign-grant',
      'temporary-member',
      'collection-collector',
      'organization-account',
      'system',
      'unknown'
    )
  ),
  actor_ref TEXT,
  payload_version INTEGER NOT NULL CHECK (payload_version >= 1),
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, dedupe_key),
  FOREIGN KEY (team_id, campaign_id)
    REFERENCES teams(id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (field_session_id)
    REFERENCES field_sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_domain_events_campaign_time
  ON domain_events(campaign_id, occurred_at DESC, id DESC);
CREATE INDEX idx_domain_events_session_time
  ON domain_events(field_session_id, occurred_at, id);
CREATE INDEX idx_domain_events_entity
  ON domain_events(campaign_id, entity_type, entity_id, occurred_at);
CREATE TRIGGER trg_field_group_close_history
AFTER UPDATE OF state ON field_groups
WHEN OLD.state = 'active' AND NEW.state = 'closed'
BEGIN
  UPDATE field_sessions
  SET ended_at = NEW.closed_at,
      end_reason = 'manual-close',
      duration_seconds = MAX(
        0,
        CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)
      ),
      participant_count = NEW.participant_count,
      person_seconds = MAX(
        0,
        CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)
      ) * NEW.participant_count,
      status = 'closed',
      updated_at = NEW.closed_at
  WHERE campaign_id = NEW.campaign_id
    AND field_group_id = NEW.id
    AND status = 'active';

  INSERT OR IGNORE INTO field_sessions (
    id,
    campaign_id,
    team_id,
    field_group_id,
    mode,
    started_at,
    ended_at,
    end_reason,
    duration_seconds,
    participant_count,
    person_seconds,
    note,
    status,
    created_at,
    updated_at
  )
  VALUES (
    'field_session_group_' || NEW.id,
    NEW.campaign_id,
    NEW.team_id,
    NEW.id,
    NEW.mode,
    NEW.created_at,
    NEW.closed_at,
    'manual-close',
    MAX(
      0,
      CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', NEW.created_at) AS INTEGER)
    ),
    NEW.participant_count,
    MAX(
      0,
      CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', NEW.created_at) AS INTEGER)
    ) * NEW.participant_count,
    NULL,
    'closed',
    NEW.created_at,
    NEW.closed_at
  );

  INSERT OR IGNORE INTO domain_events (
    id,
    campaign_id,
    team_id,
    field_session_id,
    entity_type,
    entity_id,
    event_type,
    occurred_at,
    actor_kind,
    actor_ref,
    payload_version,
    payload_json,
    dedupe_key,
    created_at
  )
  VALUES (
    'domain_event_field_session_ended_' || NEW.id,
    NEW.campaign_id,
    NEW.team_id,
    'field_session_group_' || NEW.id,
    'field-session',
    'field_session_group_' || NEW.id,
    'field_session.closed',
    NEW.closed_at,
    'unknown',
    NULL,
    1,
    '{}',
    'field-session.ended:field_session_group_' || NEW.id,
    NEW.closed_at
  );
END;
CREATE TRIGGER trg_field_group_expiry_history
AFTER UPDATE OF state ON field_groups
WHEN OLD.state = 'active' AND NEW.state = 'expired'
BEGIN
  UPDATE field_sessions
  SET ended_at = NEW.closed_at,
      end_reason = 'group-expired',
      duration_seconds = MAX(
        0,
        CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)
      ),
      participant_count = NEW.participant_count,
      person_seconds = CASE
        WHEN NEW.participant_count IS NULL THEN NULL
        ELSE MAX(
          0,
          CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)
        ) * NEW.participant_count
      END,
      status = 'closed',
      updated_at = NEW.closed_at
  WHERE campaign_id = NEW.campaign_id
    AND field_group_id = NEW.id
    AND status = 'active';

  INSERT OR IGNORE INTO field_sessions (
    id,
    campaign_id,
    team_id,
    field_group_id,
    mode,
    started_at,
    ended_at,
    end_reason,
    duration_seconds,
    participant_count,
    person_seconds,
    note,
    status,
    created_at,
    updated_at
  )
  VALUES (
    'field_session_group_' || NEW.id,
    NEW.campaign_id,
    NEW.team_id,
    NEW.id,
    NEW.mode,
    NEW.created_at,
    NEW.closed_at,
    'group-expired',
    MAX(
      0,
      CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', NEW.created_at) AS INTEGER)
    ),
    NEW.participant_count,
    CASE
      WHEN NEW.participant_count IS NULL THEN NULL
      ELSE MAX(
        0,
        CAST(strftime('%s', NEW.closed_at) AS INTEGER) - CAST(strftime('%s', NEW.created_at) AS INTEGER)
      ) * NEW.participant_count
    END,
    NULL,
    'closed',
    NEW.created_at,
    NEW.closed_at
  );

  INSERT OR IGNORE INTO domain_events (
    id,
    campaign_id,
    team_id,
    field_session_id,
    entity_type,
    entity_id,
    event_type,
    occurred_at,
    actor_kind,
    actor_ref,
    payload_version,
    payload_json,
    dedupe_key,
    created_at
  )
  VALUES (
    'domain_event_field_session_ended_' || NEW.id,
    NEW.campaign_id,
    NEW.team_id,
    'field_session_group_' || NEW.id,
    'field-session',
    'field_session_group_' || NEW.id,
    'field_session.expired',
    NEW.closed_at,
    'system',
    NULL,
    1,
    '{}',
    'field-session.ended:field_session_group_' || NEW.id,
    NEW.closed_at
  );
END;
CREATE TABLE area_task_preparations (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  geometry_hash TEXT NOT NULL,
  generation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  road_count INTEGER NOT NULL DEFAULT 0 CHECK (road_count >= 0),
  house_count INTEGER NOT NULL DEFAULT 0 CHECK (house_count >= 0),
  source_timestamp TEXT,
  started_at TEXT,
  ready_at TEXT,
  failed_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, area_id),
  FOREIGN KEY (area_id, campaign_id)
    REFERENCES areas(id, campaign_id) ON DELETE CASCADE
);
CREATE INDEX idx_area_task_preparations_campaign_status
  ON area_task_preparations(campaign_id, status);
CREATE INDEX idx_tasks_campaign_area_preparation_generation
  ON tasks(campaign_id, area_id, area_preparation_generation);
CREATE INDEX idx_house_tasks_campaign_area_preparation_generation
  ON house_tasks(campaign_id, area_id, area_preparation_generation);
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
CREATE TABLE campaign_sync_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  collection_name TEXT NOT NULL CHECK (
    collection_name IN ('campaigns', 'teams', 'areas', 'streetTasks', 'houseTasks')
  ),
  document_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  -- Keeps Field Group pull filtering correct even after an Area/Task tombstone.
  scope_team_id TEXT,
  document_json TEXT NOT NULL CHECK (json_valid(document_json)) CHECK (length(document_json) <= 262144),
  changed_at TEXT NOT NULL
);
CREATE INDEX idx_campaign_sync_changes_campaign_collection_seq
  ON campaign_sync_changes(campaign_id, collection_name, seq);
CREATE INDEX idx_campaign_sync_changes_campaign_scope_collection_seq
  ON campaign_sync_changes(campaign_id, scope_team_id, collection_name, seq);
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
, mfa_required INTEGER NOT NULL DEFAULT 1 CHECK (mfa_required IN (0, 1)));
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
CREATE INDEX idx_org_memberships_account ON organization_memberships(account_id, disabled_at);
CREATE INDEX idx_org_memberships_org ON organization_memberships(organization_id, disabled_at, role_kind);
CREATE INDEX idx_org_sessions_account ON organization_account_sessions(account_id, expires_at, revoked_at);
CREATE INDEX idx_org_login_challenges_hash ON organization_login_challenges(challenge_hash);
CREATE INDEX idx_org_recovery_account ON organization_recovery_codes(account_id, used_at);
CREATE INDEX idx_org_invites_org ON organization_invites(organization_id, expires_at, used_at, revoked_at);
CREATE INDEX idx_org_audit_org_created ON organization_audit_events(organization_id, created_at);
CREATE INDEX idx_campaigns_organization ON campaigns(organization_id, admin_lifecycle_status);
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
CREATE TABLE street_network_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  network_json TEXT NOT NULL CHECK(json_valid(network_json))
);
CREATE TABLE house_road_positions (
  house_id TEXT PRIMARY KEY REFERENCES house_tasks(id) ON DELETE CASCADE,
  position_json TEXT NOT NULL CHECK(json_valid(position_json))
);
CREATE TABLE street_network_jobs (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  phase TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(campaign_id, area_id),
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);
CREATE TABLE street_network_staging (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  kind TEXT NOT NULL,
  chunk_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(campaign_id,area_id,generation,kind,chunk_key),
  FOREIGN KEY(area_id,campaign_id) REFERENCES areas(id,campaign_id) ON DELETE CASCADE
);
CREATE TABLE street_network_intents (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  intent_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(campaign_id,intent_id)
);
CREATE TABLE campaign_sync_retention (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  collection_name TEXT NOT NULL CHECK (
    collection_name IN ('campaigns', 'teams', 'areas', 'streetTasks', 'houseTasks')
  ),
  min_checkpoint_seq INTEGER NOT NULL CHECK (min_checkpoint_seq >= 0),
  epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, collection_name)
);
CREATE TABLE auth_trusted_devices (
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
CREATE INDEX idx_auth_trusted_devices_subject
  ON auth_trusted_devices(subject_kind, subject_id, revoked_at);
CREATE INDEX idx_auth_trusted_devices_family
  ON auth_trusted_devices(family_id, revoked_at);
CREATE TABLE v5_counters (
  campaign_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE TABLE v5_state (
  campaign_id TEXT NOT NULL,
  key TEXT NOT NULL,
  op_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'later', 'not-deliverable')),
  area_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, key),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX idx_v5_state_seq ON v5_state(campaign_id, seq);
CREATE INDEX idx_v5_state_area_seq ON v5_state(campaign_id, area_id, seq);
CREATE TABLE v5_pack_meta (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  engine TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  built_at TEXT NOT NULL,
  -- Hash of the Area polygon the pack was built for; a changed polygon makes the pack stale.
  geometry_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (campaign_id, area_id)
  -- No foreign key on area_id: an Area is either a distribution `areas` row or a `collection_areas` row; the Worker checks which.
);
CREATE TABLE v5_packs (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  chunk INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (campaign_id, area_id, version, chunk)
);
CREATE TABLE v5_pack_attempts (
  campaign_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, area_id)
);
CREATE TABLE v5_note_counters (
  campaign_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE TABLE v5_notes (
  campaign_id TEXT NOT NULL,
  id TEXT NOT NULL,
  key TEXT NOT NULL,
  area_id TEXT NOT NULL,
  flag TEXT CHECK (flag IS NULL OR flag IN ('dog', 'locked', 'nope', 'full', 'again', 'danger', 'info')),
  body TEXT NOT NULL DEFAULT '',
  rev TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  actor TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX idx_v5_notes_seq ON v5_notes(campaign_id, seq);
CREATE INDEX idx_v5_notes_area_seq ON v5_notes(campaign_id, area_id, seq);
CREATE TABLE v5_rooms (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  -- No foreign keys on the Gebiet and the Gruppe: the record has to outlive them; their names are copied.
  area_id TEXT NOT NULL,
  area_name TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  team_color TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'finished')),
  headcount INTEGER NOT NULL CHECK (headcount BETWEEN 1 AND 1000),
  -- link: only with the link or QR code; team: only members of the Gruppe (nobody new joins); password: link and password; open: the link alone, any Gruppe.
  join_mode TEXT NOT NULL CHECK (join_mode IN ('link', 'team', 'password', 'open')),
  join_secret TEXT NOT NULL,
  password_salt TEXT,
  password_hash TEXT,
  failed_joins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  started_by TEXT NOT NULL,
  -- The write counter of the Aktion when the room opened: houses marked done since then belong to this run.
  seq_start INTEGER NOT NULL,
  houses_total INTEGER,
  houses_done INTEGER,
  area_done INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_v5_rooms_active_area ON v5_rooms(campaign_id, area_id) WHERE status = 'active';
CREATE INDEX idx_v5_rooms_campaign ON v5_rooms(campaign_id, started_at);
CREATE TABLE v5_room_guests (
  room_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  label TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, grant_id),
  FOREIGN KEY (room_id) REFERENCES v5_rooms(id) ON DELETE CASCADE
);
CREATE INDEX idx_campaign_access_grants_room ON campaign_access_grants(room_id) WHERE room_id IS NOT NULL;
CREATE TABLE v5_area_stats (
  campaign_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  pack_version INTEGER NOT NULL,
  houses INTEGER NOT NULL,
  segments INTEGER NOT NULL,
  reported_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, unit_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX idx_v5_area_stats_area ON v5_area_stats(campaign_id, area_id);
INSERT INTO "campaigns" ("id", "name", "status", "revision", "write_token", "created_at", "updated_at", "map_center_lng", "map_center_lat", "map_zoom", "map_bearing", "organization_id", "admin_lifecycle_status", "window_starts_at", "window_ends_at") VALUES ('campaign_n', 'Network', 'active', 1, 'seed', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, 'active', NULL, NULL);
INSERT INTO "teams" ("id", "campaign_id", "name", "color", "created_at", "updated_at") VALUES ('team_n', 'campaign_n', 'Team', '#2563eb', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z');
INSERT INTO "teams" ("id", "campaign_id", "name", "color", "created_at", "updated_at") VALUES ('team_o', 'campaign_n', 'Other', '#ef4444', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z');
INSERT INTO "areas" ("id", "campaign_id", "team_id", "name", "geometry_json", "created_at", "updated_at") VALUES ('area_n', 'campaign_n', 'team_n', 'Area', '{"type":"Polygon","coordinates":[[[13,51],[13.01,51],[13.01,51.01],[13,51.01],[13,51]]]}', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z');
INSERT INTO "areas" ("id", "campaign_id", "team_id", "name", "geometry_json", "created_at", "updated_at") VALUES ('area_o', 'campaign_n', 'team_o', 'Other', '{"type":"Polygon","coordinates":[[[13.02,51],[13.03,51],[13.03,51.01],[13.02,51.01],[13.02,51]]]}', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z');
INSERT INTO "campaign_access_grants" ("id", "campaign_id", "role", "team_id", "token_hash", "label", "created_at", "revoked_at", "room_id") VALUES ('grant_48bb9483-5945-4602-a2bd-61f392595dde', 'campaign_n', 'admin', NULL, 'c9c9310e4821ab11b4c261c87405b6a784fb7f4bd03f85e7dbcd0306b3ba492d', 'admin', '2026-10-21T23:25:52.452Z', NULL, NULL);
INSERT INTO "campaign_access_grants" ("id", "campaign_id", "role", "team_id", "token_hash", "label", "created_at", "revoked_at", "room_id") VALUES ('grant_934c0cd5-2379-4cd6-aba8-a84b3d66020a', 'campaign_n', 'viewer', NULL, '2e84e5199309cf8dec9dfbe432c38d8582955080347a30a4c2376670c0b74a5c', 'viewer', '2026-10-21T23:25:52.455Z', NULL, NULL);
INSERT INTO "campaign_access_grants" ("id", "campaign_id", "role", "team_id", "token_hash", "label", "created_at", "revoked_at", "room_id") VALUES ('grant_d5f3ae6e-2079-4c26-8408-8b245738b731', 'campaign_n', 'team-editor', 'team_n', '545aaedec97484f8e306caac27f451fb8f1c6dc41d2c2e6ed0ba80ad119ca688', 'editor', '2026-10-21T23:25:52.457Z', NULL, NULL);
INSERT INTO "campaign_access_grants" ("id", "campaign_id", "role", "team_id", "token_hash", "label", "created_at", "revoked_at", "room_id") VALUES ('grant_0e6ed3fa-2073-4a01-8e76-c53ec1dad1b3', 'campaign_n', 'team-editor', 'team_o', '0bb2a39810238d7a59e33fb2f1a1e2c607a8517ddf5607bdc1dd5d36d052f079', 'other', '2026-10-21T23:25:52.461Z', NULL, NULL);
INSERT INTO "campaign_sessions" ("id", "grant_id", "campaign_id", "session_hash", "created_at", "expires_at") VALUES ('session_c7fc1555-e2dd-4cdc-a613-27afb6a33d85', 'grant_48bb9483-5945-4602-a2bd-61f392595dde', 'campaign_n', '4135c692ea4ea98b3acb6451240e414917d98db9b155363470c523da21ee74df', '2026-10-21T23:25:52.454Z', '2099-01-01T00:00:00.000Z');
INSERT INTO "campaign_sessions" ("id", "grant_id", "campaign_id", "session_hash", "created_at", "expires_at") VALUES ('session_cd5431c2-6b01-4444-844a-3c7338f211e0', 'grant_934c0cd5-2379-4cd6-aba8-a84b3d66020a', 'campaign_n', '77b3bea1dc7f8bfc4e0a9889c41082c06a4471bbe89c1cc11337a6bbfec8df68', '2026-10-21T23:25:52.456Z', '2099-01-01T00:00:00.000Z');
INSERT INTO "campaign_sessions" ("id", "grant_id", "campaign_id", "session_hash", "created_at", "expires_at") VALUES ('session_47b8a21d-82cc-4686-a72c-6c27190807df', 'grant_d5f3ae6e-2079-4c26-8408-8b245738b731', 'campaign_n', 'f5e2a5c739a418b555d6f8cbe9f019e09b5ef0e9ccd20bdd1eb4e5abe14b64c5', '2026-10-21T23:25:52.460Z', '2099-01-01T00:00:00.000Z');
INSERT INTO "campaign_sessions" ("id", "grant_id", "campaign_id", "session_hash", "created_at", "expires_at") VALUES ('session_0cb21931-f4db-4b61-a05d-bcff5f3a9fe2', 'grant_0e6ed3fa-2073-4a01-8e76-c53ec1dad1b3', 'campaign_n', '7a38a6b2a948c81dd94531b13ee151363f10a0d2ef81890d3a3a6654d280b47c', '2026-10-21T23:25:52.461Z', '2099-01-01T00:00:00.000Z');
PRAGMA foreign_keys=ON;
