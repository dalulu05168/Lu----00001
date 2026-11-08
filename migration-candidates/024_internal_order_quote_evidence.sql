-- ISSUE #42 / ISOLATED TEST CANDIDATE ONLY.
-- Keep outside db/ until the single QA migration lineage is approved.
-- NEVER execute against shared QA, Neon main or production by default.
BEGIN;
CREATE TABLE order_execution_evidence (
 order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
 account_id uuid NOT NULL REFERENCES accounts(id),
 market varchar(2) NOT NULL CHECK (market IN ('US','CN')),
 symbol varchar(24) NOT NULL CHECK (symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,23}$'),
 quote_currency char(3) NOT NULL CHECK (quote_currency IN ('USD','CNY')),
 quote_price_cents bigint NOT NULL CHECK (quote_price_cents>0),
 quote_at timestamptz NOT NULL,
 quote_source varchar(120) NOT NULL CHECK (length(btrim(quote_source))>0),
 quote_license_ref varchar(256) NOT NULL CHECK (length(btrim(quote_license_ref))>0),
 session_rule_ref varchar(256) NOT NULL CHECK (length(btrim(session_rule_ref))>0),
 fx_usd_micros bigint NOT NULL CHECK (fx_usd_micros>0),
 fx_at timestamptz,
 fx_source varchar(120),
 fx_license_ref varchar(256),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT evidence_currency_and_fx CHECK (
  (market='US' AND quote_currency='USD' AND fx_usd_micros=1000000
   AND fx_at IS NULL AND fx_source IS NULL AND fx_license_ref IS NULL)
  OR
  (market='CN' AND quote_currency='CNY' AND fx_at IS NOT NULL
   AND fx_source IS NOT NULL AND fx_license_ref IS NOT NULL
   AND length(btrim(fx_source))>0 AND length(btrim(fx_license_ref))>0)
 )
);
CREATE INDEX order_execution_evidence_account_idx
 ON order_execution_evidence(account_id,recorded_at DESC);
ALTER TABLE order_execution_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_execution_evidence FROM PUBLIC;
COMMIT;
