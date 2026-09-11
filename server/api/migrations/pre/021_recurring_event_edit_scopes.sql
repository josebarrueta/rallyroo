ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recurrence_series_id uuid;

UPDATE events
SET recurrence_series_id = id
WHERE recurrence IS NOT NULL
  AND recurrence_series_id IS NULL;

CREATE INDEX IF NOT EXISTS events_family_recurrence_series_idx
  ON events (family_id, recurrence_series_id)
  WHERE recurrence_series_id IS NOT NULL;
