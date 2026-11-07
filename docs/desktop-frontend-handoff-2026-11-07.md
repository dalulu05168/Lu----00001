# Desktop frontend checkpoint — 2026-11-07

**Scope:** `work/desktop-front-20261107` affects desktop customers only. Mobile agent owns `web/cn-terminal.html` and `web/cn-terminal-bridge.mjs`, admin agent owns admin/backend. Neither set of files was edited here.

**Entrypoints:** Shared auth at `/` continues to call original login and account APIs. In `web/cn-entry-redirect.mjs`, width <=900px continues to `/cn-terminal.html`; other viewports go to isolated `/desktop.html` backed by `/desktop-bridge.mjs`.

**Desktop:** Independent NUVEXA PRO page consumes authorized `/api/account`. No fixed demo account/cash/orders, no synthetic generated OHLC, no fake discounts. TradingView widget may be opened separately and must not serve execution prices. Portfolio total/realized P&L cannot be accurately calculated without position cost basis, displayed as unknown. Trade disabled pending validated pricing. Application history and chat are not wired to real data; no mock history is presented.

**Check:** `node --test test/desktop-entry.test.mjs`. Full CI and real browser login still need independent checks.

**Release boundary:** Vercel `global-stock-platform` not confirmed to serve either `nuvexapro.com` or `www.nuvexapro.com`. A Vercel preview build is not equivalent to the actual user-facing domain. Check parallel agents and production mapping before merging.

## Render independent preview (2026-11-07)
- Render service `srv-dbn8bhugekts739c0070` in Lu workspace, connected to this desktop branch. 
- Static build `npm run build`, publish `public`, auto deploy **off**.
- Render reported initial deployment `dep-dbn8bi6gekts739c0140` as `live` from commit `0629f448`.
- UI-only read-only URL: `https://nuvexa-desktop-preview-20261107.onrender.com/desktop.html?preview=1`.
- The `?preview=1` path does not call API or load account balances; values display dashes. It is **not** a functional trading/login deployment.
- No DNS or production custom domain modifications.
