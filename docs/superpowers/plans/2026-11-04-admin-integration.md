# Admin integration implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. The user approved the implementation scope on 2026-11-04.

**Goal:** Verify and complete the existing admin/client integration without deployment or production writes.
**Architecture:** Preserve the existing Node HTTP handlers, PostgreSQL services, and browser controllers. Fix observed authorization/display lifecycle failures rather than introduce a new permission model.
**Tech Stack:** Node.js ES modules, pg, node:test, jsdom.
**Spec:** ../specs/2026-11-04-admin-integration-design.md (user-approved scope).

## Global Constraints
- Only this repository; local branch codex/admin-integration-20261104 from 0f38a65.
- No push, deployment, domains, existing QA/production DB connections or migrations.
- Keep MASTER/SUBADMIN scope and read-only account snapshot semantics.

## Review Focus
- Logout/login with old requests pending must not restore prior-user data.
- Expired/revoked sessions must clear privileged browser data.
- Client/subadmin switching must clear old policy readouts before fetching new ones.
- Missing frontend modules must fail tests, not silently break charts.
- Missing admin schemas and failed mirror auditing must not be reported as ready/successful.

### Task 1: Baseline and local compatibility
- [x] Install declared dependencies without lifecycle scripts or manifest changes; run npm test.
- [x] Fix test/render-blueprint.test.mjs newline portability without changing render.yaml.
- [x] Test local static routes for every module imported by web/app.mjs; fix src/http-api.mjs allowlist if needed.

### Task 2: Admin session and customer lifecycle
Files: web/admin.mjs, test/admin-session-isolation.test.mjs.
Interfaces: api(path, options) returns parsed authorized response or throws; resetAdminSession() clears private controller/DOM state.
- [x] Add failing DOM tests using delayed directory/audit responses across logout and another-role login; assert no stale data appears.
- [x] Add failing 401 expiry and client/subadmin policy-switch tests.
- [x] Introduce one reusable reset and centralized stale-session response rejection; preserve existing selection serial checks.
- [x] Run targeted tests and full npm test.

### Task 3: API and audit verification
Files: src/readiness.mjs, src/admin-http.mjs, test/admin-api-integration.test.mjs, test/http-api.test.mjs.
- [x] Verify actual client account/watchlist responses equal mirror responses for scoped users; audit failure returns no protected snapshot.
- [x] Verify readiness covers tables used unconditionally by admin/client APIs; add failing tests then minimal fix.
- [x] Correct unreachable error mapping only where reproduced; never expose arbitrary internal errors.
- [x] Run targeted/full tests; database integration only if a fresh isolated local PostgreSQL is available.

### Task 4: Documentation and final validation
Files: docs/API.md, docs/INTEGRATION.md, docs/admin-integration-validation.md.
- [x] Replace obsolete planned/not-implemented claims with actual source contracts, permissions and known limits.
- [x] Record exact test results and database/browser acceptance gaps.
- [x] Run npm test, npm run build, syntax checks and git diff --check; review changed files; leave local branch unpushed.

## Execution record
- Preserved current controller/services; no permission-model or native APP branch expansion.
- Windows baseline failure reproduced and fixed in the test only; render.yaml unchanged.
- Current app.mjs imports market-allocation.mjs, already covered by the passing local static-route test. stock-chart.mjs is not imported by the current application; no chart behavior was added or claimed.
- Added regression tests were observed failing before corresponding product fixes; password-confirmation and delayed /me tests also verify existing behavior remains correct.
- Full verification on a fresh local PostgreSQL 16 database: 136 tests, 119 passed, 0 failed, 17 explicit external-site skips. Migrations applied twice successfully.
- Build, changed JavaScript syntax checks and git diff --check passed. Independent review found no blocking defect.
- Existing live-site checks referenced another website; replaced automatic CI activation with explicit target/opt-in and a no-network regression test.
- Local PostgreSQL process stopped; synthetic fixtures retained. No existing QA/production database or deployment was accessed.
- Remote branches unchanged. Local delivery only, per approved scope.
