CREATE TABLE IF NOT EXISTS cn_profile_documents (
 user_id uuid NOT NULL REFERENCES app_users(id),
 kind text NOT NULL CHECK (kind IN ('BANK','IDENTITY')),
 ciphertext text NOT NULL,
 bank_last4 text CHECK (bank_last4 ~ '^[0-9]{4}$'),
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,kind)
);
