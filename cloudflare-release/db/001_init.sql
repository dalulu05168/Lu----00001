-- PostgreSQL 15+; internal-only accounting, not broker assets
BEGIN;
CREATE TABLE app_users (
 id uuid PRIMARY KEY,
 email text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL UNIQUE REFERENCES app_users(id),
 base_currency char(3) NOT NULL DEFAULT 'USD' CHECK (base_currency='USD'),
 cash_cents bigint NOT NULL DEFAULT 0 CHECK (cash_cents>=0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE positions (
 account_id uuid NOT NULL REFERENCES accounts(id),
 market varchar(2) NOT NULL CHECK (market IN ('US','HK','CN','MY')),
 symbol varchar(24) NOT NULL,
 quantity bigint NOT NULL DEFAULT 0 CHECK (quantity>=0),
 PRIMARY KEY(account_id,market,symbol)
);
CREATE TABLE orders (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 idempotency_key varchar(128) NOT NULL,
 market varchar(2) NOT NULL CHECK (market IN ('US','HK','CN','MY')),
 symbol varchar(24) NOT NULL,
 side varchar(4) NOT NULL CHECK (side IN ('BUY','SELL')),
 quantity bigint NOT NULL CHECK (quantity>0),
 price_cents bigint NOT NULL CHECK (price_cents>0),
 fx_usd_micros bigint NOT NULL CHECK (fx_usd_micros>0),
 amount_usd_cents bigint NOT NULL CHECK (amount_usd_cents>0),
 execution_type text NOT NULL DEFAULT 'INTERNAL_ONLY' CHECK (execution_type='INTERNAL_ONLY'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,idempotency_key)
);
CREATE TABLE cash_ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 order_id uuid UNIQUE REFERENCES orders(id),
 delta_cents bigint NOT NULL CHECK (delta_cents<>0),
 balance_after_cents bigint NOT NULL CHECK (balance_after_cents>=0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_account_created_idx ON orders(account_id,created_at DESC);
CREATE INDEX cash_ledger_account_created_idx ON cash_ledger(account_id,created_at DESC);
COMMIT;
