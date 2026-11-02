-- Auditable read-only administrative access to customer app state.
BEGIN;
CREATE TABLE admin_mirror_access_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
  client_user_id uuid NOT NULL REFERENCES app_users(id),
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_mirror_actor_time_idx ON admin_mirror_access_log(actor_user_id, viewed_at DESC);
CREATE INDEX admin_mirror_client_time_idx ON admin_mirror_access_log(client_user_id, viewed_at DESC);
ALTER TABLE admin_mirror_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE admin_mirror_access_log FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE admin_mirror_access_log FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE admin_mirror_access_log FROM authenticated';
  END IF;
END $$;
COMMIT;
