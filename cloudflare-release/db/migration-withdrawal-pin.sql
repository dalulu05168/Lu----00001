CREATE TABLE IF NOT EXISTS cn_withdrawal_pins (
 user_id uuid PRIMARY KEY REFERENCES app_users(id),
 pin_hash text NOT NULL,
 failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts>=0),
 blocked_until timestamptz
);
