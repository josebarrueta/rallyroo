ALTER TABLE imported_calendar_events
ADD COLUMN IF NOT EXISTS arrival_time timestamptz,
ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE imported_calendar_events
DROP CONSTRAINT IF EXISTS imported_calendar_events_arrival_time_check;
ALTER TABLE imported_calendar_events
ADD CONSTRAINT imported_calendar_events_arrival_time_check
CHECK (arrival_time IS NULL OR arrival_time <= start_time);

CREATE TABLE IF NOT EXISTS imported_event_settings (
  family_id text NOT NULL,
  event_id uuid NOT NULL,
  arrival_time timestamptz,
  alert_lead_time_minutes integer,
  PRIMARY KEY (family_id, event_id),
  CHECK (alert_lead_time_minutes IS NULL OR alert_lead_time_minutes IN (0, 5, 15, 30, 45, 60, 1440))
);

CREATE TABLE IF NOT EXISTS imported_event_notification_deliveries (
  family_id text NOT NULL,
  event_id uuid NOT NULL,
  occurrence_start timestamptz NOT NULL,
  notification_claimed_at timestamptz,
  notification_sent_at timestamptz,
  PRIMARY KEY (family_id, event_id, occurrence_start)
);
