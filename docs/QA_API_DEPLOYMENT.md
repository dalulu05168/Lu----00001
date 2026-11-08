# CN Capital QA API Deployment

This branch deploys the existing Node API as an independent QA Web Service. It is separate from the static UI service and must use a dedicated QA PostgreSQL database.

Render uses `npm install --omit=dev` as the build command and `npm run migrate && node src/server.mjs` as the start command. Readiness is checked at `/api/ready`; liveness is available at `/api/health`.

Required Render values are `DATABASE_URL` and `ADMIN_MASTER_EMAIL`. Render generates `ADMIN_BOOTSTRAP_SECRET` and `ADMIN_TOTP_ENCRYPTION_KEY`. Do not connect this service to a production database or add broker credentials. Orders remain fail-closed until a verified server-side pricing provider is configured.
