CREATE TABLE shopping_trip_plans (
  family_id text NOT NULL,
  id uuid NOT NULL,
  routine_id uuid NOT NULL,
  planned_for date NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'finalized')),
  version integer NOT NULL CHECK (version >= 1),
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  created_by_member_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finalized_at timestamptz,
  finalized_by_member_id text,
  PRIMARY KEY (family_id, id),
  UNIQUE (family_id, routine_id, planned_for),
  FOREIGN KEY (family_id, routine_id)
    REFERENCES shopping_routines(family_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (family_id, created_by_member_id)
    REFERENCES family_members(family_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'draft' AND finalized_at IS NULL AND finalized_by_member_id IS NULL)
    OR (status = 'finalized' AND finalized_at IS NOT NULL AND finalized_by_member_id IS NOT NULL)
  )
);

CREATE INDEX shopping_trip_plans_family_order_idx
ON shopping_trip_plans(family_id, planned_for DESC, id DESC);

CREATE TABLE shopping_trip_plan_items (
  family_id text NOT NULL,
  trip_id uuid NOT NULL,
  pantry_item_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (family_id, trip_id, pantry_item_id),
  UNIQUE (family_id, trip_id, position),
  FOREIGN KEY (family_id, trip_id)
    REFERENCES shopping_trip_plans(family_id, id) ON DELETE CASCADE,
  FOREIGN KEY (family_id, pantry_item_id)
    REFERENCES pantry_items(family_id, id) ON DELETE RESTRICT
);
