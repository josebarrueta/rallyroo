-- Protect date-only Events during a rollback to an older API image. Such an
-- image does not know all_day and must not change its instants behind the saved
-- date-only bounds. Title-only edits remain compatible. A new client can move
-- dates by updating metadata and instants together, or explicitly set it NULL
-- when converting to a timed Event.
CREATE FUNCTION guard_all_day_event_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.all_day IS NOT NULL
     AND NEW.all_day IS NOT DISTINCT FROM OLD.all_day
     AND (NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'events_all_day_anchor_guard',
      MESSAGE = 'All-day date metadata must change with scheduling instants';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_all_day_anchor_guard
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION guard_all_day_event_anchor();
