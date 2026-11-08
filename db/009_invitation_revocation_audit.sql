-- Expand the audit action constraint without discarding prior events.
BEGIN;
ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check CHECK (
 action IN ('ADMIN_CREATED','ADMIN_2FA_ENABLED','ADMIN_LOGIN',
            'LISTING_CREATED','LISTING_STATUS_CHANGED','INVITE_REVOKED')
);
COMMIT;
