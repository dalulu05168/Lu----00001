# Account-record analytics scope

User approved on 2026-11-04: keep the existing public TV chart/branding for the free phase and complete statistics that can be computed from actual account records. No push, deployment, production or existing QA data writes.

Add a read-only customer endpoint `/api/account/analytics`, scoped exclusively through the authenticated account. Read cash, positions and full order history in reliable cash-ledger ID order in a single repeatable-read transaction. Do not change the existing last-100-orders account response.

Compute USD internal-record gross realized P/L using FIFO, cumulative proportional allocation of integer lot costs, full-history buy/sell volume and remaining position cost. Also provide realized P/L for the current UTC day/month, explicitly distinguished from total daily P/L and monthly return. Use stored USD amounts (including the recorded FX conversion), not widget prices. Reconcile remaining lots against recorded positions; missing acquisitions, inconsistent positions, invalid values or overflow must return a clear unavailable result rather than fabricated profit. No fee/tax records exist, so results exclude fees/taxes and are not brokerage profits.

Without holdings, total recorded account value is cash only. With holdings and no quotes, current total value remains unavailable. Daily total P/L, monthly portfolio return, dividends, risk scoring, news and external quotes remain data-source/model gaps. Keep their explanations visible.

Integrate analytics with login/refresh, isolated error handling and session cleanup. Display server full-history totals separately from the current 100-row transaction view. Preserve working chart and all existing business features. No schema migration or third-party dependency change required.

Verify pure calculation boundaries, authenticated HTTP scope, repeatable-read rollback, more-than-100-order history, DOM/session behavior, real isolated PostgreSQL and local browser. Keep unsupported features explicitly unavailable.
