# Security implementation status

## Implemented foundations
- Passwords hashed with per-password random salt using Node scrypt.
- Session tokens generated with cryptographic randomness; only SHA-256 digests stored.
- Session lookup checks expiry, revocation and account ownership.
- Order API derives account ID from the authenticated session.
- Order API refuses to process orders without trusted server-side price and FX verification.
- No broker order routing.
- Login, registration, admin login, master bootstrap and recovery are throttled in process
  (`src/auth-rate-limit.mjs`): 8 failed passwords per email per 15 min, 50 failed attempts per
  client address per 15 min, 10 registrations per address per hour. Responses are 429 with Retry-After.
- Unknown-email logins run the same scrypt work as wrong-password logins, so timing does not reveal registered emails.
- Every response from the Node server carries nosniff, X-Frame-Options DENY, CSP frame-ancestors 'none',
  Referrer-Policy and Permissions-Policy (Render does not apply vercel.json headers).
- Withdrawal requests and approvals require a bank account the master has reviewed and bound.

## Not yet implemented or verified
- Registration/login HTTP routes, CSRF protection for cookie-based sessions, session rotation.
- Rate-limit counters are per instance and reset on restart; multi-instance or serverless
  deployments need a shared store. The client address is the right-most X-Forwarded-For entry
  unless AUTH_CLIENT_IP_HEADER names a trusted edge header (for example cf-connecting-ip behind Cloudflare).
- Abuse detection, email verification and password reset.
- PostgreSQL deployment and migrations execution against a real database.
- Licensed quote provider and server-side quote entitlement verification.
- Full integration tests, dependency scanning, security audit and production monitoring.

Do not expose this development API to the public internet before these controls are implemented and reviewed.
