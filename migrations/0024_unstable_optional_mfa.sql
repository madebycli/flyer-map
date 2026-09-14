-- Unstable-only account preference: allow password-only login when explicitly disabled.
-- Stable does not include this migration or behavior.
PRAGMA foreign_keys = ON;

ALTER TABLE organization_accounts
  ADD COLUMN mfa_required INTEGER NOT NULL DEFAULT 1 CHECK (mfa_required IN (0, 1));
