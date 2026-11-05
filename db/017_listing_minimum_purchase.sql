BEGIN;
ALTER TABLE internal_product_terms ADD COLUMN minimum_quantity integer NOT NULL DEFAULT 1
  CHECK (minimum_quantity BETWEEN 1 AND 1000000);
ALTER TABLE internal_product_terms_audit ADD COLUMN minimum_quantity integer
  CHECK (minimum_quantity BETWEEN 1 AND 1000000);
COMMIT;
