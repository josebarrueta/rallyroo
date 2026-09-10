ALTER TABLE family_members
ADD COLUMN IF NOT EXISTS can_drive boolean NOT NULL DEFAULT false;

ALTER TABLE events
ADD COLUMN IF NOT EXISTS driver_member_id text;

ALTER TABLE events
DROP CONSTRAINT IF EXISTS events_driver_member_fk;

ALTER TABLE events
ADD CONSTRAINT events_driver_member_fk
FOREIGN KEY (family_id, driver_member_id)
REFERENCES family_members(family_id, id)
ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS events_driver_member_idx
ON events(family_id, driver_member_id, start_time)
WHERE driver_member_id IS NOT NULL;
