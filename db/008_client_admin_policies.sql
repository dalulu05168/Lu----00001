-- Internal account administration policy, not a payment ledger or brokerage entitlement.
BEGIN;
CREATE TABLE client_admin_policies (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  login_allowed boolean NOT NULL DEFAULT true,
  withdrawal_requests_allowed boolean NOT NULL DEFAULT true,
  loan_requests_allowed boolean NOT NULL DEFAULT false,
  vip_tier text NOT NULL DEFAULT 'STANDARD' CHECK (vip_tier IN ('STANDARD','SILVER','GOLD','PLATINUM')),
  account_class text NOT NULL DEFAULT 'SIMULATED' CHECK (account_class IN ('SIMULATED','REAL_PENDING','INTERNAL')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by uuid REFERENCES admin_roles(user_id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE client_policy_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
  client_user_id uuid NOT NULL REFERENCES app_users(id),
  field_name text NOT NULL CHECK (field_name IN ('loginAllowed','withdrawalRequestsAllowed','loanRequestsAllowed','vipTier','accountClass')),
  old_value text NOT NULL,
  new_value text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 12 AND 400),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_policy_audit_target_idx ON client_policy_audit(client_user_id,recorded_at DESC);
CREATE INDEX client_policy_audit_actor_idx ON client_policy_audit(actor_user_id,recorded_at DESC);
ALTER TABLE client_admin_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_policy_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE client_admin_policies,client_policy_audit FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE client_admin_policies,client_policy_audit FROM anon';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE client_admin_policies,client_policy_audit FROM authenticated';
  END IF;
END $$;
COMMIT;
