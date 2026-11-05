# Restore four-role terminal — isolated development branch

Restored from the user's previously supplied `NuvexaPro_平台交互预览_四页面.html` (original 4-role visual reference).

This file is a **self-contained UI reference**, not a production trading system. It is labeled paper/demo mode, contains illustrative sample figures, and performs no backend writes. Do not treat sample approval buttons as completed payment/approval functionality. The existing /admin/ password login (TOTP was removed in migration 007), permission checks and customer API remain unchanged.

## Page roles recovered

1. Client-facing terminal: Markets, Trade, Portfolio, Orders, chart with crosshair, watchlist and order ticket.
2. Operations/subadmin: client accounts, trade activity, approval center, cash/funding, reporting, compliance and settings.
3. Master administrator: global overview, subaccounts, all clients, approval center, risk/permissions, treasury/ledger, audit/reports and security settings.
4. Login/role selection preview state (the fourth screen in the user's reference).

## Real functionality already in source tree

Customer register/login/logout; auth sessions; watchlist; account records, positions and internal order records. Master/subadmin password login (no TOTP since migration 007), invite creation, client ownership lists and listing catalog administration. **Do not conflate the visual preview with these APIs**.

## Explicitly missing or blocked

Real broker/market-data connectivity, funds transfer/reconciliation, cash-in/out approval workflows, comprehensive risk/audit enforcement and end-to-end production integration. No real financial actions should be enabled until separate backend design + tests + review.

## Review entrypoint

`web/role-preview.html` (static visual reference; independent of `web/index.html` and `web/admin.html`). No production environment or schema altered.

## Design acceptance

- User's original four-role screen/menu structure restored, not invented from scratch.
- All visible type weight **400**, including headings and inline <strong>.
- High-resolution chart rendering retains existing dynamic crosshair / touch interaction code.
- Role-specific page navigation retained; demo-only financial records remain clearly non-live.
- Independent branch, no release to production.
