CREATE TABLE commuter_caltrain_schedule (
  agency_id text PRIMARY KEY CHECK (agency_id = 'CT'),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 200),
  observed_at timestamptz NOT NULL,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  time_zone text NOT NULL CHECK (time_zone = 'America/Los_Angeles'),
  schedule jsonb NOT NULL,
  CHECK (valid_until >= valid_from),
  CHECK (jsonb_typeof(schedule) = 'object')
);
