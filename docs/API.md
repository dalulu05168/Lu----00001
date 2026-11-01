# Server API contract (planned; NOT deployed)

POST /api/orders
Authorization: Bearer <authenticated session token>
Idempotency-Key: <client-generated random unique key>
Content-Type: application/json

Body: { "market": "US", "symbol": "AAPL", "side": "BUY", "quantity": 1, "priceCents": 10000, "fxUsdMicros": 1000000 }

The server must derive account ID from the authenticated session, not request body. It must authorize ownership, validate market data provenance, FX rate timestamp and pricing policy, and generate order UUID server-side.

Response: { "replayed": false, "order": {...}, "cashCents": 990000, "position": 1 }

**Not implemented:** HTTP route, authentication, rate limiting, database provisioning, quote service. Do not expose the order service directly to untrusted clients.

Orders are internal records only; no brokerage orders are transmitted. Displayed balances/positions are not actual securities or withdrawable assets.
