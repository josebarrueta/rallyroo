-- Track Reminder notification delivery per occurrence so recurring series can alert repeatedly.
CREATE TABLE IF NOT EXISTS reminder_notification_deliveries (
  family_id text NOT NULL,
  reminder_id uuid NOT NULL,
  occurrence_due timestamptz NOT NULL,
  notification_claimed_at timestamptz,
  notification_sent_at timestamptz,
  PRIMARY KEY (family_id, reminder_id, occurrence_due),
  FOREIGN KEY (family_id, reminder_id)
    REFERENCES family_reminders(family_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reminder_notification_deliveries_pending_idx
  ON reminder_notification_deliveries(occurrence_due)
  WHERE notification_sent_at IS NULL;

-- Preserve the prior one-delivery state as the series anchor occurrence. This
-- prevents a recently sent one-time Reminder from being replayed at rollout.
INSERT INTO reminder_notification_deliveries (
  family_id, reminder_id, occurrence_due, notification_sent_at
)
SELECT family_id, id, due_at, notification_sent_at
FROM family_reminders
WHERE notification_sent_at IS NOT NULL
ON CONFLICT (family_id, reminder_id, occurrence_due) DO NOTHING;

COMMENT ON TABLE reminder_notification_deliveries IS
  'Per-occurrence claim and delivery state for one-time and recurring Reminder alerts.';
