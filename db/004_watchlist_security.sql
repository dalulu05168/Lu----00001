-- Keep saved watchlist items private to the trusted API database role.
BEGIN;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE watchlist_items FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE watchlist_items FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE watchlist_items FROM authenticated';
  END IF;
END $$;
COMMIT;
