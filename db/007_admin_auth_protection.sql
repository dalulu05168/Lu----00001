-- Admin-only authentication hardening. No customer funds, orders or sessions altered.
BEGIN;
ALTER TABLE admin_roles ADD COLUMN last_login_totp_step bigint;
CREATE TABLE admin_auth_attempts (
 action text NOT NULL CHECK (action IN ('LOGIN','ACTIVATE')),
 email_hash char(64) NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
 attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 1 AND 1000000),
 window_started_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(action,email_hash)
);
CREATE INDEX admin_auth_attempts_window_idx ON admin_auth_attempts(window_started_at);
ALTER TABLE admin_auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE admin_auth_attempts FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  EXECUTE 'REVOKE ALL ON TABLE admin_auth_attempts FROM anon';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  EXECUTE 'REVOKE ALL ON TABLE admin_auth_attempts FROM authenticated';
 END IF;
END $$;
COMMIT;
