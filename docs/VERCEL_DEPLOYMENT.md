# Vercel Hobby deployment

Deploy the repository's `dev/platform-v1` branch as a preview first.

## Project settings
- Team: the existing Hobby team
- Project name: `global-stock-platform`
- Root directory: `./`
- Framework preset: Other
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `public`
- Development command: leave empty
- Node.js: 20 or newer

The build script copies the static terminal from `web/` into `public/`. The API is served by `api/[...path].mjs`.

## Database environment
The site can be deployed as a static preview without database variables, but account registration, login, and account reads will return 503 until PostgreSQL is configured.

After creating a free PostgreSQL database, set these encrypted Vercel environment variables for Preview and Production:
- `DATABASE_URL`: pooled PostgreSQL connection string for serverless API requests.
- `DATABASE_URL_UNPOOLED`: direct/unpooled PostgreSQL connection string for migrations.
- `PGSSL=require`: only if required by the database provider's connection instructions.

Never commit credentials to Git. Run `npm run migrate` against the direct connection before enabling account workflows. Verify `/api/health` and `/api/ready` after deployment.

## Safety boundary
- No broker credentials are required or accepted.
- No live broker order-routing integration is present.
- The order endpoint remains disabled until a licensed market-data/FX pricing provider and a server-side pricing policy are configured.
- Keep the first deployment as a preview; do not represent it as a production brokerage service.
