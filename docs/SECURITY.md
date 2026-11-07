# Security implementation status

## Implemented foundations
- Passwords hashed with per-password random salt using Node scrypt.
- Session tokens generated with cryptographic randomness; only SHA-256 digests stored.
- Session lookup checks expiry, revocation and account ownership.
- Order API derives account ID from the authenticated session.
- Order API refuses to process orders without trusted server-side price and FX verification.
- No broker order routing.

## Not yet implemented or verified
- Registration/login HTTP routes, CSRF protection for cookie-based sessions, session rotation.
- Request rate limiting, abuse detection, email verification and password reset.
- PostgreSQL deployment and migrations execution against a real database.
- Licensed quote provider and server-side quote entitlement verification.
- Full integration tests, dependency scanning, security audit and production monitoring.

Do not expose this development API to the public internet before these controls are implemented and reviewed.
