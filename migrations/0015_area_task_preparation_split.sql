-- Independent Street and House preparation state.
-- Prepared only: do not apply remotely from application code.
PRAGMA foreign_keys = ON;

ALTER TABLE area_task_preparations
  ADD COLUMN street_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (street_status IN ('pending', 'ready', 'failed'));

ALTER TABLE area_task_preparations
  ADD COLUMN house_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (house_status IN ('pending', 'ready', 'failed'));

ALTER TABLE area_task_preparations
  ADD COLUMN street_source_timestamp TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN house_source_timestamp TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN street_started_at TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN house_started_at TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN street_ready_at TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN house_ready_at TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN street_failed_at TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN house_failed_at TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN street_error_code TEXT;

ALTER TABLE area_task_preparations
  ADD COLUMN house_error_code TEXT;

UPDATE area_task_preparations
SET
  street_status = status,
  house_status = status,
  street_source_timestamp = source_timestamp,
  house_source_timestamp = source_timestamp,
  street_started_at = started_at,
  house_started_at = started_at,
  street_ready_at = ready_at,
  house_ready_at = ready_at,
  street_failed_at = failed_at,
  house_failed_at = failed_at,
  street_error_code = last_error_code,
  house_error_code = last_error_code;
