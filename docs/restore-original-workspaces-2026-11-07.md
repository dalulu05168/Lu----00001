# Restore customer and admin workspaces, 2026-11-07

Requested outcome: restore **original functional customer and admin workspaces** from the last pre-replacement live source, without changing current login or logo, and without losing later admin approval/connection controls.

- Historical baseline: `715dbd47383385013b1139817c5757471786c46f` (Nov 6, 2026, previously live on Render).
- Current deployed service baseline at staging: `ebc375e81dbf992e22aff29c49fa97b44cb16243` (Node Render service `global-stock-qa-preview`, latest known live).
- Restore branch: `restore/frontend-admin-pre-ui-20261107`; target branch for review: `dev/restore-four-role-platform-20261103`.
- Customer: preserve exact current login markup, recover prior full #overview business markup, stop importing front-cn-v3.css/front-cn-v4.css and front-cn-v4.mjs; keep current app.mjs, account services, order endpoints, and mobile-entry.mjs.
- Admin: preserve current login including TOTP, recover original left navigation markup and original admin.css by removing admin-cn-v3.css; retain all current new admin business controls and existing admin.mjs, especially real approval and connection checks.
- No DB, environment, domain, auth, phone source or backend API edits.
- Verify 3 targeted Node tests plus static build; inspect failures in full CI separately. Actual authorized frontend and admin sign-in, live custom-domain UI screenshots, and production data checks are NOT covered by tests.
- **Do not confuse a successful test build with deployment.** Render service only redeploys after a separately coordinated merge to its tracked branch. Production mapping still requires verification.
