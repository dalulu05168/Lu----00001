# Global Stock Platform — Architecture V1

## Scope and constraints
- Markets: US / HK / CN / MY.
- Licensed, read-only market data; no broker order transport.
- Internal-only accounting. No deposits, withdrawals, or representation of real securities ownership.
- Main product branding is neutral; transaction and asset disclosures must remain explicit.

## System layers
1. **Web terminal** — market selector, search, quote state, order form, account and order views. Existing `web/` is a prototype, not the planned Next.js production frontend.
2. **Authenticated HTTP API** — session-based account resolution, input validation, rate limiting (pending), idempotency.
3. **Pricing gateway** — licensed read-only market data, source provenance, trading-session rules, stale quote rejection, FX timestamp and currency conversion. **Not connected.**
4. **Internal order service** — account-row locking, atomic cash/position/order/ledger writes, no broker routing.
5. **PostgreSQL** — users, accounts, positions, orders, cash ledger. Schema created; actual database provisioning/migration not executed.
6. **Redis (planned)** — quote cache, rate limits, session support as needed.
7. **Operations** — CI, monitoring, audit logs, security reviews, backups and recovery tests (mostly pending).

## Build order
- P0: enforce server-side price authority; prevent unverified order execution.
- P1: migrations and transactional integration tests against real PostgreSQL.
- P2: session auth, account ownership, account creation, rate limits.
- P3: read-only quote provider abstraction and entitlement checks.
- P4: connect web terminal to authenticated API; remove in-memory-only accounting.
- P5: Next.js + TypeScript migration, responsive accessibility, real-time stream.
- P6: security and compliance review, staging load tests, production approval.

## Critical invariants
- Never send a real brokerage order.
- Never accept a client-provided execution price as authoritative.
- Reject stale/missing quotes and FX.
- Use decimal-safe monetary arithmetic; review existing JavaScript number usage before production.
- Ensure every committed order has exactly one corresponding cash-ledger entry.
- Make repeated idempotency keys return the original result.
- No production release without verified tests, disclosures, licensed data rights and explicit approval.

## Disclosure
订单仅在本平台内部记录，不会发送至证券交易所或券商；所示持仓和资金不代表真实证券或可提现资产。
