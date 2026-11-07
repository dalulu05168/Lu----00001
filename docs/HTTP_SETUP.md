# Local API wiring (development only)

The HTTP adapter in `src/http-api.mjs` exports `createApi({db,resolveSession,createId})`.

- `db`: PostgreSQL-compatible pool with `connect()`.
- `resolveSession(token)`: mandatory trusted server-side session lookup returning `{accountId}` or null.
- `createId()`: server-side order UUID generator (defaults to randomUUID).

There is deliberately **no** hard-coded development login or anonymous trading endpoint. Until authentication and a PostgreSQL pool are configured, this is an API library, not a runnable production server.

Routes:
- `GET /health` returns brokerConnected=false.
- `POST /api/orders` requires Authorization: Bearer token and Idempotency-Key.

The UI currently uses an in-memory account. Connecting it to this API is blocked on implementing real user sessions and a database-backed account lifecycle.

No real broker order submission is implemented. Orders and balances are internal-only and do not represent securities or withdrawable assets.
