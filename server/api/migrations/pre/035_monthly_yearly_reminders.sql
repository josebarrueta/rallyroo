-- Migration 035: Calendar-based recurring reminders
-- Monthly and yearly reminder series preserve their original local calendar
-- date and wall-clock time. Short months use their final valid day.

ALTER TABLE family_reminders
  DROP CONSTRAINT family_reminders_recurrence_frequency_check;

ALTER TABLE family_reminders
  ALTER COLUMN recurrence_frequency DROP NOT NULL,
  ALTER COLUMN recurrence_frequency DROP DEFAULT,
  ADD COLUMN recurrence_time_zone text,
  ADD CONSTRAINT family_reminders_recurrence_frequency_check
    CHECK (recurrence_frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')),
  ADD CONSTRAINT family_reminders_calendar_recurrence_time_zone_check
    CHECK (recurrence_frequency NOT IN ('monthly', 'yearly') OR recurrence_time_zone IS NOT NULL);

-- Before recurrence_frequency became nullable, one-time reminders were stored
-- with the legacy default of weekly and no selected weekdays.
UPDATE family_reminders
SET recurrence_frequency = NULL
WHERE recurrence_weekdays = '{}'
  AND recurrence_series_id IS NULL;

COMMENT ON COLUMN family_reminders.recurrence_frequency IS
  'NULL on one-time reminders; frequency on recurring series templates';
COMMENT ON COLUMN family_reminders.recurrence_time_zone IS
  'IANA time zone used to preserve recurring reminder calendar dates and wall-clock times';
