# CN Capital QA API contract

This document describes the current internal QA API. It is not a brokerage API. Orders, balances and positions are internal ledger records only and do not represent real securities ownership or withdrawable assets.

## Health and readiness

```text
GET /api/health
GET /api/ready
```

`/api/health` is a liveness check and reports `brokerConnected: false`. `/api/ready` checks whether the database schema is available and returns HTTP 503 when the database is unavailable or migrations have not completed.

## Customer authentication

```text
POST /api/auth/register
Content-Type: application/json
Body: { "email": "user@example.com", "password": "..." }
```

Registration always creates a zero-funded internal account. Opening funds cannot be supplied by the client. If invitation policy is enabled, a six-digit `inviteCode` is required.

```text
POST /api/auth/login
Content-Type: application/json
Body: { "email": "user@example.com", "password": "..." }
```

A successful login returns a short-lived bearer token:

```json
{ "token": "...", "expiresAt": "2026-..." }
```

Protected requests use:

```text
Authorization: Bearer <token>
```

```text
POST /api/auth/logout
Authorization: Bearer <token>
```

## Account and watchlist

```text
GET /api/account
GET /api/watchlist
POST /api/watchlist
DELETE /api/watchlist
```

`GET /api/account` resolves the account only from the authenticated session. It returns the account snapshot, internal positions and the latest 100 internal orders. The watchlist is scoped to the authenticated account and accepts only a `{ "market": "US", "symbol": "AAPL" }` instrument object.

## Internal orders

```text
POST /api/orders
Authorization: Bearer <token>
Idempotency-Key: <client-generated unique key>
Content-Type: application/json
Body: { "market": "US", "symbol": "AAPL", "side": "BUY", "quantity": 1 }
```

The account ID is always derived from the bearer session. Client-controlled execution prices and FX values are rejected. The route returns HTTP 503 until a verified, entitled, fresh server-side quote and FX provider is configured. No order is sent to a broker.

When a verified pricing provider is configured, the service performs account locking, cash/position/order/ledger updates and idempotent replay handling in one internal transaction.

## Administration and catalog

The current admin routes are:

```text
POST  /api/admin/login
POST  /api/admin/bootstrap
POST  /api/admin/activate
GET   /api/admin/me
GET   /api/admin/subaccounts
POST  /api/admin/subaccounts
GET   /api/admin/clients
GET   /api/admin/listings
POST  /api/admin/listings
PATCH /api/admin/listings
GET   /api/catalog
```

Admin routes require the role and 2FA rules implemented in `src/admin-http.mjs`. Catalog publication is an administrative operation; there is no public funding or withdrawal endpoint.

## Current verification state

The local API test suite has 89 tests: 69 passed, 0 failed and 20 skipped. The skipped cases require a real PostgreSQL instance or a live HTTP deployment. Before calling the API production-ready, run the skipped PostgreSQL and live HTTP cases against a disposable QA database, then verify migrations, restart persistence, account isolation, revoked sessions and readiness behavior.
