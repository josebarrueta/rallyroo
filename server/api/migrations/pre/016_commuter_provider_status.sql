CREATE TABLE IF NOT EXISTS commuter_provider_feeds (
  agency_id text NOT NULL CHECK (agency_id = 'CT'),
  feed text NOT NULL CHECK (feed IN ('catalog', 'realtime')),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_attempt_succeeded boolean,
  PRIMARY KEY (agency_id, feed),
  CHECK (last_success_at IS NULL OR last_attempt_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS commuter_caltrain_catalog (
  agency_id text PRIMARY KEY CHECK (agency_id = 'CT'),
  observed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS commuter_caltrain_stops (
  id text PRIMARY KEY,
  agency_id text NOT NULL REFERENCES commuter_caltrain_catalog(agency_id) ON DELETE CASCADE,
  station_id text NOT NULL,
  station_name text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('northbound', 'southbound', 'unknown')),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  CHECK (valid_until >= valid_from)
);

CREATE INDEX IF NOT EXISTS commuter_caltrain_stops_station_idx
ON commuter_caltrain_stops(station_id, direction, id);
