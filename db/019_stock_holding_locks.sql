BEGIN;
ALTER TABLE internal_product_terms ADD COLUMN stock_holding_days integer NOT NULL DEFAULT 0
 CHECK (stock_holding_days BETWEEN 0 AND 3650),
 ADD COLUMN stock_market_priced boolean NOT NULL DEFAULT false;
ALTER TABLE internal_product_terms DROP CONSTRAINT internal_product_terms_check1,
 ADD CONSTRAINT internal_product_terms_buy_configuration CHECK
 (NOT trading_enabled OR ((stock_market_priced OR price_cents IS NOT NULL) AND participation_password_hash IS NOT NULL));
ALTER TABLE internal_product_terms_audit ADD COLUMN stock_holding_days integer
 CHECK (stock_holding_days BETWEEN 0 AND 3650);
ALTER TABLE internal_purchases ADD COLUMN stock_unlock_at timestamptz,
 ADD COLUMN stock_quote_at timestamptz,
 ADD COLUMN stock_quote_source text;
CREATE TABLE stock_position_locks (
 account_id uuid NOT NULL REFERENCES accounts(id),
 market varchar(2) NOT NULL,
 symbol varchar(24) NOT NULL,
 locked boolean NOT NULL,
 version integer NOT NULL CHECK (version>0),
 PRIMARY KEY(account_id,market,symbol)
);
CREATE TABLE stock_position_lock_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 actor_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
 market varchar(2) NOT NULL,
 symbol varchar(24) NOT NULL,
 locked boolean NOT NULL,
 version integer NOT NULL,
 reason varchar(400) NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stock_position_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_position_lock_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stock_position_locks,stock_position_lock_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE stock_position_lock_audit_id_seq FROM PUBLIC;
COMMIT;
