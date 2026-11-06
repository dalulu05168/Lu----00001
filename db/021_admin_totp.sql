-- Re-introduce admin 2FA (TOTP), removed in 007 as password-only. This time
-- the secret is stored encrypted (AES-256-GCM, sealed by application code,
-- never in plaintext) and verification goes through a short-lived pending
-- challenge instead of a session that is "half" verified.
BEGIN;
ALTER TABLE admin_roles ADD COLUMN totp_secret_ciphertext text;
ALTER TABLE admin_roles ADD COLUMN totp_confirmed_at timestamptz;

CREATE TABLE admin_totp_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES admin_roles(user_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  setup boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_totp_challenge_attempts CHECK (attempts BETWEEN 0 AND 10)
);
CREATE INDEX admin_totp_challenges_user_idx ON admin_totp_challenges(user_id);
CREATE INDEX admin_totp_challenges_expiry_idx ON admin_totp_challenges(expires_at);
ALTER TABLE admin_totp_challenges ENABLE ROW LEVEL SECURITY;
COMMIT;
