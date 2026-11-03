-- Password-only admin sessions. Preserve only a one-time setup recovery marker for unfinished enrollment.
BEGIN;
ALTER TABLE admin_roles ADD COLUMN password_setup_pending boolean NOT NULL DEFAULT false;
UPDATE user_sessions SET revoked_at=now() WHERE admin_verified_at IS NOT NULL AND revoked_at IS NULL;
UPDATE admin_roles SET password_setup_pending=true WHERE role='MASTER' AND twofa_confirmed_at IS NULL;
ALTER TABLE admin_roles DROP COLUMN totp_secret_ciphertext;
ALTER TABLE admin_roles DROP COLUMN twofa_confirmed_at;
COMMIT;
