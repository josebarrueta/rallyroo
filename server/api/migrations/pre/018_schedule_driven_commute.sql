-- Name: schedule_driven_commute.sql
-- Desc: add schedule-driven fields to commuter subscriptions, add schedule cache

-- Add optional schedule snapshot fields to subscriptions
ALTER TABLE commuter_subscriptions
  ADD COLUMN IF NOT EXISTS schedule_version TEXT,
  ADD COLUMN IF NOT EXISTS journey_id TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_departure_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS scheduled_arrival_minutes INTEGER;

-- Update schema to allow nullable schedule fields
COMMENT ON COLUMN commuter_subscriptions.schedule_version IS 'GTFS feed version bound to this subscription';
COMMENT ON COLUMN commuter_subscriptions.journey_id IS 'Stable SHA-256 journey id from static schedule';
COMMENT ON COLUMN commuter_subscriptions.scheduled_departure_minutes IS 'Origin departure minutes from static schedule';
COMMENT ON COLUMN commuter_subscriptions.scheduled_arrival_minutes IS 'Destination arrival minutes from static schedule';

-- Add schedule cache tables
CREATE TABLE IF NOT EXISTS commuter_caltrain_schedule (
  agency_id VARCHAR(4) NOT NULL PRIMARY KEY,
  version TEXT NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  tz TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS commuter_schedule_refresh_attempts (
  agency_id VARCHAR(4) NOT NULL,
  feed VARCHAR(16) NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL,
  succeeded BOOLEAN NOT NULL,
  PRIMARY KEY (agency_id, feed, attempted_at)
);

CREATE INDEX IF NOT EXISTS idx_schedule_refresh_attempts_agency_feed
  ON commuter_schedule_refresh_attempts(agency_id, feed);

-- Backfill schema constraints for schedule-driven subscriptions
-- Existing subscriptions remain valid; new fields are optional and remain NULL for legacy data
