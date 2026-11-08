# NuvexaPro Cloudflare isolated QA preview

**Scope:** The project currently deployed at `lu----00001.dalulu05168.workers.dev` is a static build from `dev/platform-v1`. Do not overwrite it or any production custom domain as part of this preview.

## Git source and deployment

- Source baseline: `work/platform-v1-cn-ui-login-sync-20261108` (`faf2d2643a3135eaba6c0eab4939a8ceb7dc7587`).
- Create a **new** Cloudflare Worker for QA, never override the existing `lu----00001` Worker.
- Cloudflare Workers Builds may initially deploy the repository default branch `dev/platform-v1` during setup. Once the new Worker exists, use **Settings > Build > Branch control** to select **`dev/cloudflare-qa-preview-20261108`** as the production branch for this QA-only Worker; then trigger a fresh build from that branch and verify its SHA and routes. A successful initial deployment from the default branch is *not* acceptance of this QA preview.
- Configuration is `wrangler.jsonc`, Worker name `nuvexaqa1108`, static assets `./public`, and entrypoint `src/cloudflare-qa-worker.mjs`.
- Build command: `npm run build` (copies `web/` to `public/`). Deploy command: `npx wrangler deploy`. Root directory: `/`.
- Test first: `node --test test/cloudflare-qa-worker.test.mjs`. Never paste credentials into files or GitHub issues.

## Unified customer URL and automatic device routing

- Customers use one domain (for example, `https://nuvexapro.com` in a future approved production release). The root URL serves the same verified login for desktop and mobile.
- The **existing** `web/login.html` validates a real session with `/api/account` before selecting the client UI: width at most 700 CSS px goes to `/mobile.html`, and wider screens to `/index.html`. Customers do not manually choose a device site. Administrator login stays role/2FA-based and goes to `/admin.html`.
- These client pages are separate paths **under the same origin**, not separately exposed network ports. This is not yet verified on the live Cloudflare preview.
- Cloudflare assets use the built-in 404 behavior if no asset matches; no unsupported `assets.not_found_handling` value is specified.

## Route and backend rules

- `/` serves the original designed `web/login.html`; `/index.html`, `/mobile.html`, and `/admin.html` remain separate UI files. `/mobile` and `/admin` aliases resolve to their corresponding `.html` pages.
- All `/api/*`, `/health`, and `/ready` requests return HTTP 503 until a trusted **QA** backend is explicitly configured.
- Optional Cloudflare environment variable `QA_API_ORIGIN` must be an approved HTTPS URL ending in `/`, pointing to a backend with its own authentication/authorization and an isolated QA database. Example placeholder: `https://your-approved-qa-backend.example/` (not a working backend).
- The Worker never executes Node `pg.Pool`/database migrations. Do not point it at production DB credentials or expose API tokens in static assets.
- `/api/orders` mutation stays disabled unless `QA_INTERNAL_ORDERS_ENABLED=true` is set *after* authorized integration testing; the backend still must separately enforce quote eligibility and internal trading rules. A static UI preview is not a broker connection.
- This is a same-origin proxy when configured: it forwards Bearer authorization but not browser cookies; backend redirects and unavailable upstream are rejected.

## Release gate

Before any formal launch: verify deployed Worker URL/build SHA, successful authorized login+account lookup, admin TOTP, independent 390/428px mobile routing, 401/403 behavior, account isolation, real permitted quotes, order rejection without valid quote, and browser/network evidence. Preserve old Cloudflare Worker and DNS until reviewed. No claimed live deploy until Cloudflare URL and responses have been checked.
