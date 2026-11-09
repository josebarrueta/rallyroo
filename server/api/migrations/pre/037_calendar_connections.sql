-- Opt-in CalDAV credentials contain only verifiers, never plaintext passwords.
CREATE TABLE IF NOT EXISTS calendar_connections (
  id uuid PRIMARY KEY,
  identity_subject text NOT NULL REFERENCES accounts(identity_subject) ON DELETE CASCADE,
  family_id text NOT NULL,
  member_id text NOT NULL,
  password_hash text NOT NULL CHECK (password_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_connections_owner_idx ON calendar_connections(identity_subject);

-- Client-selected hrefs, UIDs and iCalendar properties are protected Family details.
-- Only equality hashes and the opaque native Event identity are queryable.
CREATE TABLE IF NOT EXISTS calendar_resources (
  family_id text NOT NULL,
  event_id uuid NOT NULL,
  name_hash text NOT NULL,
  uid_hash text NOT NULL,
  details_ciphertext text NOT NULL,
  PRIMARY KEY (family_id, name_hash),
  UNIQUE (family_id, uid_hash),
  UNIQUE (family_id, event_id),
  FOREIGN KEY (family_id, event_id) REFERENCES events(family_id, id) ON DELETE CASCADE
);
