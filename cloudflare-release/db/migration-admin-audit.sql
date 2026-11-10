CREATE TABLE IF NOT EXISTS admin_audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 admin_user_id uuid REFERENCES app_users(id),
 admin_email text,
 role text,
 action text NOT NULL,
 target text,
 detail jsonb,
 ip text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_created_idx ON admin_audit_log(admin_user_id, created_at DESC);
