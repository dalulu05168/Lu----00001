-- Opt-in internal purchases only; no existing balance, product, or order is updated.
BEGIN;
CREATE TABLE internal_product_terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 commodity_id uuid UNIQUE REFERENCES commodity_products(id),
 listing_id uuid UNIQUE REFERENCES listings(id),
 price_cents bigint CHECK(price_cents BETWEEN 1 AND 1000000000000),
 discount_bps integer NOT NULL DEFAULT 0 CHECK(discount_bps BETWEEN 0 AND 9999),
 trading_enabled boolean NOT NULL DEFAULT false,
 participation_password_hash text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(commodity_id,listing_id)=1),
 CHECK(NOT trading_enabled OR (price_cents IS NOT NULL AND participation_password_hash IS NOT NULL))
);
CREATE TABLE internal_purchases (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 terms_id uuid NOT NULL REFERENCES internal_product_terms(id),
 idempotency_key varchar(128) NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0),
 original_price_cents bigint NOT NULL CHECK(original_price_cents>0),
 discount_bps integer NOT NULL CHECK(discount_bps BETWEEN 0 AND 9999),
 unit_price_cents bigint NOT NULL CHECK(unit_price_cents>0),
 total_cents bigint NOT NULL CHECK(total_cents>0),
 terms_version integer NOT NULL,
 product_name text NOT NULL,
 product_code text NOT NULL,
 item_type text NOT NULL,
 execution_type text NOT NULL DEFAULT 'INTERNAL_ONLY' CHECK(execution_type='INTERNAL_ONLY'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,idempotency_key)
);
CREATE TABLE internal_product_terms_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 terms_id uuid NOT NULL REFERENCES internal_product_terms(id),
 actor_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
 version integer NOT NULL,
 price_cents bigint,
 discount_bps integer NOT NULL,
 trading_enabled boolean NOT NULL,
 password_changed boolean NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE internal_product_positions (
 account_id uuid NOT NULL REFERENCES accounts(id),
 terms_id uuid NOT NULL REFERENCES internal_product_terms(id),
 quantity bigint NOT NULL CHECK(quantity>0),
 cost_cents bigint NOT NULL CHECK(cost_cents>0),
 PRIMARY KEY(account_id,terms_id)
);
CREATE TABLE internal_purchase_attempts (
 account_id uuid PRIMARY KEY REFERENCES accounts(id),
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 5),
 blocked_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cash_ledger ADD COLUMN internal_purchase_id uuid UNIQUE REFERENCES internal_purchases(id);
ALTER TABLE cash_ledger ADD CONSTRAINT cash_ledger_internal_single_source
 CHECK(num_nonnulls(order_id,funding_request_id,internal_purchase_id)<=1);
CREATE INDEX internal_purchases_account_time_idx ON internal_purchases(account_id,created_at DESC);
ALTER TABLE internal_product_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_product_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_purchase_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_product_terms_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal_product_terms,internal_purchases,internal_product_positions,internal_purchase_attempts,internal_product_terms_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE internal_product_terms_audit_id_seq FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON internal_product_terms,internal_purchases,internal_product_positions,internal_purchase_attempts,internal_product_terms_audit FROM anon;
  REVOKE ALL ON SEQUENCE internal_product_terms_audit_id_seq FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON internal_product_terms,internal_purchases,internal_product_positions,internal_purchase_attempts,internal_product_terms_audit FROM authenticated;
  REVOKE ALL ON SEQUENCE internal_product_terms_audit_id_seq FROM authenticated;
 END IF;
END $$;
COMMIT;
