# Client API and public chart implementation plan

> Execute inline with superpowers:executing-plans; user selected existing APIs plus public charts, without a quote-provider account.

**Goal:** Complete frontend wiring to existing APIs and restore the official read-only chart.
**Architecture:** Keep existing browser controller, HTTP handlers and PostgreSQL services; reuse stock-chart.mjs and preserve authorization boundaries.
**Tech Stack:** ES modules, Node, PostgreSQL, jsdom, TradingView public widget.
**Spec:** ../specs/2026-11-04-client-api-chart-design.md

## Constraints
No push/deployment/domain/production or existing QA data changes. No trading activation or invented external data. No dependency changes required.

## Review Focus
401 from any protected route clears all private data. An old response cannot replace a later session. Initial login and reload fetch every existing business module. Published catalog selection can open charts. External chart availability never enables orders or claims guaranteed real-time prices.

### Task 1: Complete customer synchronization
Files: web/app.mjs, test/client-api-wiring.test.mjs.
- [x] Add failing DOM tests for initial request history, any-route 401 and late responses after logout/login.
- [x] Centralize session reset and stale-response handling; load all existing endpoints during account sync, preserving independent endpoint errors.
- [x] Connect catalog STOCK/FUND choices to selection and known instrument names; validate metadata and retain references only as chart selection fallback.
- [x] Verify target regressions.

### Task 2: Public chart
Files: web/app.mjs, web/stock-chart.mjs, web/index.html, src/http-api.mjs, test/web-ui.test.mjs, test/stock-chart.test.mjs, test/public-entry-integrity.test.mjs.
- [x] Add failing tests for chart rendering after authenticated account, symbol switch and no external embed before authentication.
- [x] Serve stock-chart.mjs from Node; mount official widget for mapped symbols, matching dark theme, preserving attribution and honest unsupported/error states.
- [x] Keep quotePrice empty and order button disabled without trusted pricing.

### Task 3: End-to-end validation and delivery
- [x] Full test suite, real local PostgreSQL integration and syntax validation.
- [x] Real browser: published security/commodity, customer request/admin review, customer/support reply, public chart and session cleanup.
- [x] Independent review, exact validation record, local commit only. Existing public/ build output is retained; do not overwrite without authorization.

## Execution results
All steps verified. Full local PostgreSQL suite: 146 tests, 129 passed, 0 failed, 17 external checks skipped. Independent review found two callback races; regression-tested and repaired, re-review clean. Real browser showed the delayed MSFT widget and successful request/status/support roundtrips. Third-party widget help requests returned 403; recorded without claiming a clean console. Build ran in a new isolated output directory; repository public/ retained. No deployment or production writes. See docs/client-api-chart-validation.md for evidence and limits.
