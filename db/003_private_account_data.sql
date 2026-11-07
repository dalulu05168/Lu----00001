-- Browser clients may not query app account tables directly.
-- The API must use a dedicated trusted PostgreSQL connection and check sessions.
BEGIN;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE app_users, accounts, positions, orders, cash_ledger, user_sessions, schema_migrations FROM PUBLIC;
REVOKE ALL ON SEQUENCE cash_ledger_id_seq FROM PUBLIC;

-- If running on Supabase, explicitly revoke access by the Data API roles.
-- Backend access is through a trusted owner/administrative DB role only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE app_users, accounts, positions, orders, cash_ledger, user_sessions, schema_migrations FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE cash_ledger_id_seq FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE app_users, accounts, positions, orders, cash_ledger, user_sessions, schema_migrations FROM authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE cash_ledger_id_seq FROM authenticated';
  END IF;
END $$;
COMMIT;
