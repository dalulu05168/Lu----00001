BEGIN;
CREATE TABLE commodity_reference_order_prices (
 order_id uuid PRIMARY KEY REFERENCES orders(id),
 source text NOT NULL CHECK(source='EULERPOOL_ETF_HISTORY'),
 source_timestamp timestamptz NOT NULL
);
ALTER TABLE commodity_reference_order_prices ENABLE ROW LEVEL SECURITY;
COMMIT;
