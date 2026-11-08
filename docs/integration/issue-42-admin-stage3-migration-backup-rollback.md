# Issue 42 — Stage 3 administrator DB migration / restore gate

**This is a candidate for an isolated throwaway PostgreSQL 16 database, not an authorization for Neon QA, Neon main or production.** Do not copy from this document into shared/production databases without the total controller explicitly selecting exact Git source SHA, running service SHA, branch/database identifier, backup owner, recovery window and rollback approver.

## Verified with read-only Neon queries (2026-11-08)

| Environment | Neon branch | schema_migrations rows | Last filename | TOTP step column | order_execution_evidence |
| --- | --- | ---: | --- | --- | --- |
| QA reference | `br-shy-poetry-b3kzsxug` | 23 | `022_mobile_session_handoffs.sql` | absent | absent |
| main | `br-crimson-morning-b3rhjeoi` | 6 | `005_admin_roles_and_catalog.sql` | absent | absent |

These two DB histories must **not** be assumed interchangeable. QA's older 001–022 is the sole current schema reference for the candidate SQL; main cannot run 023/024 in isolation. Existing checks include US/CN in `orders`/`positions`, but `listings`/`watchlist_items` retain historical RO, while `internal_stock_sales` is US-only. A future application-level market gate must prevent **new** RO orders without deleting old records.

## Candidate dependency decisions

- `migration-candidates/023_admin_totp_replay.sql` adds a nullable `admin_roles.last_login_totp_step bigint` plus nonnegative CHECK. It requires QA's `admin_roles` and existing two-step `admin_totp_challenges`. It must precede setting `ADMIN_TOTP_REPLAY_GUARD_ENABLED=true`; without the column, fail closed rather than deploying the enabled code.
- `migration-candidates/024_internal_order_quote_evidence.sql` adds `order_execution_evidence` with FKs to `orders` and `accounts`, an index, market/currency and FX evidence CHECK. It does **not** depend on the 023 column at the SQL table level; use 023 then 024 after QA migration 022 for a single orderly sequence.
- 024 records *claims* about `quote_license_ref`, `session_rule_ref` and FX metadata. The CHECK does **not** independently validate a provider's commercial license, a real FX feed, or that evidence matches another table's full transaction values. The trade service and verified receipt must perform that consistency and entitlement verification. Never turn the candidate table's existence into permission to trade.
- Both scripts are intentionally outside auto-run `db/` migrations. If an approved migration journal already reserves the numbers 023/024, rebase/re-number after investigating; do not overwrite.
- Existing admin endpoint `GET /api/admin/client-analytics` requires authenticated MASTER/SUBADMIN, server-side client ownership and successful `admin_mirror_access_log` insert. It consumes existing FIFO ledger history; it does not fabricate unavailable market P/L.

## Disposable migration + backup/restore test

Workflow: `.github/workflows/admin-stage3.yml` on `dev/admin-stage3-compatibility-20261108`.

1. Start **ephemeral** PostgreSQL 16 container with database literally `admin_stage3_isolated`; apply unchanged QA 001–022 with `npm run migrate`.
2. Seed two test-only users/accounts/ledger entries (never real customer records). Store a **full physical restore-capable logical backup** with `pg_dump --format=custom`, validate archive using `pg_restore --list`. Backup lives in runner `/tmp`, not in Git or an artifact.
3. In the same disposable database, explicitly apply candidate 023 and 024, assert columns, FKs, CNY FX schema, persistence of pre-existing cash/ledger and `schema_migrations`, transaction rollback on invalid order/evidence, and absence of phantom orders.
4. In that database, reverse only **newly added candidate objects** (`DROP TABLE order_execution_evidence`; drop 023 CHECK then its column). Assert old accounts, ledger and migration history still match the pre-migration snapshot. The destructive DDL is permitted **only within this ephemeral test container**, never on shared QA or main.
5. Create **another empty** database `admin_stage3_restore`, perform genuine `pg_restore --exit-on-error` from the pre-migration backup, then verify both test account balances and cash ledger rows exactly equal the pre-migration fixture, the full 001–022 migration count is still 23 and neither candidate schema object exists.
6. Run the existing stage 2 administrator PostgreSQL HTTP/2FA test on disposable source: password+TOTP login, concurrent replay prevention, expiry, MASTER/SUBADMIN ownership, anonymous 401, customer 403, out-of-scope 404, finance audit failure refuse, and old admin route/regression.
7. The workflow MUST be `completed/success` at the *exact same final SHA*. If it fails before tests run, no passing claim is allowed. Require separate approved and encrypted offsite backup, restoration drill, and roll-forward plan before shared QA migration, because a DDL rollback alone cannot reverse real financial ledger writes or issued TOTP sessions.

## Production-safe rollout / recovery gate (not executed)

Record at least source + service SHAs, actual `DATABASE_URL` resolved branch, schema journal and `pg_catalog` probes, backup timestamp, archive checksum, target RPO/RTO, legal data access approval and maintenance window. Disable trading and new admin deployments; take immutable encrypted backup with access control. In a private test clone restore that archive, run migration and admin regression. Only after approval apply 023/024 to the selected target and verify columns, permission grants, normal logins and the verified trade receipt; turn on TOTP replay feature flag only after 023 is present and 2FA tests pass. In any failed pre-release gate, disable feature flag and restore the approved backup under operator control, reconcile any post-backup sessions and ledgers before reopening.

**Actual execution status:** previous stage 2 ephemeral PG admin test succeeded. Stage 3 special workflow's run result must be read separately; no real shared database migration, no backup of real users, no deployment, no UI edits.
