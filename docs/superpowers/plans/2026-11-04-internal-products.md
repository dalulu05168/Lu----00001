# Internal product participation implementation plan

Scope approved by user: internal-only purchases of STOCK/FUND/IPO and commodities; per-product six-digit participation password; discount means percentage removed from original USD unit price. Existing products remain disabled until explicitly configured. Do not change old cash, orders or terms automatically. External broker/payment rails remain disconnected.

- [x] Add exact integer discount pricing and scoped password hashing; unit tests first.
- [x] Add migration013: product terms, password-attempt limits, internal purchases and positions, unique ledger source. Private tables with RLS; no historical data updates.
- [x] Add transactional purchase service: account lock, idempotency, terms lock/version check, enabled/published check, password retry limit, balance check, immutable purchase price snapshot, positions and ledger.
- [x] Wire administrator product settings into a separate transactional product-terms endpoint, preserving existing metadata forms; never return passwords or hashes. Editing without a password preserves its hash.
- [x] Wire customer purchase forms for published products, show original/discount/payable USD amounts and clear password after submission; refresh account, internal positions and purchase history.
- [x] Verify synthetic local PostgreSQL concurrency/rollback/ownership and browser UI. Prepare concrete migration request before online schema changes.
- [ ] User approval, target preflight, migration013, deployment and actual live read-only acceptance.

Files: src/internal-products.mjs (rules and terms), src/internal-purchases.mjs (transactions), src/commodity-products.mjs and src/admin-service.mjs (existing configuration entry points), src/http-api.mjs and src/admin-http.mjs (auth and routes), web/admin.html/mjs and web/app.mjs/index.html/styles.css (existing page extensions), db/013_internal_products.sql, focused test files.

Identity upload / full bank binding is a separate dependent workstream requiring an independent encryption key and authorized private storage. Do not expose collection fields until storage, validation, scoped reading and auditing work end to end. No real identity documents or bank details in tests.
