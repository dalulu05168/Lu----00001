# Independent Render QA deployment

This is the **isolated review service** for `dev/restore-four-role-platform-20261103`. It does **not** change `global-stock-platform.vercel.app`, the original Vercel project or GitHub default branch.

## Service
- One Render **free** Node web service called `global-stock-qa-preview`.
- Region: Singapore; Node server entry point: `src/server.mjs`.
- Deployment target: this GitHub development branch only; automatic redeploys disabled.
- Health check: `/ready`. Do not claim success merely because `/health` answers.
- Client: `/` and administrator: `/admin.html` on the new `.onrender.com` preview host.
- The application is an internal stock-record system, **not a broker**. Live orders are disabled without verified pricing.

## Secrets (never commit, paste in chat or attach screenshot containing values)
The initial Blueprint setup will ask for:
1. `DATABASE_URL`: **QA Neon branch** `qa-app-mirror-20261103` (branch ID `br-shy-poetry-b3kzsxug`), database `neondb`, from `global-stock-platform-free`. NEVER use the original `main` branch URI.
2. `ADMIN_MASTER_EMAIL`: authorized QA admin identity. Not a password.
3. `ADMIN_BOOTSTRAP_SECRET`: unique random setup proof, **at least 32 characters**. Avoid production value.
4. `ADMIN_TOTP_ENCRYPTION_KEY`: unique random **64-character hexadecimal** key for QA. Never reuse or replace the production 2FA key.

The QA Neon branch already has `006_admin_mirror_access.sql` and has been checked separately from `main`. It is a copy-on-write snapshot of existing data; treat it as sensitive and do not advertise it publicly. Do not give it production trading permissions.

Once deployed, create or activate an admin through the existing secure 2FA enrollment, then verify both roles and the client App mirror. Check `/ready`, client login, admin 2FA, subadmin isolation, and mirror access audit records. **No production migration or domain change should occur.**

## Open a branch-specific Render deployment
Use the Render "Deploy to Render" button URL:

`https://render.com/deploy?repo=https://github.com/dalulu05168/global-stock-platform/tree/dev/restore-four-role-platform-20261103`

Because the repository is **private**, the Render account must authorize access to this repository before it can read this Blueprint. Opening the link does **not** mean the app has been deployed; review secrets, plan, branch and service before submitting.
