-- Only the dedicated non-application backup role can read all rows.
-- Existing application policies, roles and business records are unchanged.
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO cn_backup_monitor;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
 GRANT SELECT ON SEQUENCES TO cn_backup_monitor;
DO $backup$
DECLARE t record;
BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
 LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=t.oid AND polname='cn_backup_read_all') THEN
   EXECUTE format('CREATE POLICY cn_backup_read_all ON public.%I FOR SELECT TO cn_backup_monitor USING (true)',t.relname);
  END IF;
 END LOOP;
END
$backup$;
