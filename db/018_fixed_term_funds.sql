BEGIN;
ALTER TABLE internal_product_terms
 ADD COLUMN fund_image_url varchar(2048),
 ADD COLUMN fund_days integer CHECK (fund_days BETWEEN 1 AND 3650),
 ADD COLUMN fund_return_bps integer CHECK (fund_return_bps BETWEEN 0 AND 1000000),
 ADD CHECK (num_nonnulls(fund_days,fund_return_bps) IN (0,2));
ALTER TABLE internal_product_terms_audit
 ADD COLUMN fund_image_url varchar(2048),
 ADD COLUMN fund_days integer,
 ADD COLUMN fund_return_bps integer;
CREATE TABLE fund_maturities (
 purchase_id uuid PRIMARY KEY REFERENCES internal_purchases(id),
 due_at timestamptz NOT NULL,
 term_days integer NOT NULL CHECK (term_days BETWEEN 1 AND 3650),
 return_bps integer NOT NULL CHECK (return_bps BETWEEN 0 AND 1000000),
 profit_cents bigint NOT NULL CHECK (profit_cents>=0),
 settled_at timestamptz
);
CREATE INDEX fund_maturities_pending_idx ON fund_maturities(due_at,purchase_id) WHERE settled_at IS NULL;
ALTER TABLE fund_maturities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fund_maturities FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON fund_maturities FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON fund_maturities FROM authenticated;
 END IF;
END $$;
ALTER TABLE cash_ledger ADD COLUMN fund_maturity_id uuid UNIQUE REFERENCES fund_maturities(purchase_id);
ALTER TABLE cash_ledger DROP CONSTRAINT cash_ledger_internal_single_source,
 ADD CONSTRAINT cash_ledger_internal_single_source CHECK
 (num_nonnulls(order_id,funding_request_id,internal_purchase_id,fund_maturity_id)<=1);
COMMIT;
