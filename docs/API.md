# HTTP API reference

The routes below are implemented in `src/http-api.mjs`. This reference describes repository behavior; it does not prove that a particular deployment is live or production-ready.

## Runtime requirements

The server requires `DATABASE_URL` and an applied PostgreSQL schema. Apply migrations with `npm run migrate`. The API derives an account from a valid bearer session; clients must never supply an account ID.

Market-data reads require `FINNHUB_API_KEY` or `ALPHA_VANTAGE_API_KEY`. Server-side order pricing is disabled unless a provider is configured and `MARKET_DATA_EXECUTION_ENABLED=true`. Keep that switch `false` until provider entitlement, quote freshness, pricing policy, and accounting controls have been verified.

## Health and readiness

| Method and path | Authentication | Behavior |
|---|---|---|
| `GET /health` or `GET /api/health` | None | Returns `status: "alive"`, `brokerConnected: false`, and whether the verified execution-pricing gateway is configured. |
| `GET /ready` or `GET /api/ready` | None | Checks database readiness; returns 503 when the database or schema is unavailable. |

## Authentication and account data

| Method and path | Authentication | Behavior |
|---|---|---|
| `POST /api/auth/register` | None | Accepts `{ "email", "password", "inviteCode?" }`; creates an account with zero opening balance. |
| `POST /api/auth/login` | None | Accepts `{ "email", "password" }`; returns a bearer session token on success. |
| `POST /api/auth/logout` | Bearer token | Revokes the current session. |
| `GET /api/account` | Bearer token | Returns the authenticated account snapshot, including positions and recent internal orders. |
| `GET /api/securities` | Bearer token | Returns published directory listings. |
| `GET /api/quote?market=US&symbol=AAPL` | Bearer token | Reads a quote from the configured market-data provider. The current provider adapter supports US quote retrieval only. |
| `GET /api/watchlist` | Bearer token | Returns the authenticated account's watchlist. |

Protected endpoints require `Authorization: Bearer <token>`. Missing, expired, or revoked sessions are rejected.

## Internal order requests

`POST /api/orders` requires a bearer token and an `Idempotency-Key` header containing 8–128 characters. The request body accepts the instrument and order intent, for example:

```json
{
  "market": "US",
  "symbol": "AAPL",
  "side": "BUY",
  "quantity": 1
}
```

`side` is `BUY` or `SELL`; the Chinese values `买入` and `卖出` are also accepted. The server obtains price and FX data from its configured provider. Do **not** send `priceCents`, `fxUsdMicros`, or `accountId`; these fields are rejected as unexpected input and must never be treated as authoritative.

When verified market pricing is unavailable, the route returns HTTP 503 and does not create an order. Successful orders are internal platform records only: no brokerage order is transmitted, and balances or positions do not represent real securities or withdrawable assets.

## Remaining production controls

Login rate limiting, verified email, password reset, deployment-specific TLS/origin controls, production database operation, and security/compliance review still require implementation or verification. Do not expose the development service publicly until those controls are reviewed.
