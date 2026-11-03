-- Non-settling operational requests: no payment rail, custody, or trusted KYC vendor connected.
BEGIN;
CREATE TABLE client_funding_requests (
 id uuid PRIMARY KEY,
 client_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('DEPOSIT','WITHDRAWAL')),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 100 AND 100000000),
 currency char(3) NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')),
 review_actor_user_id uuid REFERENCES admin_roles(user_id),
 review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX funding_client_time_idx ON client_funding_requests(client_user_id,created_at DESC);
CREATE INDEX funding_status_time_idx ON client_funding_requests(status,created_at DESC);
CREATE TABLE client_kyc_requests (
 id uuid PRIMARY KEY,
 client_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'AWAITING_EVIDENCE' CHECK(status IN ('AWAITING_EVIDENCE','UNDER_REVIEW','NEEDS_INFORMATION','MANUALLY_REVIEWED','REJECTED')),
 review_actor_user_id uuid REFERENCES admin_roles(user_id),
 review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kyc_client_time_idx ON client_kyc_requests(client_user_id,created_at DESC);
CREATE TABLE client_bank_link_requests (
 id uuid PRIMARY KEY,
 client_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 bank_label varchar(80) NOT NULL CHECK(length(trim(bank_label)) BETWEEN 2 AND 80),
 account_last4 char(4) NOT NULL CHECK(account_last4 ~ '^[0-9]{4}$'),
 status text NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK(status IN ('PENDING_VERIFICATION','NEEDS_INFORMATION','REJECTED')),
 review_actor_user_id uuid REFERENCES admin_roles(user_id),
 review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_client_time_idx ON client_bank_link_requests(client_user_id,created_at DESC);
CREATE TABLE client_workflow_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 category text NOT NULL CHECK(category IN ('FUNDING','KYC','BANK_LINK')),
 request_id uuid NOT NULL,
 client_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES app_users(id),
 old_status text,
 new_status text NOT NULL,
 reason text,
 event_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_audit_client_time_idx ON client_workflow_audit(client_user_id,event_at DESC);
ALTER TABLE client_funding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_kyc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_bank_link_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_workflow_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE client_funding_requests,client_kyc_requests,client_bank_link_requests,client_workflow_audit FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  EXECUTE 'REVOKE ALL ON TABLE client_funding_requests,client_kyc_requests,client_bank_link_requests,client_workflow_audit FROM anon';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  EXECUTE 'REVOKE ALL ON TABLE client_funding_requests,client_kyc_requests,client_bank_link_requests,client_workflow_audit FROM authenticated';
 END IF;
END $$;
COMMIT;
