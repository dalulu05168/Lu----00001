-- Role-scoped management and test listings; not brokerage products.
BEGIN;
ALTER TABLE user_sessions ADD COLUMN admin_verified_at timestamptz;
CREATE TABLE admin_roles (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('MASTER','SUBADMIN')),
  parent_user_id uuid REFERENCES admin_roles(user_id),
  totp_secret_ciphertext text NOT NULL,
  twofa_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_role_parent CHECK ((role='MASTER' AND parent_user_id IS NULL) OR (role='SUBADMIN' AND parent_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX only_one_master_admin ON admin_roles(role) WHERE role='MASTER';
CREATE INDEX admin_roles_parent_idx ON admin_roles(parent_user_id);
CREATE TABLE invite_codes (
  id uuid PRIMARY KEY,
  subadmin_user_id uuid NOT NULL REFERENCES admin_roles(user_id) ON DELETE CASCADE,
  code char(6) NOT NULL UNIQUE CHECK (code ~ '^[0-9]{6}$'),
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL DEFAULT 100 CHECK (max_uses BETWEEN 1 AND 10000),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invite_codes_subadmin_idx ON invite_codes(subadmin_user_id);
CREATE TABLE client_links (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  subadmin_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
  invite_code_id uuid NOT NULL REFERENCES invite_codes(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_links_subadmin_idx ON client_links(subadmin_user_id,created_at DESC);
CREATE TABLE listings (
  id uuid PRIMARY KEY,
  item_type text NOT NULL CHECK (item_type IN ('STOCK','FUND','IPO')),
  market varchar(2) NOT NULL CHECK (market IN ('US','HK','CN','MY')),
  symbol varchar(24) NOT NULL CHECK (symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,23}$'),
  display_name varchar(120) NOT NULL,
  discount_bps integer NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
  purchase_password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  created_by uuid NOT NULL REFERENCES admin_roles(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_status_idx ON listings(status,created_at DESC);
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE admin_roles,invite_codes,client_links,listings FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   EXECUTE 'REVOKE ALL ON TABLE admin_roles,invite_codes,client_links,listings FROM anon';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   EXECUTE 'REVOKE ALL ON TABLE admin_roles,invite_codes,client_links,listings FROM authenticated';
 END IF;
END $$;
COMMIT;
