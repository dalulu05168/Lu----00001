# Local backup and alerting implementation plan

> For agentic workers: use superpowers:executing-plans to implement the following tasks sequentially.

**Goal:** Create recoverable encrypted production backups under the desktop 手机端 folder and send operational alerts to dalulu05168@gmail.com.

**Architecture:** Add a separate operations directory; production application code and configuration remain unchanged. Use PostgreSQL 17 tools over a direct TLS connection, read-only snapshot export, encrypted local archives, and restoration into a disposable localhost database. Alerts contain aggregate operational status only.

**Tech stack:** PostgreSQL 17 client/server binaries, Python standard library, Windows DPAPI, Node.js existing pg driver, Codex recurring automation/Gmail connector where appropriate.

**Spec:** User approved local backup destination and alert recipient in this conversation.

## Global constraints
- Do not modify production business records, existing deployment, routes, DNS or passwords.
- Backups and credentials never enter Git; no plaintext secrets in logs.
- Do not delete older backup files automatically.
- No paid services or duplicate cloud projects.
- Scheduling depends on this Windows computer and, for agent email dispatch, Codex being available; disclose this limitation.

## Review focus
- A corrupted or truncated archive must fail verification and never be described as recoverable.
- Export must use one consistent database snapshot for content and verification hashes.
- A restore command must be restricted to a new isolated localhost database.
- Secrets and identity images must not appear in alert emails or source control.
- Offline computer, unavailable mail integration, expired credentials and overlapping runs must produce explicit status.

## Task 1: PostgreSQL tooling and credential storage
- [x] Fetch official PostgreSQL 17 binaries; record origin, version and archive hash.
- [x] Reuse the authorized Neon branch connection; protect credential material with Windows DPAPI and restricted filesystem access.
- [x] Verify read-only TLS connectivity without printing credentials.

## Task 2: Backup and restoration
Files: cloudflare-release/ops/*; desktop 手机端/安全备份/* (ignored runtime data).
- [x] Write integrity/encryption and local restore boundary tests, run them, implement the backup runner.
- [x] Export custom-format pg_dump from a consistent read-only snapshot with metadata and per-table digests.
- [x] Encrypt archive; restore into a fresh localhost database and compare all table digests, constraints and sequences.
- [x] Save redacted evidence, operational instructions and a manual launcher.

## Task 3: Monitoring, email and scheduling
- [x] Implement public health and aggregate security checks, backup freshness check, alert deduplication and recovery tracking.
- [x] Test failure and recovery scenarios with isolated fixtures.
- [ ] Configure a recurring run with the authorized local automation facility; use connected Gmail to send only incidents/recoveries to the approved address.
- [ ] Send a setup verification email and save its provider receipt without secrets.
- [ ] Confirm the created schedule and preserve runtime state outside Git.

## Task 4: Delivery
- [ ] Commit/push operations code and redacted evidence only.
- [ ] Record what is verified, what depends on the local computer, and that offsite redundancy remains outstanding.

## Execution rulings and evidence
- Native Windows tasks perform deterministic daily backups and 15-minute monitoring without requiring an AI turn. The hourly Codex heartbeat handles approved email delivery.
- Existing RLS denied all backup rows; added SELECT-only policies to the dedicated read-only role. Verified no INSERT/UPDATE/DELETE/TRUNCATE/CREATE/sequence UPDATE privileges.
- Windows PostgreSQL initdb required an ASCII temporary path. Recovery uses a current-user-only localhost temporary directory and removes only the just-created drill directory.
- SET TIME ZONE UTC ensures timestamps hash identically; a narrowly tested normalizer handles PostgreSQL equivalent varchar-array constraint coercions. No data differences are discarded.
- Scheduler execution was tested: backup and monitor returned 0 after fixing simultaneous-run lock contention.
- Gmail became unavailable during execution; a reconnect suggestion was made. No setup email has been sent and email delivery is not accepted.
- The first verified archive restored 37 tables, 190 rows, 197 constraints, one sequence and matching RLS policies; backup verification repeated successfully via Windows Task Scheduler.
