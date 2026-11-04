-- Future approvals only. Existing approvals and balances are never backfilled.
BEGIN;
ALTER TABLE client_funding_requests
 ADD COLUMN settlement_status text NOT NULL DEFAULT 'NOT_EXECUTED'
 CHECK (settlement_status IN ('NOT_EXECUTED','INTERNAL_POSTED')),
 ADD COLUMN settled_at timestamptz;
ALTER TABLE cash_ledger ADD COLUMN funding_request_id uuid UNIQUE
 REFERENCES client_funding_requests(id);
ALTER TABLE cash_ledger ADD CONSTRAINT cash_ledger_single_source
 CHECK (NOT (order_id IS NOT NULL AND funding_request_id IS NOT NULL));
COMMIT;
