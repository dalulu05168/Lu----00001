BEGIN;
CREATE TABLE mobile_session_handoffs (
 code_hash char(64) PRIMARY KEY,
 session_hash char(64) NOT NULL UNIQUE REFERENCES user_sessions(token_hash) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX mobile_session_handoffs_expiry_idx ON mobile_session_handoffs(expires_at);
ALTER TABLE mobile_session_handoffs ENABLE ROW LEVEL SECURITY;
COMMIT;
