CREATE TABLE saved_places (
  family_id text NOT NULL,
  id uuid NOT NULL,
  owner_member_id text,
  visibility text NOT NULL CHECK (visibility IN ('family', 'personal')),
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, id),
  FOREIGN KEY (family_id, owner_member_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE,
  CHECK (
    (visibility = 'family' AND owner_member_id IS NULL)
    OR (visibility = 'personal' AND owner_member_id IS NOT NULL)
  )
);

CREATE INDEX saved_places_visible_idx
ON saved_places(family_id, visibility, owner_member_id, updated_at DESC);

CREATE TABLE event_travel_plans (
  family_id text NOT NULL,
  event_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  saved_place_id uuid,
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  created_by_member_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, event_id),
  FOREIGN KEY (family_id, event_id)
    REFERENCES events(family_id, id) ON DELETE CASCADE,
  FOREIGN KEY (family_id, saved_place_id)
    REFERENCES saved_places(family_id, id) ON DELETE CASCADE,
  FOREIGN KEY (family_id, created_by_member_id)
    REFERENCES family_members(family_id, id)
);

ALTER TABLE member_notification_inbox
  DROP CONSTRAINT member_notification_inbox_kind_check;

ALTER TABLE member_notification_inbox
  ADD CONSTRAINT member_notification_inbox_kind_check
  CHECK (kind IN (
    'event_occurrence', 'reminder_occurrence', 'schedule_update',
    'commute_disruption', 'driver_assignment', 'saved_conflict', 'leave_time'
  ));
