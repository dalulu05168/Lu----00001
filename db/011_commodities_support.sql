-- CN Capital operations: managed commodity directory and scoped customer support.
-- Commodity prices are administrator-maintained indications, not exchange or broker quotes.
BEGIN;
CREATE TABLE commodity_products (
 id uuid PRIMARY KEY,
 sku varchar(32) NOT NULL UNIQUE CHECK(sku ~ '^[A-Z0-9][A-Z0-9._-]{1,31}$'),
 name varchar(120) NOT NULL CHECK(length(trim(name))>=2),
 category varchar(40) NOT NULL CHECK(category IN ('PRECIOUS_METAL','ENERGY','AGRICULTURE','INDUSTRIAL_METAL','OTHER')),
 unit varchar(24) NOT NULL CHECK(length(trim(unit))>=2),
 minimum_quantity integer NOT NULL DEFAULT 1 CHECK(minimum_quantity BETWEEN 1 AND 1000000),
 indicative_price_cents bigint CHECK(indicative_price_cents BETWEEN 1 AND 1000000000000),
 price_source text NOT NULL DEFAULT 'ADMIN_INDICATIVE' CHECK(price_source='ADMIN_INDICATIVE'),
 is_demo boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
 created_by uuid NOT NULL REFERENCES admin_roles(user_id),
 updated_by uuid NOT NULL REFERENCES admin_roles(user_id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commodity_product_visible_idx ON commodity_products(status,updated_at DESC);
CREATE TABLE commodity_product_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id uuid NOT NULL REFERENCES commodity_products(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
 action varchar(20) NOT NULL CHECK(action IN ('CREATE','UPDATE')),
 previous_status text,
 new_status text NOT NULL,
 reason varchar(400) NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commodity_audit_product_time_idx ON commodity_product_audit(product_id,recorded_at DESC);
CREATE TABLE support_threads (
 id uuid PRIMARY KEY,
 client_user_id uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
 status varchar(12) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_threads_updated_idx ON support_threads(updated_at DESC);
CREATE TABLE support_messages (
 id uuid PRIMARY KEY,
 thread_id uuid NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
 sender_user_id uuid NOT NULL REFERENCES app_users(id),
 body varchar(4000) NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_thread_time_idx ON support_messages(thread_id,created_at ASC,id ASC);
CREATE TABLE support_status_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 thread_id uuid NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES admin_roles(user_id),
 previous_status varchar(12) NOT NULL,
 new_status varchar(12) NOT NULL,
 reason varchar(400) NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_status_audit_thread_time_idx ON support_status_audit(thread_id,recorded_at DESC);
ALTER TABLE commodity_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE commodity_product_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_status_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE commodity_products,commodity_product_audit,support_threads,support_messages,support_status_audit FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  EXECUTE 'REVOKE ALL ON TABLE commodity_products,commodity_product_audit,support_threads,support_messages,support_status_audit FROM anon';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  EXECUTE 'REVOKE ALL ON TABLE commodity_products,commodity_product_audit,support_threads,support_messages,support_status_audit FROM authenticated';
 END IF;
END $$;
COMMIT;
