# Security implementation status

## Implemented foundations

- Passwords are hashed with Node.js `scrypt` and per-password random salts.
- Session tokens are generated with cryptographic randomness; only SHA-256 digests are stored.
- Session lookup checks expiry and revocation and resolves the account server-side.
- Registration, login, logout, and protected account/order HTTP routes are implemented.
- The order API derives the account from the authenticated session and does not accept client-supplied execution prices or FX rates as authoritative.
- The pricing gateway validates quote identity, freshness, provenance, and entitlement before it can authorize internal order pricing.
- No broker order routing exists.

## Not yet implemented or verified

- Login rate limiting, abuse detection, verified email, and password reset.
- Production TLS termination, deployment-specific CORS/origin policy, and review of browser session/CSRF controls.
- Production PostgreSQL provisioning and migration execution; the real PostgreSQL integration suite requires a configured test database.
- Live market-data credentials and licensed entitlements. The provider adapter currently retrieves US quotes; Alpha Vantage fallback quotes are not entitled for execution.
- Production-grade funding audit/reconciliation, full browser E2E coverage, dependency scanning, security review, and monitoring.

Keep `MARKET_DATA_EXECUTION_ENABLED=false` until quote rights, freshness, pricing policy, and accounting controls are verified. Do not expose this development service publicly before the remaining controls are implemented and reviewed. Internal orders do not reach a broker and do not represent real securities or withdrawable funds.
