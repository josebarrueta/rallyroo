CREATE TABLE member_notification_inbox (
  id uuid PRIMARY KEY,
  family_id text NOT NULL,
  member_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'event_occurrence', 'reminder_occurrence', 'schedule_update',
    'commute_disruption', 'driver_assignment', 'saved_conflict'
  )),
  deduplication_digest text NOT NULL CHECK (length(deduplication_digest) = 64),
  occurred_at timestamptz NOT NULL,
  read_at timestamptz,
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (family_id, member_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE,
  UNIQUE (family_id, member_id, deduplication_digest)
);

CREATE INDEX member_notification_inbox_member_idx
ON member_notification_inbox(family_id, member_id, occurred_at DESC, id);
