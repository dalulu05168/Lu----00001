-- Append-only administrator event log, excluding credentials and financial details.
BEGIN;
CREATE TABLE admin_audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 action text NOT NULL CHECK (action IN ('ADMIN_CREATED','ADMIN_2FA_ENABLED','ADMIN_LOGIN','LISTING_CREATED','LISTING_STATUS_CHANGED')),
 actor_user_id uuid,
 target_id uuid,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_actor_idx ON admin_audit_events(actor_user_id,created_at DESC);
CREATE INDEX admin_audit_created_idx ON admin_audit_events(created_at DESC);
ALTER TABLE admin_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE admin_audit_events FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  EXECUTE 'REVOKE ALL ON TABLE admin_audit_events FROM anon';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  EXECUTE 'REVOKE ALL ON TABLE admin_audit_events FROM authenticated';
 END IF;
END $$;
CREATE FUNCTION admin_audit_guard() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'admin_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER guard_admin_audit_changes BEFORE UPDATE OR DELETE ON admin_audit_events
 FOR EACH ROW EXECUTE FUNCTION admin_audit_guard();

CREATE FUNCTION log_admin_activity() RETURNS trigger AS $$
BEGIN
 IF TG_TABLE_NAME='admin_roles' THEN
  IF TG_OP='INSERT' THEN
   INSERT INTO admin_audit_events(action,actor_user_id,target_id,details)
   VALUES('ADMIN_CREATED',COALESCE(NEW.parent_user_id,NEW.user_id),NEW.user_id,jsonb_build_object('role',NEW.role));
  ELSIF TG_OP='UPDATE' AND OLD.twofa_confirmed_at IS NULL AND NEW.twofa_confirmed_at IS NOT NULL THEN
   INSERT INTO admin_audit_events(action,actor_user_id,target_id,details)
   VALUES('ADMIN_2FA_ENABLED',NEW.user_id,NEW.user_id,jsonb_build_object('role',NEW.role));
  END IF;
 ELSIF TG_TABLE_NAME='user_sessions' THEN
  IF NEW.admin_verified_at IS NOT NULL THEN
   INSERT INTO admin_audit_events(action,actor_user_id,target_id,details)
   VALUES('ADMIN_LOGIN',NEW.user_id,NEW.user_id,'{}'::jsonb);
  END IF;
 ELSIF TG_TABLE_NAME='listings' THEN
  IF TG_OP='INSERT' THEN
   INSERT INTO admin_audit_events(action,actor_user_id,target_id,details)
   VALUES('LISTING_CREATED',NEW.created_by,NEW.id,
     jsonb_build_object('market',NEW.market,'symbol',NEW.symbol,'status',NEW.status));
  ELSIF TG_OP='UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
   INSERT INTO admin_audit_events(action,actor_user_id,target_id,details)
   VALUES('LISTING_STATUS_CHANGED',NEW.created_by,NEW.id,
     jsonb_build_object('from',OLD.status,'to',NEW.status,'market',NEW.market,'symbol',NEW.symbol));
  END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_admin_roles AFTER INSERT OR UPDATE ON admin_roles
 FOR EACH ROW EXECUTE FUNCTION log_admin_activity();
CREATE TRIGGER audit_admin_sessions AFTER INSERT ON user_sessions
 FOR EACH ROW EXECUTE FUNCTION log_admin_activity();
CREATE TRIGGER audit_listing_changes AFTER INSERT OR UPDATE ON listings
 FOR EACH ROW EXECUTE FUNCTION log_admin_activity();
COMMIT;
