# Dark Transactions Workspace Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with test-first changes. Keep the work on the isolated branch `dev/ui-transactions-dark-20261102` until verification is complete.

**Goal:** Replace the current light overview-first interface with a responsive dark Transactions workspace matching the supplied visual reference while preserving existing business behavior.

**Architecture:** Keep the current static HTML/CSS/ES-module frontend and existing account API. Add a transaction-first section driven by `account.orders`; use client-side filtering, pagination, and CSV export. Preserve the rest of the existing modules behind labeled sidebar anchors.

**Tech Stack:** HTML, CSS, browser ES modules, Node.js test runner, JSDOM.

**Spec:** `docs/superpowers/specs/2026-11-02-transactions-workspace-design.md`

## Global Constraints
- Do not change the database schema, authentication, API, or broker execution behavior.
- Do not invent transaction values, prices, realized P/L, pending statuses, or user identity.
- Use `account.orders` only; aggregate only valid `amount_usd_cents` integer values.
- Label all current order records as internal-only; broker execution is not connected.
- Preserve existing holdings, market selector, chart, watchlist, catalog, account, and order-entry behavior.
- Keep all current sections accessible from the sidebar and support small screens.

## Review Focus
- No authenticated session: transaction metrics and table must show a truthful empty/login state.
- Missing or malformed `amount_usd_cents`: omit it from volume rather than rendering NaN or a fabricated total.
- Missing or malformed `created_at`: render time as unavailable and exclude it from date-scoped filters.
- More records than the current page size: pagination must not duplicate or skip rows.
- CSV values containing commas, quotes, or newlines: escape them correctly.

---

### Task 1: Pin the new transaction workspace behavior with tests

**Files:**
- Create: `test/transactions-view.test.mjs`
- Modify: `test/ui-color-contrast.test.mjs`
- Modify: `test/reference-style.test.mjs`

**Interfaces:**
- Tests consume the DOM IDs defined in the spec's transaction workspace: `transactions-section`, `transactionRows`, `transactionSearch`, `transactionRange`, `transactionPageSize`, `transactionPrev`, `transactionNext`, `transactionPageSummary`, `transactionVolume`, `realizedPnl`, `internalRecordCount`, `brokerExecutionStatus`, and `exportHistoryButton`.
- Tests load `web/app.mjs` through JSDOM and stub only the existing HTTP boundary.

- [ ] **Step 1: Write failing tests** for dark visual tokens, authenticated order rendering, volume aggregation, truthful internal-only status, search, date filtering, pagination, and export availability.
- [ ] **Step 2: Run the targeted tests on the isolated branch** and confirm failure is due to the missing transaction workspace/behavior, not test setup.
- [ ] **Step 3: Commit the failing tests** before production code.

### Task 2: Implement the transaction-first dark UI

**Files:**
- Modify: `web/index.html`
- Modify: `web/styles.css`
- Modify: `web/app.mjs`

**Interfaces:**
- `renderTransactionHistory()` reads the existing `account.orders` array and updates all transaction metrics, rows, pagination, and export-button state.
- Filtering is driven by `transactionSearch` and `transactionRange`; page size is driven by `transactionPageSize`.
- CSV export serializes all currently filtered account orders and downloads a UTF-8 CSV file.

- [ ] **Step 1: Add the labeled sidebar and transaction-first markup**, preserving all existing module anchors and moving the existing market selector into the performance panel.
- [ ] **Step 2: Add the dark charcoal design system and responsive styles** for the sidebar, header, summary cards, transaction table, forms, panels, and existing modules.
- [ ] **Step 3: Implement data-driven transaction rendering**, currency/time formatting, search, date filters, pagination, and CSV escaping/export.
- [ ] **Step 4: Run the targeted tests** and verify they pass.
- [ ] **Step 5: Run the complete test suite and build** using `npm test` and `npm run build`.

### Task 3: Verify repository and deployment integration

**Files:**
- No additional product files unless a test failure requires a narrowly scoped fix.

- [ ] **Step 1: Re-read the final diff** and check that no backend, schema, environment, or secret files changed.
- [ ] **Step 2: Verify GitHub Actions** for the isolated branch and record both test jobs.
- [ ] **Step 3: Push the verified changes to `dev/platform-v1` only after checks are green**, then verify the resulting Vercel deployment and live UI.
- [ ] **Step 4: Report exact commit, deployment URL/state, test results, and any blocked visual checks.**
