# Development runbook

Prerequisites: Node.js 20+, PostgreSQL 15+, a database/user with migration privileges.

1. Copy `.env.example` to an untracked local env file and configure `DATABASE_URL`.
2. Install dependencies with `npm install`.
3. Run `npm run migrate` (database credentials required).
4. Run `npm test`.
5. Start local API using `npm run dev:api`.

The API listens on localhost only. Registration creates an account with zero opening balance. There is deliberately no public endpoint to mint cash. Internal order submission stays disabled (503) until a licensed, read-only market-data provider is integrated and quote entitlements verified.

Current `web/` terminal is a standalone prototype; it is not yet served by the API and still uses in-memory records. No deployment or live market-data access is configured.

Security blockers before public use: login rate limiting, verified email, password reset, TLS termination, audited funding policy, account reconciliation, integration tests, security review and compliance sign-off.
