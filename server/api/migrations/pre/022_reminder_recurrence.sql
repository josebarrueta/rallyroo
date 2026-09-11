-- Migration 022: Weekly recurring reminders
-- Add recurrence configuration and series linkage to family_reminders.
-- One-time reminders keep recurrence = NULL; series templates store the
-- frequency, interval, weekdays, and end date in a JSON column.
-- Occurrence completion state lives in the same table — each concrete
-- occurrence has its own id (series-id epoch), status, completedAt, and
-- completedByMemberID, independent of sibling occurrences.

ALTER TABLE family_reminders
  ADD COLUMN recurrence_frequency text NOT NULL DEFAULT 'weekly'
    CHECK (recurrence_frequency IN ('weekly', 'biweekly')),
    ADD COLUMN recurrence_interval integer NOT NULL DEFAULT 1
       CHECK (recurrence_interval >= 1),
    ADD COLUMN recurrence_weekdays integer[] NOT NULL DEFAULT '{}',
    ADD COLUMN recurrence_end_date timestamptz,
    ADD COLUMN recurrence_series_id uuid;

-- Index to make occurrence-expansion and series deletion efficient.
CREATE INDEX IF NOT EXISTS family_reminders_recurrence_series_id_idx
  ON family_reminders (recurrence_series_id)
  WHERE recurrence_series_id IS NOT NULL;

-- A series template row itself has recurrence_end_date set; occurrence rows
-- (which are concrete expansions) also get recurrence_series_id but
-- recurrence_end_date may be NULL (occurrences are concrete, not series).
-- The check that prevents accidental series-without-end uses:
-- a series template has recurrence_end_date; an occurrence row has
-- recurrence_series_id IS NOT NULL AND recurrence_end_date IS NULL and
-- the series template with that id has recurrence_end_date set.
-- This is enforced at the application layer, not in SQL.

COMMENT ON COLUMN family_reminders.recurrence_frequency IS
  'NULL on occurrence rows; "weekly" or "biweekly" on series templates';
COMMENT ON COLUMN family_reminders.recurrence_series_id IS
  'The series template id; set on both the template and concrete occurrence rows';
