CREATE TABLE IF NOT EXISTS event_mutation_results (
  family_id text NOT NULL,
  idempotency_key uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS schedule_update_notifications (
  id uuid PRIMARY KEY,
  family_id text NOT NULL,
  event_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  participant_ids text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'sent')),
  claimed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (family_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS schedule_update_notifications_dispatch_idx
ON schedule_update_notifications (created_at, claimed_at)
WHERE status IN ('pending', 'claimed');
