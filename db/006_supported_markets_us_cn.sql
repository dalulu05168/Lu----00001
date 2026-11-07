-- Supported stock markets: United States and mainland China only.
-- Forward-only, non-destructive: refuse to change constraints while old HK/MY rows exist.
-- An administrator must separately review/retire affected account records first.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM positions WHERE market NOT IN ('US','CN'))
    OR EXISTS (SELECT 1 FROM orders WHERE market NOT IN ('US','CN'))
    OR EXISTS (SELECT 1 FROM watchlist_items WHERE market NOT IN ('US','CN'))
    OR EXISTS (SELECT 1 FROM listings WHERE market NOT IN ('US','CN')) THEN
    RAISE EXCEPTION 'Unsupported market records exist; review and migrate/retire them before restricting markets';
  END IF;
END $$;
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_market_check;
ALTER TABLE positions ADD CONSTRAINT positions_market_check CHECK (market IN ('US','CN'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_market_check;
ALTER TABLE orders ADD CONSTRAINT orders_market_check CHECK (market IN ('US','CN'));
ALTER TABLE watchlist_items DROP CONSTRAINT IF EXISTS watchlist_items_market_check;
ALTER TABLE watchlist_items ADD CONSTRAINT watchlist_items_market_check CHECK (market IN ('US','CN'));
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_market_check;
ALTER TABLE listings ADD CONSTRAINT listings_market_check CHECK (market IN ('US','CN'));
COMMIT;
