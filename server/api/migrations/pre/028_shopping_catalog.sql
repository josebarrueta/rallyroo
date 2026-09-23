CREATE TABLE shopping_routines (
  family_id text NOT NULL,
  id uuid NOT NULL,
  interval_weeks integer NOT NULL CHECK (interval_weeks BETWEEN 1 AND 52),
  preferred_weekday integer CHECK (preferred_weekday BETWEEN 1 AND 7),
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  created_by_member_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (family_id, id),
  FOREIGN KEY (family_id, created_by_member_id)
    REFERENCES family_members(family_id, id) ON DELETE RESTRICT
);

CREATE INDEX shopping_routines_family_order_idx
ON shopping_routines(family_id, created_at, id);

CREATE TABLE pantry_items (
  family_id text NOT NULL,
  id uuid NOT NULL,
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  created_by_member_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (family_id, id),
  FOREIGN KEY (family_id, created_by_member_id)
    REFERENCES family_members(family_id, id) ON DELETE RESTRICT
);

CREATE INDEX pantry_items_family_order_idx
ON pantry_items(family_id, created_at, id);

CREATE TABLE pantry_item_routines (
  family_id text NOT NULL,
  pantry_item_id uuid NOT NULL,
  routine_id uuid NOT NULL,
  PRIMARY KEY (family_id, pantry_item_id, routine_id),
  FOREIGN KEY (family_id, pantry_item_id)
    REFERENCES pantry_items(family_id, id) ON DELETE CASCADE,
  FOREIGN KEY (family_id, routine_id)
    REFERENCES shopping_routines(family_id, id) ON DELETE CASCADE
);

CREATE INDEX pantry_item_routines_routine_idx
ON pantry_item_routines(family_id, routine_id, pantry_item_id);
