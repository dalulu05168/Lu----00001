# Account and API client integration contract

The web terminal currently has an in-memory internal ledger. The following endpoints are implemented in `src/http-api.mjs`, but require a running PostgreSQL instance.

| Endpoint | Auth | Behavior |
|---|---|---|
| POST /api/auth/register | No | Creates zero-funded account |
| POST /api/auth/login | No | Returns short-lived bearer token |
| POST /api/auth/logout | Yes | Revokes session |
| GET /api/account | Yes | Returns account, positions and last 100 orders |
| POST /api/orders | Yes | Requires idempotency key and verified server-side pricing |
| GET /health | No | Reports brokerConnected=false |

## Important blockers
- Browser must not invent execution prices, balances, or asset ownership.
- Do not wire browser to the API until session storage, TLS, CORS/origin controls and CSRF policy are decided.
- A licensed market-data provider must return fresh quotes and FX data with entitlement and provenance.
- Registration defaults to zero internal balance. Funding must be an audited administrative operation, not a public endpoint.
- PostgreSQL integration and browser E2E tests have not been run.
- The existing `web/` remains an isolated prototype and is not a production trading terminal.

## Required acceptance tests
1. Register, login, logout and reject expired/revoked session.
2. Confirm account A cannot see or modify account B.
3. Confirm double-submission returns one order and one ledger entry.
4. Confirm concurrent buys cannot overspend.
5. Confirm stale, unlicensed, or missing quotes reject orders.
6. Confirm balance and positions persist across server restarts.
7. Confirm browser disclosure remains visible at order submission.
