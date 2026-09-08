CREATE TABLE IF NOT EXISTS family_data_keys (
  family_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  wrapped_key text NOT NULL CHECK (length(wrapped_key) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  PRIMARY KEY (family_id, version),
  CHECK ((active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS family_data_keys_one_active_idx
ON family_data_keys(family_id)
WHERE active;

ALTER TABLE event_mutation_results
ADD COLUMN IF NOT EXISTS result_ciphertext text;

ALTER TABLE event_mutation_results
ALTER COLUMN result DROP NOT NULL;

ALTER TABLE event_mutation_results
DROP CONSTRAINT IF EXISTS event_mutation_results_one_payload;

ALTER TABLE event_mutation_results
ADD CONSTRAINT event_mutation_results_one_payload CHECK (
  (result IS NOT NULL AND result_ciphertext IS NULL)
  OR (result IS NULL AND result_ciphertext IS NOT NULL)
);
