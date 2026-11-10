BEGIN;

CREATE TABLE product_settlement_products (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('IPO','MUTUAL_FUND','COMMODITY')),
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,23}$'),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  settlement_currency char(3) NOT NULL DEFAULT 'USD' CHECK (settlement_currency = 'USD'),
  unit_name text NOT NULL CHECK (length(trim(unit_name)) BETWEEN 1 AND 30),
  created_by uuid NOT NULL REFERENCES admin_roles(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind,symbol)
);

CREATE TABLE product_settlement_terms (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES product_settlement_products(id),
  unit_price_micros bigint NOT NULL CHECK (unit_price_micros > 0),
  effective_date date NOT NULL,
  entered_by uuid NOT NULL REFERENCES admin_roles(user_id),
  reviewed_by uuid REFERENCES admin_roles(user_id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (product_id,id),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CHECK (reviewed_at IS NULL OR reviewed_at >= entered_at)
);

CREATE UNIQUE INDEX product_settlement_terms_approved_date_idx
  ON product_settlement_terms(product_id,effective_date) WHERE reviewed_at IS NOT NULL;

CREATE TABLE product_settlement_orders (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  product_id uuid NOT NULL REFERENCES product_settlement_products(id),
  terms_id uuid,
  idempotency_key varchar(128) NOT NULL CHECK (length(idempotency_key) >= 8),
  action text NOT NULL CHECK (action IN ('SUBSCRIBE','REDEEM','BUY','SELL')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SETTLED','REJECTED','CANCELLED')),
  requested_quantity_micros bigint CHECK (requested_quantity_micros > 0),
  requested_amount_cents bigint CHECK (requested_amount_cents > 0),
  settled_quantity_micros bigint CHECK (settled_quantity_micros >= 0),
  settled_amount_cents bigint CHECK (settled_amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  FOREIGN KEY (product_id,terms_id) REFERENCES product_settlement_terms(product_id,id),
  UNIQUE (account_id,idempotency_key),
  UNIQUE (account_id,id),
  CHECK (requested_quantity_micros IS NOT NULL OR requested_amount_cents IS NOT NULL),
  CHECK (
    (status='SETTLED' AND terms_id IS NOT NULL AND settled_at IS NOT NULL
       AND settled_quantity_micros IS NOT NULL AND settled_amount_cents IS NOT NULL)
    OR
    (status<>'SETTLED' AND settled_at IS NULL
       AND settled_quantity_micros IS NULL AND settled_amount_cents IS NULL)
  )
);

CREATE TABLE product_settlement_cash_holds (
  account_id uuid NOT NULL,
  order_id uuid PRIMARY KEY,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  released_at timestamptz,
  FOREIGN KEY (account_id,order_id) REFERENCES product_settlement_orders(account_id,id)
);
CREATE INDEX product_settlement_active_holds_idx
  ON product_settlement_cash_holds(account_id) WHERE released_at IS NULL;

CREATE TABLE product_settlement_positions (
  account_id uuid NOT NULL REFERENCES accounts(id),
  product_id uuid NOT NULL REFERENCES product_settlement_products(id),
  quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
  PRIMARY KEY (account_id,product_id)
);

CREATE TABLE product_settlement_cash_postings (
  order_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  ledger_entry_id bigint NOT NULL UNIQUE REFERENCES cash_ledger(id),
  FOREIGN KEY (account_id,order_id) REFERENCES product_settlement_orders(account_id,id)
);

ALTER TABLE product_settlement_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_settlement_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_settlement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_settlement_cash_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_settlement_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_settlement_cash_postings ENABLE ROW LEVEL SECURITY;
COMMIT;
