# Railway deployment configuration

This repository is configured for Railway via `railway.toml`.

## Required service variables
- `DATABASE_URL`: PostgreSQL connection string for a dedicated database.
- `PGSSL=require` only when the database endpoint requires TLS and presents a publicly trusted certificate. Omit for Railway private-network PostgreSQL unless its connection settings specify TLS.

## Deployment behavior
- Build: Railpack / Node.js 20+.
- Pre-deploy: `npm run migrate` applies versioned SQL migrations under an advisory lock.
- Start: `npm run dev:api`.
- Health check: `/ready` performs `SELECT 1` and returns 503 until PostgreSQL is reachable.
- HTTP listener binds to `0.0.0.0` and Railway's `PORT`.

## Safe rollout checklist
1. Create a dedicated PostgreSQL instance for this project; do not reuse unrelated application databases.
2. Set `DATABASE_URL` on the service using Railway's private connection string.
3. Confirm the PostgreSQL backup/restore policy before using persistent account records.
4. Deploy this branch to a non-production environment first.
5. Confirm migration history, `/health`, `/ready`, registration/login, and account isolation.
6. Keep order submission disabled until a licensed read-only quote provider and FX policy are configured.
7. Do not add broker credentials or any live order-routing integration.

The currently connected Railway project in the workspace is linked to a different repository and application. Do not repoint or reuse it for this service. A separate project and database are required; provisioning them may incur hosting charges and must be explicitly approved by the account owner.
