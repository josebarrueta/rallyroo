-- Financial details, including amounts and categories, are encrypted with
-- the Family data key and never indexed in plaintext.
CREATE TABLE household_expenses (
  family_id text NOT NULL,
  id uuid NOT NULL,
  created_by_member_id text NOT NULL,
  spent_on date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (family_id, id)
);
CREATE INDEX household_expenses_recent_idx
  ON household_expenses (family_id, spent_on DESC, id DESC) WHERE deleted_at IS NULL;
