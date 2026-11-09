-- Date-only values are scheduling metadata, not protected Family text.
-- Keep them separate from canonical instants so device time-zone changes cannot
-- turn an all-day Event into an overnight timed Event.
ALTER TABLE events ADD COLUMN IF NOT EXISTS all_day jsonb;
ALTER TABLE events ADD CONSTRAINT events_all_day_dates_check CHECK (
  all_day IS NULL OR (
    jsonb_typeof(all_day) = 'object'
    AND all_day ?& ARRAY['startDate', 'endDate', 'timeZone']
    AND (all_day - ARRAY['startDate', 'endDate', 'timeZone']) = '{}'::jsonb
    AND jsonb_typeof(all_day->'startDate') = 'string'
    AND jsonb_typeof(all_day->'endDate') = 'string'
    AND jsonb_typeof(all_day->'timeZone') = 'string'
    AND all_day->>'startDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND all_day->>'endDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND (all_day->>'endDate')::date > (all_day->>'startDate')::date
    AND char_length(all_day->>'timeZone') BETWEEN 1 AND 100
    AND recurrence IS NULL AND recurrence_series_id IS NULL
  )
);

-- The connection's selected zone anchors newly created date-only Events and
-- floating-date report ranges; an existing Event keeps its own stable anchor.
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE calendar_connections ADD CONSTRAINT calendar_connections_time_zone_check
  CHECK (char_length(time_zone) BETWEEN 1 AND 100);
