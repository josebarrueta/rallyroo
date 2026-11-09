-- Client names/UIDs may be low-entropy Family text. Unkeyed equality hashes
-- permit offline guessing and are not needed by any lookup. Resource uniqueness
-- is checked against the decrypted snapshot under the shared Family mutation
-- lock; retain only opaque Event identity and encrypted representation at rest.
-- DROP COLUMN also removes the old name/UID hash indexes and constraints.
ALTER TABLE calendar_resources DROP COLUMN name_hash, DROP COLUMN uid_hash;
ALTER TABLE calendar_resources DROP CONSTRAINT calendar_resources_family_id_event_id_key;
ALTER TABLE calendar_resources ADD PRIMARY KEY (family_id, event_id);
