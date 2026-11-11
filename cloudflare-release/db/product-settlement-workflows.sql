BEGIN;
CREATE TABLE product_ipo_allocations (
 order_id uuid PRIMARY KEY REFERENCES product_settlement_orders(id),
 quantity_micros bigint NOT NULL CHECK(quantity_micros>=0),
 entered_by uuid NOT NULL REFERENCES admin_roles(user_id),
 reviewed_by uuid REFERENCES admin_roles(user_id),
 reviewed_at timestamptz,
 CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL))
);
CREATE TABLE product_settlement_movements (
 order_id uuid NOT NULL REFERENCES product_settlement_orders(id),
 ledger_entry_id bigint PRIMARY KEY REFERENCES cash_ledger(id)
);
ALTER TABLE product_ipo_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_settlement_movements ENABLE ROW LEVEL SECURITY;
COMMIT;
