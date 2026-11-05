BEGIN;
ALTER TABLE listings DROP CONSTRAINT listings_market_check,
  ADD CONSTRAINT listings_market_check CHECK (market IN ('US','HK','CN','MY','RO'));
ALTER TABLE watchlist_items DROP CONSTRAINT watchlist_items_market_check,
  ADD CONSTRAINT watchlist_items_market_check CHECK (market IN ('US','HK','CN','MY','RO'));
ALTER TABLE client_policy_audit DROP CONSTRAINT client_policy_audit_reason_check,
  ADD CONSTRAINT client_policy_audit_reason_check CHECK (length(reason) <= 400);
ALTER TABLE admin_subaccount_control_audit DROP CONSTRAINT admin_subaccount_control_audit_reason_check,
  ADD CONSTRAINT admin_subaccount_control_audit_reason_check CHECK (length(reason) <= 400);
COMMIT;
