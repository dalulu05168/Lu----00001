# Development runbook

Prerequisites: Node.js 20+, PostgreSQL 15+, and a database/user with migration privileges.

1. Copy `.env.example` to an untracked local environment file and configure `DATABASE_URL`.
2. Install dependencies with `npm install`.
3. Apply migrations with `npm run migrate`.
4. Run unit tests with `npm test`.
5. Start the API with `npm run dev:api`.

The API uses `PORT` (default `3001`) and binds to `0.0.0.0`, not only localhost. Keep development instances on a trusted network; do not expose the service publicly without reviewed firewall rules, TLS termination, and origin controls. Registration creates an account with zero opening balance, and there is no public endpoint to mint cash.

Order submission remains disabled (HTTP 503) until a market-data provider is configured, `MARKET_DATA_EXECUTION_ENABLED=true` is deliberately enabled, and a fresh entitled quote passes server-side checks. Orders remain internal records; no brokerage orders are transmitted.

The `web/` terminal is a standalone prototype with in-memory UI state and is not yet connected to the authenticated API. The repository includes deployment configuration and environment templates, but their presence does not establish that a live deployment or provider credentials are configured; verify those in the hosting environment.

Security blockers before public use include login rate limiting, verified email, password reset, TLS/origin controls, audited funding policy, account reconciliation, real PostgreSQL integration tests, security review, and compliance sign-off. PostgreSQL integration tests require `TEST_DATABASE_URL`. Live-site tests run only in GitHub Actions and additionally require `LIVE_SITE_ORIGIN` to be set to the HTTPS site origin.
