CREATE TABLE IF NOT EXISTS cn_support_messages (
  id uuid PRIMARY KEY,
  client_user_id uuid NOT NULL REFERENCES app_users(id),
  sender_user_id uuid NOT NULL REFERENCES app_users(id),
  sender_role text NOT NULL CHECK (sender_role IN ('MASTER','SUBADMIN','CLIENT')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cn_support_messages_client_time_idx ON cn_support_messages(client_user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS cn_commodity_drafts (
  id uuid PRIMARY KEY,
  symbol text NOT NULL,
  market text NOT NULL CHECK (market IN ('US','METALS','ENERGY','OTHER')),
  discount_bps integer NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  holding_days integer NOT NULL CHECK (holding_days>=0),
  min_quantity integer NOT NULL CHECK (min_quantity>=1),
  requested_visible boolean NOT NULL,
  trade_password_hash text,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
