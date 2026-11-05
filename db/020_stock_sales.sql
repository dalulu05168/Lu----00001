BEGIN;
CREATE TABLE internal_stock_sales (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 idempotency_key varchar(128) NOT NULL,
 market varchar(2) NOT NULL CHECK(market='US'),
 symbol varchar(24) NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0),
 unit_price_cents bigint NOT NULL CHECK(unit_price_cents>0),
 total_cents bigint NOT NULL CHECK(total_cents>0),
 quote_at timestamptz NOT NULL,
 quote_source text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,idempotency_key)
);
CREATE TABLE internal_stock_sale_lots (
 sale_id uuid NOT NULL REFERENCES internal_stock_sales(id),
 purchase_id uuid NOT NULL REFERENCES internal_purchases(id),
 quantity integer NOT NULL CHECK(quantity>0),
 cost_cents bigint NOT NULL CHECK(cost_cents>=0),
 PRIMARY KEY(sale_id,purchase_id)
);
CREATE INDEX internal_stock_sale_lots_purchase_idx ON internal_stock_sale_lots(purchase_id);
CREATE INDEX internal_stock_sales_account_idx ON internal_stock_sales(account_id,created_at DESC);
ALTER TABLE internal_stock_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_stock_sale_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal_stock_sales,internal_stock_sale_lots FROM PUBLIC;
ALTER TABLE cash_ledger ADD COLUMN internal_stock_sale_id uuid UNIQUE REFERENCES internal_stock_sales(id);
ALTER TABLE cash_ledger DROP CONSTRAINT cash_ledger_internal_single_source,
 ADD CONSTRAINT cash_ledger_internal_single_source CHECK
 (num_nonnulls(order_id,funding_request_id,internal_purchase_id,fund_maturity_id,internal_stock_sale_id)<=1);
COMMIT;
