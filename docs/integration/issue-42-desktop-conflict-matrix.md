# Issue #42 · 电脑真实业务工作台与共享 QA 的冲突清单
Updated: 2026-11-07. **For review only. Not a deployment or merge approval.**

## Exact branches and evidence
| Subject | Actual source |
| --- | --- |
| PR #19 desktop business UI | `ui/customer-live-terminal-20261107`, SHA `eabc81fb41bf1f643d572de98e596ef41f0865aa` |
| Shared Node QA/Render branch | `dev/restore-four-role-platform-20261103`, QA baseline SHA `0828bdbd5e19ea533e5d91f4d708238e3ae5fb0a` |
| Current default `main` | Different code lineage: `web/app.mjs` blob `3a390aa2...` (33,202 bytes) |
| Live QA business app `app.mjs` | Blob `3ae4e026...` (73,436 bytes), **identical** between PR #19 and QA |
| PR #41 static desktop preview | `work/desktop-front-20261107`; independent static Render live SHA `ad3babfc`; no API |
| Cross-agent isolated browser CI gate | PR #48 `work/desktop-shared-browser-gate-issue42-20261107`, SHA `ce5a6c7e`; not merged |

GitHub compare `dev/restore-four-role-platform-20261103...ui/customer-live-terminal-20261107` returned **diverged: 17 commits ahead / 124 behind**. This PR is not the newest complete business baseline.

## Files and merger instructions
| File | PR #19 (desktop historical) | Shared QA now | Mandatory reconciliation |
| --- | --- | --- | --- |
| `web/index.html` | 26,980 bytes / 366 lines. CN-v4 from earlier era, now branded NUVEXA PRO; original `entryGate`, `entryForm`, `app.mjs` and 3 form handlers retained. `cn-terminal-v4.css` and `cn-terminal-ui.mjs` included. | 34,921 bytes / 502 lines. Existing `front-cn-v3.css` and `front-cn-v4.css`, responsive `cnMobileHeader` tabs, device-mode routing, `mobile-entry.mjs`, `front-cn-v4.mjs`, and explicit simulation disclaimer. | **DO NOT replace entire HTML** with PR #19; that would remove current mobile routing and front-v4 UI. Port N brand/sign-in treatments and carefully graft only missing business controls into the *latest* QA markup. Keep all existing IDs, JavaScript entrypoints and `[hidden]` access gate. |
| `web/app.mjs` | 73,436 bytes, blob `3ae4e026...`. Browser verified HTTP calls to `/api/health`, `/api/ready`, `/api/auth/login` (401 negative fixture), JSDOM original handlers retained. | Same blob, no PR #19 change needed. | **Do not transplant** `main` 33KB `app.mjs` or replace this module. Continue reusing business API. Real authorized account flows still unverified. |
| `src/http-api.mjs` | Static allowlist includes `/cn-terminal-v4.css`, `/cn-terminal-ui.mjs`, `/cn-logo.svg`, `/cn-login-logo.svg`; 18,372 bytes. | 18,467 bytes, has `/admin-cn-v3.css`, `/front-cn-v3.css`, `/front-cn-v4.css`, `/front-cn-v4.mjs`, `/mobile.html`, `/mobile.css`, `/mobile.mjs`, `/mobile-entry.mjs` and admin isolation. | **Union only after backend approval**. Never replace current full allowlist with older PR #19 entry. Preserve admin domain dispatch, API auth/routing/security headers. The browser test PR #19 adds no production admin/phone changes. |
| `web/portal.mjs` | Blob `0e682449...`, original login effects & form-only handling. | Same blob. | Keep the original JS; visual N logo is separate `cn-login-logo.svg` and CSS. |
| `web/cn-login-logo.svg` | New N-only silver 28-second 3D slow spin + star points, reduced-motion support. | Older CN mark. | Customer-only asset currently used by login; check if other clients share path before integration. Admin currently uses `cn-capital.png`, but confirm exact production references again at merge. |
| `web/admin.html` | PR19 branch older blob `a9fa7a8a...` (42,016 bytes). | Newer blob `8451c334...` (42,748 bytes). | Preserve the newest QA admin file untouched; admin owner PR #46 handles its own tests and TOTP. |
| `web/mobile.html`, `web/mobile-entry.mjs` | Not in PR #19 historical branch. | QA has both (mobile.html 2,116 bytes, mobile-entry.mjs 1,256 bytes); mobile owner has separate newer mobile.html (2,135 bytes). | Must not delete, shadow or overwrite. Desktop must defer device routing to current accepted mobile contract. |

## Tests with actual evidence and precise limits
- PR #19 latest Chromium isolated 1440x900 browser: **Actions #42329135925 SUCCESS**. 5/5 original business DOM/route tests passed, no browser page exceptions; negative mocked 401 from `/api/auth/login` refused; screenshot artifact `desktop-live-chromium` ID 13556886073. **This does not authenticate a real customer**.
- PR #41 static desktop preview: **Actions #42329938180 SUCCESS** (4/4 unit tests + Chromium). Screenshot artifact `desktop-preview-chromium` ID 13557400192; no API requests, no fake zero balances. **Static-only, not business**.
- Cross-agent QA browser gate: isolated PR #48 on QA baseline, **Actions #42329529970 SUCCESS** (221 tests pass, 24 skip; PostgreSQL 7/7; desktop/browser screenshots). **Unmerged**.
- Historical main-based Platform checks at PR41 SHA `9e2afb...`: **Actions #42329938188 FAILURE**, 91 total / 69 pass / 19 fail / 3 skip. Broad baseline failures still include 17 public API live-site network tests and 2 old style tests. Do not claim global green.
- Render static desktop preview `dep-dbn8h6c9v7es73c1iqi0`, SHA `ad3babfc`, status live; auto deploy off. The new test script/CI only changes were not redeployed, and app UI source was not modified by these tests.
- Render QA is tracking `dev/restore-four-role-platform-20261103` (at last confirmed deployed QA SHA `0828bdbd...`). **PR #19 not deployed to QA or production.**

## Authentication/production blockers
1. Customer desktop `/api/auth/login` currently uses email/password then bearer token; **client 2FA requirement not defined or verified**. Do not confuse MASTER/SUBADMIN TOTP coverage with customer 2FA; request backend contract before changing login.
2. Without a safe, authorized same-origin integration environment/test account, no proof of real-login account, funding, identity, bank, customer support or orders. Never use fake balances/quotes as a substitute.
3. Confirm effective SHA at `nuvexapro.com`, `www.nuvexapro.com`, `admin.nuvexapro.com`, then test mobile routing and login after integration; external GET of the old page alone is not evidence of upgraded UI.
4. No DNS/production/QA branch change, database mutation, shared credential or production-write action has been carried out from this PR.
5. Repository ID 1441689940 is currently named `dalulu05168/Lu----00001` and GitHub exposes it as **public**. The rename and visibility change were NOT performed by this desktop window; total command should confirm authorization and check for exposed secrets.

**Proposed merge sequence:** backend + phone approve exact route/API contracts → cherry-pick only customer-specific N visual + audited DOM additions onto latest QA branch in a fresh isolated PR → all targeted and cross-platform CI green → authorized same-origin browser account tests → total commander production SHA approval. Do not auto-merge #19/#41/#48 as a single diff.
