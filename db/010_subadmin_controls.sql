-- Master-managed subadministrator login controls, not a client transfer or payment mechanism.
BEGIN;
CREATE TABLE admin_subaccount_policies (
 user_id uuid PRIMARY KEY REFERENCES admin_roles(user_id) ON DELETE CASCADE,
 login_allowed boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 updated_by uuid REFERENCES admin_roles(user_id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_subaccount_control_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
 subadmin_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
 old_login_allowed boolean NOT NULL,
 new_login_allowed boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 400),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_subaccount_audit_target_idx ON admin_subaccount_control_audit(subadmin_user_id,recorded_at DESC);
ALTER TABLE admin_subaccount_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_subaccount_control_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE admin_subaccount_policies,admin_subaccount_control_audit FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  EXECUTE 'REVOKE ALL ON TABLE admin_subaccount_policies,admin_subaccount_control_audit FROM anon';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  EXECUTE 'REVOKE ALL ON TABLE admin_subaccount_policies,admin_subaccount_control_audit FROM authenticated';
 END IF;
END $$;
COMMIT;
