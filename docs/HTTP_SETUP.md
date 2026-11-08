# HTTP API setup (development)

The HTTP adapter is implemented in `src/http-api.mjs`; `src/server.mjs` starts it with PostgreSQL-backed sessions and services. It is not a production-readiness guarantee.

## Run locally

Prerequisites: Node.js 20+ and PostgreSQL 15+.

1. Copy `.env.example` to an untracked local environment file and set `DATABASE_URL`.
2. Install dependencies with `npm install`.
3. Apply schema migrations with `npm run migrate`.
4. Run the suite with `npm test`.
5. Start the API with `npm run dev:api`.

The server uses `PORT` (default `3001`) and binds to `0.0.0.0`; it is not restricted to loopback. Keep development instances on a trusted network and do not expose them publicly without reviewed firewall, TLS, and origin controls.

## Adapter dependencies

`createApi({ db, resolveSession, createId, resolveExecutionPrice, marketDataProvider })` requires a PostgreSQL-compatible `db` and a trusted `resolveSession(token)` lookup. `createId` defaults to `randomUUID`. The quote provider and verified execution-pricing gateway are optional dependencies; without verified execution pricing, `POST /api/orders` returns 503.

## Main routes

- `GET /health` and `GET /api/health`: liveness; `brokerConnected` is always false.
- `GET /ready` and `GET /api/ready`: database/schema readiness.
- `POST /api/auth/register` and `POST /api/auth/login`: account registration and session login.
- `POST /api/auth/logout`, `GET /api/account`, `GET /api/securities`, `GET /api/quote`, and `GET /api/watchlist`: authenticated routes.
- `POST /api/orders`: authenticated internal order request with an idempotency key and server-side verified pricing.

Market-data keys are server-side environment variables (`FINNHUB_API_KEY` or `ALPHA_VANTAGE_API_KEY`); never place them in browser code. Keep `MARKET_DATA_EXECUTION_ENABLED=false` until quote entitlement and freshness are verified.

The `web/` terminal remains a standalone prototype with in-memory UI state; it is not yet wired to the authenticated API. No real brokerage order submission is implemented. Orders and balances are internal-only and do not represent securities or withdrawable assets.
