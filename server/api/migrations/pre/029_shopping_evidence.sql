CREATE TABLE shopping_item_requests (
  family_id text NOT NULL,
  id uuid NOT NULL,
  pantry_item_id uuid NOT NULL,
  requested_by_member_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'resolved', 'cancelled')),
  requested_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by_member_id text,
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  PRIMARY KEY (family_id, id),
  FOREIGN KEY (family_id, pantry_item_id)
    REFERENCES pantry_items(family_id, id) ON DELETE CASCADE,
  FOREIGN KEY (family_id, requested_by_member_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'open' AND resolved_at IS NULL AND resolved_by_member_id IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL AND resolved_by_member_id IS NOT NULL)
  )
);

CREATE INDEX shopping_item_requests_open_idx
ON shopping_item_requests(family_id, requested_at, id)
WHERE status = 'open';

CREATE TABLE stock_observations (
  family_id text NOT NULL,
  id uuid NOT NULL,
  pantry_item_id uuid NOT NULL,
  observed_by_member_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('enough', 'low', 'out')),
  observed_at timestamptz NOT NULL,
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  PRIMARY KEY (family_id, id),
  FOREIGN KEY (family_id, pantry_item_id)
    REFERENCES pantry_items(family_id, id) ON DELETE CASCADE,
  FOREIGN KEY (family_id, observed_by_member_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE
);

CREATE INDEX stock_observations_latest_idx
ON stock_observations(family_id, pantry_item_id, observed_at DESC, id DESC);
