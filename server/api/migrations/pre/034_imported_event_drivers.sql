ALTER TABLE imported_event_settings
ADD COLUMN IF NOT EXISTS driver text,
ADD COLUMN IF NOT EXISTS driver_member_id text;

ALTER TABLE imported_event_settings
DROP CONSTRAINT IF EXISTS imported_event_settings_driver_choice_check;
ALTER TABLE imported_event_settings
ADD CONSTRAINT imported_event_settings_driver_choice_check
CHECK (driver IS NULL OR driver_member_id IS NULL);

ALTER TABLE imported_event_settings
DROP CONSTRAINT IF EXISTS imported_event_settings_driver_member_fk;
ALTER TABLE imported_event_settings
ADD CONSTRAINT imported_event_settings_driver_member_fk
FOREIGN KEY (family_id, driver_member_id)
REFERENCES family_members(family_id, id)
ON DELETE RESTRICT;
