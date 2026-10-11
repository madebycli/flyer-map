-- v5: the time window of a distribution Aktion (start and end), shown as a countdown. Additive and optional: both stay NULL until an admin sets them.
ALTER TABLE campaigns ADD COLUMN window_starts_at TEXT;
ALTER TABLE campaigns ADD COLUMN window_ends_at TEXT;
