# Account deletion: operations and legal-release blocker

Branch: `dev/mobile-store-readiness-20261104`.

## What is implemented
- Authenticated `GET /api/account/deletion-request`: current user's request status.
- Authenticated `POST /api/account/deletion-request`: recheck current password and exact confirmation phrase; creates or reopens a REQUESTED request scoped to the server-resolved user ID.
- Public customer web entrypoint `/account-deletion`: works without installing an App, signs in against existing API, requests deletion, attempts to revoke the temporary session, and never puts the session token in a URL or browser storage.
- Native App account-settings entrypoint, with password verification and correct pending/complete wording.
- Migration 012 stores the request; the table is private to server DB role.
- A scoped, read-only admin queue is exposed as GET `/api/admin/deletion-requests` and shown under the existing Risk & Permissions pane; admins can see pending items but cannot mark erasure as complete.
- Each request is a real persisted intake, **not a completed erasure**.

## Not implemented; store submission blocked
- Actual authorized admin processing/completion interface and accountable operator to pick up and resolve requests. The read-only queue does not complete them.
- Documented identity verification exceptions/retention grounds, approved by the operating entity and counsel.
- Actual deletion/anonymization of related records across app_users, accounts, orders, positions, cash_ledger, support messages, bank requests, KYC workflow, audit trails, admin mirror and policy records, with legally required exceptions.
- Terminal status change to COMPLETED ONLY after a verified erasure operation. Never manually mark COMPLETED as a substitute for deletion.
- Unauthenticated password-recovery pathway for someone who cannot sign in to app or browser; support option subject to operational policy.
- Published public privacy policy describing retention, deletion, responsible entity, contact, sharing, jurisdictions and provider roles.
- Live web deployment verification, staffing, handling SLA, final-operation audit trail and post-deletion login denial test.

## Security obligations
- Never infer a client account from a supplied customer ID, email, or request header.
- Do not weaken existing authentication to satisfy a store checklist.
- Never delete financial/audit records until legal retention and referential dependencies are evaluated.
- Never use a fake completed status or a placeholder legal contact to bypass App Store/Google Play review.
- In-app request status can remain REQUESTED; review and actual erasure are separate actions.

Reference: Apple App Review 5.1.1(v), Google Play User Data and Account Deletion requirements.
