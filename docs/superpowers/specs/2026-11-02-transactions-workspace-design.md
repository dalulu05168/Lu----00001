# Transactions Workspace UI Design

## Intent
Replace the current light, icon-only portfolio shell with a dark, labeled financial workspace based on the user's supplied Transactions screenshot. The first viewport becomes a transaction-history workspace; existing account, holdings, market-watch, chart, catalog, and account-management functions remain accessible from the sidebar.

## Goals
- Use a charcoal interface with restrained borders, white primary text, muted secondary text, green buy/positive accents, and amber pending/unavailable accents.
- Provide a labeled left sidebar and a transaction-first main view with summary cards, filters, a transaction table, pagination, and CSV export.
- Make the transaction list read only from the authenticated account snapshot returned by `/api/account`.
- Derive transaction volume only from valid `amount_usd_cents` values.
- Keep realized P/L unavailable until a supported lot-matching calculation exists.
- Clearly label orders as internal records; never imply broker routing, matching, or settlement.
- Preserve existing login, holdings, market selection, chart, watchlist, catalog, account, and order-entry safeguards.
- Keep desktop dense and responsive; make the table horizontally scrollable on small screens.

## Non-goals
- No database schema, authentication, API, market-data, or broker-execution changes.
- No fabricated transaction rows, prices, profit figures, pending counts, or user identity.
- No new AI, inbox, notification, dividend, or financial-advice features.

## Anti-goals
- Do not copy the sample Indonesian tickers, values, names, or statuses from the reference screenshot.
- Do not mark internal ledger entries as broker-matched trades.
- Do not remove existing app sections to imitate the reference more literally.

## Data semantics
- Orders come from `account.orders` in the existing account API response.
- `price_cents` is the order's stored instrument price in its market currency; render it with the market's configured currency.
- `amount_usd_cents` is the stored USD-equivalent notional; aggregate only valid non-negative integer values.
- `created_at` is optional; missing or invalid timestamps render as unavailable and do not qualify for relative-date filters.
- The platform has no broker transport. The UI must show internal-only records and broker status as not connected.
- Realized P/L remains `—` because no realized-lot matching result is exposed by the current API.

## Approaches considered
1. Restyle the existing overview only: least code, but it does not provide the Transactions page shown in the reference.
2. Add a transaction-first workspace and restyle the existing shell while retaining all current sections: chosen because it matches the requested screen without replacing business logic.
3. Rebuild the platform from scratch: rejected because it risks losing existing account and safety behavior.

## Chosen approach
Implement approach 2 in the existing static frontend. Add the transaction view and navigation in `web/index.html`, dark visual tokens and responsive layout in `web/styles.css`, data-driven rendering/filtering/pagination/CSV export in `web/app.mjs`, and regression tests in `test/`. Do not change the backend or database.
