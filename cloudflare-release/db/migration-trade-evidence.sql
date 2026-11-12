-- Additive isolated-first migration. No automatic production execution.
BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_intent jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_evidence jsonb;
COMMIT;
