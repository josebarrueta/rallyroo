CREATE TABLE day_brief_preferences (
  family_id text NOT NULL,
  member_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  time_zone text NOT NULL,
  weekday_time time NOT NULL DEFAULT '07:00',
  weekend_holiday_time time NOT NULL DEFAULT '08:30',
  early_event_lead_minutes integer NOT NULL DEFAULT 60
    CHECK (early_event_lead_minutes >= 0 AND early_event_lead_minutes <= 240),
  holiday_region text NOT NULL
    CHECK (length(holiday_region) BETWEEN 2 AND 10),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, member_id),
  FOREIGN KEY (family_id, member_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE
);

CREATE TABLE day_briefs (
  family_id text NOT NULL,
  member_id text NOT NULL,
  local_date date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  PRIMARY KEY (family_id, member_id, local_date),
  FOREIGN KEY (family_id, member_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE
);

CREATE INDEX day_briefs_generated_at_idx
ON day_briefs(generated_at DESC);

ALTER TABLE member_notification_inbox
  DROP CONSTRAINT member_notification_inbox_kind_check;

ALTER TABLE member_notification_inbox
  ADD CONSTRAINT member_notification_inbox_kind_check
  CHECK (kind IN (
     'event_occurrence', 'reminder_occurrence', 'schedule_update',
     'commute_disruption', 'driver_assignment', 'saved_conflict',
     'leave_time', 'day_brief'
  ));
