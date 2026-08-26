-- M6 Smart Street source provenance.
-- Existing/manual Street Tasks remain valid with NULL source_json.
-- Reviewed Smart Street geometry continues to live in geometry_json; this column
-- stores source traceability only and must never be treated as Task identity.
ALTER TABLE tasks
  ADD COLUMN source_json TEXT
  CHECK (source_json IS NULL OR json_valid(source_json));
