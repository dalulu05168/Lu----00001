# Server API contract (local source, not a deployment claim)

Verified against the admin development line based on `0f38a65`. Both the Node server and Vercel adapter delegate to `src/http-api.mjs` / `src/admin-http.mjs`. Database migrations through `011_commodities_support.sql` are required. Do not run migrations against an existing service without separate authorization.

## Authentication and role boundaries

Send `Authorization: Bearer <session token>` on protected requests. Customer sessions expire after 24 hours; password-verified administrator sessions after 30 minutes. The resolver checks expiry, revocation, account ownership and login policies on every request. Administrator tokens cannot use customer account/order endpoints. Customer tokens cannot use administrator endpoints. Missing/revoked sessions return 401; insufficient role returns 403; scoped objects outside an administrator's access return 404.

`MASTER` can see non-administrator customers and manage its child subadmins. `SUBADMIN` can see only customers linked through `client_links`, inspect its own controls, and perform permitted preliminary workflow reviews. UI visibility never substitutes for these server checks.

## Client and common endpoints

| Method | Path | Contract |
|---|---|---|
| GET | `/health`, `/api/health` | Process liveness; explicitly reports broker disconnected |
| GET | `/ready`, `/api/ready` | Database table availability for core, customer, admin and audit routes; 503 on missing tables/unavailable DB; not proof of broker connectivity or full schema/permission acceptance |
| POST | `/api/auth/register` | `{email,password,inviteCode?}`; zero opening funds; server derives customer/account IDs |
| POST | `/api/auth/login` | `{email,password}`; customer-only token and expiry |
| POST | `/api/auth/logout` | Revokes the current customer token |
| GET | `/api/account` | `{account:{id,cashCents,currency},positions,orders,disclosure}`; last 100 orders, authenticated account only |
| GET/POST/DELETE | `/api/watchlist` | GET returns `{items}`; mutations accept `{market,symbol}`, authenticated account only |
| GET | `/api/catalog` | Authenticated published securities metadata only; no purchase credentials or discounts |
| GET/POST | `/api/requests?category=FUNDING\|KYC\|BANK_LINK` | Own requests only; POST bodies described below |
| GET | `/api/commodities` | Published administrator-maintained commodity directory, not live exchange quotes |
| GET/POST | `/api/support` | Own support thread/messages; POST `{message}` |
| POST | `/api/orders` | `{market,symbol,side,quantity}` and `Idempotency-Key`; requires a published eligible security and trusted fresh server pricing; default server has no pricing adapter and returns 503 |

Funding request body: `{kind:'DEPOSIT'|'WITHDRAWAL',amountCents}` (integer 100–100000000); withdrawal policy enforced. KYC intake body: `{}`. Masked bank registration: `{bankLabel,accountLast4}`. None performs payments, stores identity documents or verifies bank ownership. Loan eligibility is a stored policy flag; no loan workflow endpoint is implemented.

## Administrator endpoints

All paths below are prefixed `/api/admin`. Except login/setup/recovery, they require a valid administrator session.

| Method | Path | Behavior |
|---|---|---|
| POST | `/login` | `{email,password}`; returns `{token,role,expiresAt}` |
| POST | `/bootstrap`, `/recover-pending-master` | `{email,password,setupKey}`; configured master identity and secure bootstrap proof; recovery restricted to pending setup |
| POST | `/logout` | Revokes the bearer session |
| GET | `/me` | Server-verified `{role,userId}` |
| GET/POST | `/subaccounts` | Scoped directory; creation MASTER only, `{email,password}` |
| GET | `/clients` | Scoped customer directory, up to 500 rows |
| GET/PATCH | `/subaccount-controls` | GET `?userId=UUID`; PATCH MASTER only: `{userId,loginAllowed,expectedVersion,reason,confirmPassword}` |
| GET | `/subaccount-control-audit?userId=UUID` | Authorized child/self login-policy changes |
| GET/PATCH | `/client-controls` | GET `?clientId=UUID`; PATCH MASTER only, body below |
| GET | `/client-control-audit?clientId=UUID` | Before/after values, actor, reason, time |
| GET | `/client-history?clientId=UUID&limit=20&cursor=...` | Combined funding/KYC/bank history, keyset pagination, limit 1–50; `{items,hasMore,nextCursor}` |
| GET/PATCH | `/workflow-requests` | GET `?category=...&clientId=UUID` (client optional); PATCH `{category,id,expectedStatus,status,reason}`; scope and status transitions checked |
| GET | `/workflow-audit?clientId=UUID` | Scoped customer workflow changes |
| GET | `/mirror-status` | `{ready,mode:'READ_ONLY'}`; checks mirror audit table availability |
| GET | `/mirror?clientId=UUID` | Scoped database account/watchlist snapshot; access logged before data returned |
| GET | `/mirror-audit` | MASTER sees all mirror reads; SUBADMIN sees its own reads; last 80 |
| GET | `/audit-events?limit=100` | Combined client policy/workflow/mirror/support plus MASTER-only commodity/subadmin changes; limit 1–200 |
| GET/POST/PATCH | `/listings` | Securities metadata directory; writes MASTER only; edit metadata only while draft |
| GET/POST/PATCH | `/commodities` | Commodity directory; writes MASTER only |
| GET | `/commodity-audit?id=UUID` | MASTER commodity change history |
| GET/POST/PATCH | `/support` | Scoped threads; POST reply, PATCH status change with reason and expected status |
| GET | `/support-thread?threadId=UUID` | Scoped thread and messages |

Client policy PATCH: `{clientId,field,value,expectedVersion,reason,confirmPassword}`. Fields: `loginAllowed`, `withdrawalRequestsAllowed`, `loanRequestsAllowed` (booleans), `vipTier` (`STANDARD`, `SILVER`, `GOLD`, `PLATINUM`), `accountClass` (`SIMULATED`, `REAL_PENDING`, `INTERNAL`). Version must match; reason must be 12–400 characters; password re-confirmation is required. Changes and before/after audits share a transaction. Disabling login revokes existing sessions. Concurrent stale writes return 409. Incorrect confirmation returns 401 without invalidating an otherwise valid browser session.

Mirror response: `{client,account,positions,orders,watchlist,mode,checkedAt,disclosure}`. It reuses customer account/watchlist services and never impersonates a customer token. Missing mirror audit schema returns 503; an audit insert failure returns a generic error and no snapshot. This is a stored-account view, not a live phone screen or broker record.

## Validation limits

See `admin-integration-validation.md` for actual local tests and remaining visual/deployment acceptance. Process liveness, readiness, automated DOM checks, database tests and production acceptance are distinct. No deployment, DNS change or production-data write is part of this work.
