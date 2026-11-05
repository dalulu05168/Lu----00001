BEGIN;
CREATE TABLE admin_mirror_purchase_audit (
 purchase_id uuid PRIMARY KEY REFERENCES internal_purchases(id),
 actor_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
 client_user_id uuid NOT NULL REFERENCES app_users(id),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_mirror_purchase_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_mirror_purchase_audit FROM PUBLIC;
COMMIT;
