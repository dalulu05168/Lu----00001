BEGIN;
CREATE TABLE customer_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('DEPOSIT','WITHDRAW','KYC','BANK')),
  amount_cents bigint CHECK (amount_cents IS NULL OR amount_cents > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  review_note text,
  reviewed_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_requests_account_idx ON customer_requests(account_id, created_at DESC);
CREATE INDEX customer_requests_status_idx ON customer_requests(status, created_at DESC);
CREATE TABLE support_messages (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('CLIENT','ADMIN')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX support_messages_account_idx ON support_messages(account_id, created_at ASC);
ALTER TABLE customer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE customer_requests,support_messages FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   EXECUTE 'REVOKE ALL ON TABLE customer_requests,support_messages FROM anon';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   EXECUTE 'REVOKE ALL ON TABLE customer_requests,support_messages FROM authenticated';
 END IF;
END $$;
COMMIT;
