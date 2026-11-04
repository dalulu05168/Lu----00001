# Frontend / backend integration

The existing `web/` application uses same-origin `/api` endpoints. `web/app.mjs` reads customer account records, watchlist, published securities, operational requests and support. `web/admin.mjs` uses the separate administrator login/session and scoped APIs for customer details, policies, subaccounts, workflow review, account mirror and audit. Neither UI creates a real brokerage account, settles funds or invents execution prices.

## Shared data and authorization

- `/api/account` and `/api/admin/mirror` reuse `getAccountSnapshot`; watchlist reads reuse `listWatchlist`. A customer watchlist change is visible on the next mirror refresh.
- Administrators do not receive customer tokens or passwords. Mirror reads write `admin_mirror_access_log` before returning protected account data.
- MASTER can change customer policies and child-subadmin login with password confirmation, a reason and a matching version. SUBADMIN policy views are read-only and customer access is limited to assigned clients.
- Client funding/KYC/bank requests and admin reviews share persistent request rows and transactional workflow audits. Review approval is not payment or third-party identity verification.
- Browser customer/subadmin selection changes clear old policy data before requesting new data. Logout/expired sessions clear private workspaces and audit data. Responses from an earlier administrator session cannot populate a later session.
- Published securities are metadata only. The default HTTP server has no trusted execution-price provider, so orders remain unavailable even when a catalog item is published.

## Local execution

Install declared dependencies with `npm install --ignore-scripts`, then run `npm test`. Tests without a DB exercise services, HTTP routes and DOM behavior; PostgreSQL tests skip unless `TEST_DATABASE_URL` is set.

For actual API/UI review, prepare a **new, empty, isolated local PostgreSQL database**, set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to that exact database, run `npm run migrate`, then `npm run dev:api`. The migration script prefers `DATABASE_URL_UNPOOLED`; do not inherit a connection to an existing service. Client entry: `http://127.0.0.1:3001/`; admin entry: `http://127.0.0.1:3001/admin.html`. Bootstrap requires locally chosen `ADMIN_MASTER_EMAIL` and a strong `ADMIN_BOOTSTRAP_SECRET` (at least 32 characters), followed by the setup form. No hard-coded administrator credentials are provided.

For PostgreSQL integration, use a separate fresh empty database, apply migrations, set both `DATABASE_URL` and `TEST_DATABASE_URL` to it, then run `node --test test/postgres-integration.test.mjs` or `npm test`. The tests create synthetic users, a singleton master and audit fixtures; they must not run against production, an existing QA snapshot or a reused database containing a master. Use another fresh database for another full run.

`npm run build` copies `web/` to generated `public/`; it does not deploy. Its script replaces the generated `public/` directory, so inspect that directory before rebuilding an existing checkout.

## External checks are opt-in

Ordinary CI and local tests skip `test/live-site-api.test.mjs`. There is no default external host. Only after authorization to check a specific environment, set `RUN_LIVE_SITE_CHECKS=true` and `LIVE_SITE_ORIGIN` to its exact HTTP(S) origin. GET checks run without following redirects. Invalid-JSON POST probes additionally require `LIVE_SITE_ALLOW_INVALID_POST=true`. This work did not enable either option or contact another website.

## Acceptance

See `admin-integration-validation.md`. Successful local tests do not prove that a deployed service, native mobile build, real browser rendering, broker integration or real funds flow has been accepted. No changes are pushed or deployed by these instructions.
