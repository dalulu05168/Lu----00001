-- A verified deletion request is NOT proof of completed erasure.
-- Operations must honor any legally required financial/audit retention before completing a request.
BEGIN;
CREATE TABLE customer_account_deletion_requests (
 id uuid PRIMARY KEY,
 client_user_id uuid UNIQUE REFERENCES app_users(id) ON DELETE SET NULL,
 status varchar(20) NOT NULL DEFAULT 'REQUESTED'
   CHECK(status IN ('REQUESTED','UNDER_REVIEW','COMPLETED','REJECTED')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid REFERENCES admin_roles(user_id) ON DELETE SET NULL,
 review_note text
);
CREATE INDEX customer_deletion_status_time_idx
 ON customer_account_deletion_requests(status,requested_at DESC);
ALTER TABLE customer_account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE customer_account_deletion_requests FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   EXECUTE 'REVOKE ALL ON TABLE customer_account_deletion_requests FROM anon';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   EXECUTE 'REVOKE ALL ON TABLE customer_account_deletion_requests FROM authenticated';
 END IF;
END $$;
COMMIT;
