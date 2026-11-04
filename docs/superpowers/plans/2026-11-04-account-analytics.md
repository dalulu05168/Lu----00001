# Account analytics implementation plan

> Execute inline using the previously approved local-development workflow.

**Goal:** Show actual account-record statistics without invented market inputs.
**Architecture:** A focused pure FIFO calculator plus read-only PostgreSQL service, authenticated HTTP endpoint, and existing browser controller.
**Tech Stack:** Node ES modules, BigInt integer allocation, pg transactions, node:test, jsdom.
**Spec:** ../specs/2026-11-04-account-analytics-design.md

## Constraints and review focus
No deployment/push/production writes or new migration. Read full history, not last100. Preserve exact cents across partial sales and FX. Fail closed on inconsistent history. An analytics outage must not remove a valid account or show stale statistics. UTC realized totals must not masquerade as total portfolio returns.

### Task 1 — Calculation and storage boundary
- [x] Write failing tests for multiple lots, partial sales/rounding, losses, cross-market identity, UTC periods, missing acquisitions, reconciliation, malformed data, overflow, no holdings and >100 rows.
- [x] Implement `calculateAccountAnalytics({cashCents,positions,orders,now})` in `src/account-analytics.mjs`.
- [x] Implement `getAccountAnalytics(db,accountId,{now})` using one repeatable-read read-only transaction; rollback/release on failure.

### Task 2 — API and frontend
- [x] Add `/api/account/analytics` GET only with existing customer-session/role protections.
- [x] Add failing endpoint/DOM tests; integrate independent analytics loading, full-history totals and labeled FIFO account statistics; clear on logout/expiry and ignore stale responses.
- [x] Use cash-only value only for accounts without holdings; keep unpriced position valuation and unsupported metrics unavailable.

### Task 3 — Verification
- [x] Run whole suite and actual local PostgreSQL tests, including complete-history and account isolation.
- [x] Verify browser figures from synthetic fixtures with hand-derived expected cents; preserve chart.
- [x] Independent review, isolated build, exact delivery report and local commit. Leave original generated public/ untouched.

## Execution record
Independent review identified that transaction timestamps do not establish actual posting order; fixed to matched cash_ledger.id order, validated with failure-first regression and real PostgreSQL timestamp reversal. UTC periods are explicitly based on stored order timestamps. Final full suite:157 tests,140 passed,0 failed,17 external checks skipped;4 real PostgreSQL tests executed. Browser hand-checked3.50 realized profit/1.50 remaining cost and a separate50.00 cash-only account. Isolated build passed; test services stopped; no push/deployment/production writes. See docs/account-analytics-validation.md.
