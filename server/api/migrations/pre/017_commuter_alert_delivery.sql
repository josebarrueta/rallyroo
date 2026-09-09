ALTER TABLE commuter_alert_outbox
ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE commuter_alert_outbox
SET expires_at = created_at + interval '3 minutes'
WHERE expires_at IS NULL;

ALTER TABLE commuter_alert_outbox
ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE commuter_alert_outbox
DROP CONSTRAINT IF EXISTS commuter_alert_outbox_status_check;

ALTER TABLE commuter_alert_outbox
ADD CONSTRAINT commuter_alert_outbox_status_check
CHECK (status IN ('pending', 'sending', 'delivered', 'failed'));

CREATE INDEX IF NOT EXISTS commuter_alert_outbox_stale_claim_idx
ON commuter_alert_outbox(claimed_at)
WHERE status = 'sending';
