# CN Capital — standalone website / Render static-site preview

This branch contains **only** the animated marketing website source at the repo root, not the customer trading portal. The deploy branch was derived from `site/` in `dev/cn-capital-website-20261104`. It intentionally does not contain `web/` or `api/`, so the customer login screen cannot be published by a wrong root-directory selection.

## Render static site
- Source repository: `dalulu05168/global-stock-platform`
- Branch: `deploy/cn-capital-render-static`
- Service type: **Static Site** (not Node Web Service)
- Blueprint: `render.yaml` (this root folder)
- Build command: `node check.mjs && node --check main.js && node build-static.mjs`
- Publish directory: `dist`
- Domain: first verify Render preview `*.onrender.com`, then bind `about.nuvexapro.com` after confirming DNS control and not affecting the client app.
- Brand asset `brand.png` is the original CN Capital file from the authenticated portal.
- The homepage has no customer login, password forms, brokerage trading action or backend API.

## Free hosting caveat
Render has a free static-site tier subject to usage/bandwidth and workspace constraints. No resources have been created automatically by this Git commit. Authorized account access is required to activate the Blueprint, verify status SUCCESS/Live, and check the public URL.

## Checks
`node check.mjs && node --check main.js && node build-static.mjs` checks five pages and creates a whitelisted static publish directory; no internal source/config is published.

## Publication restrictions
Marketing content is labeled PRODUCT PREVIEW. This is not proof of broker connectivity, licensed quotes, legal entity identity, investment authorization or actual asset balances. Legal/operator/privacy details must be independently approved before public launch. `robots.txt` disallows indexing during preview.
