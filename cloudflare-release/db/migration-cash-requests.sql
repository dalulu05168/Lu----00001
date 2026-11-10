CREATE TABLE IF NOT EXISTS cash_requests (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 user_id uuid NOT NULL REFERENCES app_users(id),
 kind text NOT NULL CHECK (kind IN ('DEPOSIT','WITHDRAW')),
 amount_cents bigint NOT NULL CHECK (amount_cents>0),
 method text,
 note text,
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','REVIEWED','APPROVED','REJECTED')),
 reject_reason text,
 reviewed_by uuid REFERENCES app_users(id),
 approved_by uuid REFERENCES app_users(id),
 reviewed_at timestamptz,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_requests_account_created_idx ON cash_requests(account_id,created_at DESC);
