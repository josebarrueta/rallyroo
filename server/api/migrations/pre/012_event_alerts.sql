ALTER TABLE events
ADD COLUMN IF NOT EXISTS alert_lead_time_minutes integer;

ALTER TABLE events
DROP CONSTRAINT IF EXISTS events_alert_lead_time_minutes_check;

ALTER TABLE events
ADD CONSTRAINT events_alert_lead_time_minutes_check
CHECK (alert_lead_time_minutes IS NULL OR alert_lead_time_minutes IN (0, 5, 15, 60, 1440));

CREATE TABLE IF NOT EXISTS event_notification_deliveries (
  family_id text NOT NULL,
  event_id uuid NOT NULL,
  occurrence_start timestamptz NOT NULL,
  notification_claimed_at timestamptz,
  notification_sent_at timestamptz,
  PRIMARY KEY (family_id, event_id, occurrence_start),
  FOREIGN KEY (family_id, event_id) REFERENCES events(family_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS events_pending_alerts_idx
ON events(start_time, alert_lead_time_minutes)
WHERE alert_lead_time_minutes IS NOT NULL;
