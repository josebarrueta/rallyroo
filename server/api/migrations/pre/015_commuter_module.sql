CREATE TABLE IF NOT EXISTS commuter_installations (
  family_id text PRIMARY KEY,
  enabled_by_member_id text NOT NULL,
  status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commuter_subscriptions (
  id uuid PRIMARY KEY,
  family_id text NOT NULL REFERENCES commuter_installations(family_id) ON DELETE CASCADE,
  owner_member_id text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('personal', 'family')),
  status text NOT NULL CHECK (status IN ('active', 'paused')),
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (family_id, owner_member_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE,
  UNIQUE (family_id, id)
);

CREATE INDEX IF NOT EXISTS commuter_subscriptions_family_idx
ON commuter_subscriptions(family_id, status);

CREATE TABLE IF NOT EXISTS commuter_alert_outbox (
  id uuid PRIMARY KEY,
  family_id text NOT NULL,
  subscription_id uuid NOT NULL,
  condition_digest text NOT NULL CHECK (length(condition_digest) = 64),
  kind text NOT NULL CHECK (kind IN ('delay', 'cancellation')),
  details_ciphertext text NOT NULL CHECK (details_ciphertext LIKE 'rr1.%'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'delivered')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, subscription_id, condition_digest, kind),
  FOREIGN KEY (family_id, subscription_id)
    REFERENCES commuter_subscriptions(family_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commuter_alert_outbox_due_idx
ON commuter_alert_outbox(next_attempt_at, created_at)
WHERE status = 'pending';
