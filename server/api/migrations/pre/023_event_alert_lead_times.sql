ALTER TABLE events
DROP CONSTRAINT IF EXISTS events_alert_lead_time_minutes_check;

ALTER TABLE events
ADD CONSTRAINT events_alert_lead_time_minutes_check
CHECK (alert_lead_time_minutes IS NULL OR alert_lead_time_minutes IN (0, 5, 15, 30, 45, 60, 1440));
