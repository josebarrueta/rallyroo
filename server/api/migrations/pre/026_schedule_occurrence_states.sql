-- Durable lifecycle state for logical Event and Reminder occurrences.
-- Untouched occurrences remain virtual products of their recurrence series; a row
-- is materialized when acknowledgement, disposition, completion, or override
-- state diverges from the scheduled default.
CREATE TABLE IF NOT EXISTS schedule_occurrence_states (
  family_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('event', 'reminder')),
  series_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  disposition text NOT NULL DEFAULT 'scheduled'
    CHECK (disposition IN ('scheduled', 'skipped', 'deleted')),
  acknowledged_member_ids text[] NOT NULL DEFAULT '{}',
  override_entity_id uuid,
  completed_at timestamptz,
  completed_by_member_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, kind, series_id, scheduled_at),
  CHECK ((completed_at IS NULL) = (completed_by_member_id IS NULL)),
  CHECK (kind = 'reminder' OR completed_at IS NULL)
);

CREATE INDEX IF NOT EXISTS schedule_occurrence_states_family_window_idx
  ON schedule_occurrence_states (family_id, scheduled_at);
