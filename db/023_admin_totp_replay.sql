-- Candidate for QA's existing 001-022 migration sequence only.
-- Never apply to Neon main (different 006-009 history) or a shared target
-- without the approved source/database SHA, verified backup and rollback plan.
BEGIN;
ALTER TABLE admin_roles
  ADD COLUMN last_login_totp_step bigint;
ALTER TABLE admin_roles
  ADD CONSTRAINT admin_last_login_totp_step_nonnegative
  CHECK (last_login_totp_step IS NULL OR last_login_totp_step >= 0);
COMMIT;
