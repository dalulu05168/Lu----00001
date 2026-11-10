CREATE TABLE IF NOT EXISTS cn_client_controls (
 user_id uuid PRIMARY KEY REFERENCES app_users(id),
 account_type text CHECK (account_type IN ('STANDARD','REAL_PENDING','READ_ONLY')),
 login_policy text CHECK (login_policy IN ('ALLOW','DENY')),
 withdraw_policy text CHECK (withdraw_policy IN ('ALLOW','DENY')),
 vip_level text CHECK (vip_level IN ('NORMAL','VIP1','VIP2','VIP3','VIP4')),
 loan_policy text CHECK (loan_policy IN ('ALLOW','DENY')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cn_client_control_history (
 id uuid PRIMARY KEY,
 client_user_id uuid NOT NULL REFERENCES app_users(id),
 admin_user_id uuid NOT NULL REFERENCES app_users(id),
 field text NOT NULL,
 value text NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
