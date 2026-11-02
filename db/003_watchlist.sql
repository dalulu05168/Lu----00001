-- User-owned watchlists. Does not represent holdings or security ownership.
BEGIN;
CREATE TABLE watchlist_items (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  market varchar(2) NOT NULL CHECK (market IN ('US','HK','CN','MY')),
  symbol varchar(24) NOT NULL CHECK (symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,23}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,market,symbol)
);
CREATE INDEX watchlist_account_created_idx ON watchlist_items(account_id,created_at DESC);
COMMIT;
