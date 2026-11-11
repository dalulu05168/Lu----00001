-- Apply only after target database review; no production migration is automatic.
CREATE TABLE IF NOT EXISTS cn_write_receipts (
 user_id uuid NOT NULL REFERENCES app_users(id),
 route text NOT NULL,
 request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 8 AND 128),
 request_body jsonb NOT NULL,
 response_body jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,route,request_key)
);
CREATE INDEX IF NOT EXISTS cn_write_receipts_created_idx ON cn_write_receipts(created_at);
