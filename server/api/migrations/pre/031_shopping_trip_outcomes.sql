ALTER TABLE shopping_trip_plans
  DROP CONSTRAINT shopping_trip_plans_status_check;
ALTER TABLE shopping_trip_plans
  ADD CONSTRAINT shopping_trip_plans_status_check
    CHECK (status IN ('draft', 'finalized', 'completed'));
ALTER TABLE shopping_trip_plans
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_by_member_id text;
ALTER TABLE shopping_trip_plans
  DROP CONSTRAINT shopping_trip_plans_check;
ALTER TABLE shopping_trip_plans
  ADD CONSTRAINT shopping_trip_plans_lifecycle_check CHECK (
    (status = 'draft' AND finalized_at IS NULL AND finalized_by_member_id IS NULL
      AND completed_at IS NULL AND completed_by_member_id IS NULL)
    OR (status = 'finalized' AND finalized_at IS NOT NULL AND finalized_by_member_id IS NOT NULL
      AND completed_at IS NULL AND completed_by_member_id IS NULL)
    OR (status = 'completed' AND finalized_at IS NOT NULL AND finalized_by_member_id IS NOT NULL
      AND completed_at IS NOT NULL AND completed_by_member_id IS NOT NULL)
  );

CREATE TABLE shopping_purchases (
  family_id text NOT NULL,
  trip_id uuid NOT NULL,
  pantry_item_id uuid NOT NULL,
  purchased_at timestamptz NOT NULL,
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  PRIMARY KEY (family_id, trip_id, pantry_item_id),
  FOREIGN KEY (family_id, trip_id, pantry_item_id)
    REFERENCES shopping_trip_plan_items(family_id, trip_id, pantry_item_id) ON DELETE RESTRICT
);

CREATE INDEX shopping_purchases_recent_idx
ON shopping_purchases(family_id, purchased_at DESC, trip_id DESC, pantry_item_id DESC);
