-- No historical identity documents or bank data are replaced or backfilled.
BEGIN;
ALTER TABLE client_kyc_requests ADD COLUMN documents_stored boolean NOT NULL DEFAULT false;
ALTER TABLE client_bank_link_requests ADD COLUMN bank_details_stored boolean NOT NULL DEFAULT false;
ALTER TABLE client_bank_link_requests DROP CONSTRAINT client_bank_link_requests_status_check;
ALTER TABLE client_bank_link_requests ADD CONSTRAINT client_bank_link_requests_status_check
 CHECK(status IN ('PENDING_VERIFICATION','NEEDS_INFORMATION','REJECTED','MANUALLY_REVIEWED'));
CREATE TABLE private_customer_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES app_users(id),
 kind text NOT NULL CHECK(kind IN ('KYC','BANK_LINK')),
 kyc_request_id uuid UNIQUE REFERENCES client_kyc_requests(id),
 bank_request_id uuid UNIQUE REFERENCES client_bank_link_requests(id),
 encrypted_payload text NOT NULL CHECK(length(encrypted_payload) BETWEEN 40 AND 8000000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='KYC' AND kyc_request_id IS NOT NULL AND bank_request_id IS NULL)
  OR (kind='BANK_LINK' AND bank_request_id IS NOT NULL AND kyc_request_id IS NULL))
);
CREATE INDEX private_customer_submissions_user_time_idx ON private_customer_submissions(user_id,created_at DESC);
CREATE TABLE private_customer_access_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 submission_id uuid NOT NULL REFERENCES private_customer_submissions(id),
 client_user_id uuid NOT NULL REFERENCES app_users(id),
 actor_user_id uuid NOT NULL REFERENCES app_users(id),
 kind text NOT NULL CHECK(kind IN ('KYC','BANK_LINK')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private_customer_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_customer_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_customer_submissions,private_customer_access_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE private_customer_access_audit_id_seq FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON private_customer_submissions,private_customer_access_audit FROM anon;
  REVOKE ALL ON SEQUENCE private_customer_access_audit_id_seq FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON private_customer_submissions,private_customer_access_audit FROM authenticated;
  REVOKE ALL ON SEQUENCE private_customer_access_audit_id_seq FROM authenticated;
 END IF;
END $$;
COMMIT;
