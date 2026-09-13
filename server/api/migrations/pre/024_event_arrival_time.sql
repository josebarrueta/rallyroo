ALTER TABLE events
ADD COLUMN IF NOT EXISTS arrival_time timestamptz;

ALTER TABLE events
DROP CONSTRAINT IF EXISTS events_arrival_time_check;

ALTER TABLE events
ADD CONSTRAINT events_arrival_time_check
CHECK (arrival_time IS NULL OR arrival_time <= start_time);
