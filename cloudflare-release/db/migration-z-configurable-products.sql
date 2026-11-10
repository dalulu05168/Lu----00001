BEGIN;
CREATE TABLE IF NOT EXISTS cn_products (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('TERM_FUND','BULK_STOCK')),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
 image_data text,
 market text CHECK(market IN ('US','HK','CN','MY')),
 symbol text,
 discount_bps integer NOT NULL DEFAULT 0 CHECK(discount_bps>=0 AND discount_bps<10000),
 holding_days integer NOT NULL DEFAULT 0 CHECK(holding_days BETWEEN 0 AND 36500),
 min_quantity integer NOT NULL DEFAULT 1 CHECK(min_quantity BETWEEN 1 AND 1000000000),
 trade_password_hash text,
 password_scheme text NOT NULL DEFAULT 'commodity',
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind<>'BULK_STOCK' OR (market IS NOT NULL AND symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,23}$'))
);
CREATE UNIQUE INDEX IF NOT EXISTS cn_bulk_product_symbol_idx ON cn_products(market,symbol) WHERE kind='BULK_STOCK';
CREATE TABLE IF NOT EXISTS cn_fund_tiers (
 id uuid PRIMARY KEY,
 product_id uuid NOT NULL REFERENCES cn_products(id),
 principal_cents bigint NOT NULL CHECK(principal_cents>0 AND principal_cents<=9007199254740991),
 holding_days integer NOT NULL CHECK(holding_days BETWEEN 1 AND 36500),
 profit_bps integer NOT NULL CHECK(profit_bps BETWEEN 0 AND 10000),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cn_fund_tiers_product_idx ON cn_fund_tiers(product_id,active);
CREATE TABLE IF NOT EXISTS cn_fund_contracts (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 product_id uuid NOT NULL REFERENCES cn_products(id),
 tier_id uuid NOT NULL REFERENCES cn_fund_tiers(id),
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 128),
 product_name text NOT NULL,
 principal_cents bigint NOT NULL CHECK(principal_cents>0),
 profit_cents bigint NOT NULL CHECK(profit_cents>=0),
 profit_bps integer NOT NULL,
 holding_days integer NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','MATURED')),
 subscribed_at timestamptz NOT NULL DEFAULT now(),
 due_at timestamptz NOT NULL,
 matured_at timestamptz,
 debit_ledger_id bigint UNIQUE REFERENCES cash_ledger(id),
 return_ledger_id bigint UNIQUE REFERENCES cash_ledger(id),
 UNIQUE(account_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS cn_fund_contracts_due_idx ON cn_fund_contracts(due_at,id) WHERE status='ACTIVE';
CREATE TABLE IF NOT EXISTS cn_bulk_order_terms (
 order_id uuid PRIMARY KEY REFERENCES orders(id),
 product_id uuid NOT NULL REFERENCES cn_products(id),
 product_version integer NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id),
 market text NOT NULL,
 symbol text NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0),
 reference_price_cents bigint NOT NULL CHECK(reference_price_cents>0),
 reference_timestamp timestamptz NOT NULL,
 discount_bps integer NOT NULL,
 holding_days integer NOT NULL,
 locked_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cn_bulk_order_lock_idx ON cn_bulk_order_terms(account_id,market,symbol,locked_until);
INSERT INTO cn_products(id,kind,name,status,market,symbol,discount_bps,holding_days,min_quantity,trade_password_hash,created_by,created_at)
 SELECT id,'BULK_STOCK',symbol,'DRAFT',market,symbol,LEAST(discount_bps,9999),LEAST(holding_days,36500),LEAST(min_quantity,1000000000),trade_password_hash,created_by,created_at
 FROM (SELECT DISTINCT ON (market,symbol) * FROM cn_commodity_drafts WHERE market='US' ORDER BY market,symbol,created_at DESC,id DESC) d
 ON CONFLICT DO NOTHING;
INSERT INTO cn_products(id,kind,name,status,market,symbol,trade_password_hash,password_scheme,created_by,created_at)
 SELECT id,'BULK_STOCK',display_name,'DRAFT',market,symbol,purchase_password_hash,'trade-pin',created_by,created_at
 FROM (SELECT DISTINCT ON (market,symbol) * FROM listings WHERE item_type='STOCK' ORDER BY market,symbol,created_at DESC,id DESC) l
 ON CONFLICT DO NOTHING;
ALTER TABLE cn_products ADD COLUMN IF NOT EXISTS reference_price_cents bigint;
ALTER TABLE cn_products ADD COLUMN IF NOT EXISTS reference_timestamp timestamptz;
ALTER TABLE cn_products ADD COLUMN IF NOT EXISTS instrument_info jsonb;

COMMIT;
