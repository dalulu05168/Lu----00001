-- Additive security counters only; no customer or ledger data is changed.
CREATE TABLE IF NOT EXISTS auth_attempts (
 bucket text NOT NULL,
 ip text NOT NULL,
 window_start timestamptz NOT NULL,
 count integer NOT NULL CHECK (count > 0),
 PRIMARY KEY (bucket, ip, window_start)
);
CREATE INDEX IF NOT EXISTS auth_attempts_expiry_idx ON auth_attempts(window_start);
