# Account and API client integration contract

The Node API route layer and internal services are implemented in `src/http-api.mjs`, `src/admin-http.mjs`, `src/account-service.mjs`, `src/watchlist-service.mjs` and `src/order-service.mjs`. The service requires PostgreSQL for real HTTP operation.

## Implemented routes

| Endpoint | Auth | Current behavior |
|---|---|---|
| `GET /api/health` | No | Liveness; reports broker disconnected |
| `GET /api/ready` | No | Checks database readiness and returns 503 when unavailable |
| `POST /api/auth/register` | No | Creates a zero-funded internal account |
| `POST /api/auth/login` | No | Returns a short-lived bearer token |
| `POST /api/auth/logout` | Yes | Revokes the bearer session |
| `GET /api/account` | Yes | Returns account, internal positions and latest orders |
| `GET/POST/DELETE /api/watchlist` | Yes | Account-scoped watchlist |
| `POST /api/orders` | Yes | Internal order route; fail-closed without verified pricing |
| Admin and catalog routes | Role/2FA | Implemented in `src/admin-http.mjs` |

Controlled CORS is implemented for exact origins listed in `CORS_ORIGIN`. The API uses bearer authorization rather than browser cookies, so the static UI can call it after the API Web Service is deployed.

## Current blockers

- The QA Web Service and QA PostgreSQL database have not been provisioned in Render.
- The 20 skipped tests require a real PostgreSQL instance or live HTTP deployment.
- No licensed market-data provider or FX provider is configured.
- There is no public funding, withdrawal or broker transport endpoint.
- Rate limiting, monitoring and backup/restore drills remain operational work.

## Required QA acceptance tests

1. Run migrations against a disposable PostgreSQL database and confirm `/api/ready` changes from 503 to 200.
2. Register, login, logout and reject expired/revoked sessions.
3. Confirm account A cannot see or modify account B.
4. Confirm watchlist records are isolated by account.
5. Confirm double-submission returns one internal order and one ledger entry when a verified provider is available.
6. Confirm concurrent buys cannot overspend.
7. Confirm stale, unlicensed or missing quotes reject orders with 503.
8. Confirm balances and positions persist across a server restart.
