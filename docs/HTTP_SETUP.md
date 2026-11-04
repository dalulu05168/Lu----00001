# Local API wiring (development only)

`src/server.mjs` runs the existing Node server using `DATABASE_URL`; `npm run dev:api` starts it on port 3001 by default. It serves the customer frontend at `/`, administrator frontend at `/admin.html`, and same-origin `/api` routes.

`src/http-api.mjs` exports `createApi({db,resolveSession,createId,resolveExecutionPrice,maxBodyBytes})`:

- `db`: PostgreSQL pool with `query()` and `connect()`.
- `resolveSession(token)`: trusted server-side lookup returning `{accountId,userId,adminVerified}` or null. The production implementation checks revocation, expiry, ownership and login policy.
- `createId()`: server-side order UUID generator (defaults to `randomUUID`).
- `resolveExecutionPrice`: optional trusted pricing adapter; intentionally absent from the default server. Browser-defined execution prices/FX are rejected.
- `maxBodyBytes`: request size limit (default 8192).

There is no hard-coded development login. Customer accounts start at zero; administrator bootstrap requires the configured identity and setup secret. Use only a fresh isolated local database for development/testing. See `INTEGRATION.md` for migration-variable precedence and safe test setup, and `API.md` for endpoint contracts.

`/health` checks process liveness. `/ready` checks that required core/customer/admin/audit tables exist. Neither proves successful brokerage connectivity, financial settlement, complete schema compatibility, or deployed acceptance. Orders and balances remain internal records; no real broker order transport is implemented.
