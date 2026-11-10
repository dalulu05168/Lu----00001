ALTER TABLE admin_roles ADD COLUMN IF NOT EXISTS login_restricted_at timestamptz;
