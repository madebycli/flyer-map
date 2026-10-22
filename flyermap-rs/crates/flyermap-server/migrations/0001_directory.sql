-- The directory of Flyer Map 6: who exists, how they sign in, what they may do. One D1 database; the Aktionen keep their own data in their own
-- Durable Objects. Times are milliseconds since the epoch. Binary values (keys, challenges) are stored as base64url text.

CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- A person has a sign-in name; a guest is a device that joined with an invitation and may become a person later.
CREATE TABLE persons (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'guest')),
  handle TEXT UNIQUE,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER,
  CHECK (kind = 'guest' OR handle IS NOT NULL)
);

CREATE TABLE passwords (
  person_id TEXT PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_person ON passkeys(person_id);

-- The second factor. The secret is sealed with the server key; `last_step` stops a code from being used twice.
CREATE TABLE totp (
  person_id TEXT PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
  secret_sealed TEXT NOT NULL,
  confirmed_at INTEGER,
  last_step INTEGER
);

CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  used_at INTEGER
);
CREATE INDEX recovery_person ON recovery_codes(person_id);

-- One row per signed-in device. Only the hash of the token is stored.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('passkey', 'password', 'invite', 'recovery', 'setup')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_person ON sessions(person_id);

-- What a person may do, and where. `scope_kind` and the ids say where (see flyermap-identity::Scope).
CREATE TABLE grants (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('organisation', 'aktion', 'gruppe', 'gebiet')),
  org_id TEXT NOT NULL,
  aktion_id TEXT,
  gruppe_id TEXT,
  gebiet_id TEXT,
  not_after INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  invite_id TEXT
);
CREATE INDEX grants_person ON grants(person_id);
CREATE INDEX grants_aktion ON grants(org_id, aktion_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('organisation', 'aktion', 'gruppe', 'gebiet')),
  org_id TEXT NOT NULL,
  aktion_id TEXT,
  gruppe_id TEXT,
  gebiet_id TEXT,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  not_after INTEGER,
  grant_ttl_ms INTEGER,
  label TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX invites_scope ON invites(org_id, aktion_id);

CREATE TABLE aktionen (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX aktionen_org ON aktionen(org_id);

-- Challenges handed to a browser for a passkey ceremony; each works once and for a few minutes.
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('passkey-register', 'passkey-sign-in')),
  person_id TEXT,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Failed attempts per key (hashed address, handle, invitation prefix): too many and the key is locked for a while.
CREATE TABLE throttle (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);

-- Who did what, in order. Never holds secrets or texts of the users.
CREATE TABLE audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT,
  org_id TEXT,
  aktion_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX audit_org ON audit(org_id, seq);
