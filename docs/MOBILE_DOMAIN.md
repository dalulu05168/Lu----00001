# Mobile subdomain rollout

Customer login and desktop remain at https://www.nuvexapro.com/ (the current
www-to-apex redirect is supported). Mobile users enter through that login, then
navigate to https://m.nuvexapro.com/ after the account API validates their session.
The admin entrance is https://admin.nuvexapro.com/.

## Deployment sequence

1. Deploy this change to the existing Render Node service from the release
   branch. Keep MOBILE_ORIGIN unset initially. The existing /mobile.html route
   continues working during rollout. The existing start command runs migration
   022 before starting the server. Verify /ready returns 200.
2. Attach m.nuvexapro.com to that same service. Check the custom-domain plan and
   any additional charge before attaching it. This change requires all hosts to
   use the same PostgreSQL database. Separate static hosting cannot exchange
   customer sessions.
3. Add the DNS CNAME named m with target global-stock-qa-preview.onrender.com,
   after confirming this is still the service's assigned hostname. Start with
   DNS-only mode. Verify the domain and HTTPS certificate in Render.
4. Check https://m.nuvexapro.com/ serves mobile.html, and /ready returns 200.
   An unauthenticated browser returns to the customer login.
5. Set MOBILE_ORIGIN=https://m.nuvexapro.com on the Render service and deploy.
   Verify /ready, then log in with an authorized QA customer on a phone. Confirm
   the address is m.nuvexapro.com/, refresh works, logout requires login again,
   and desktop and admin login still work.
6. To roll back routing, remove MOBILE_ORIGIN and redeploy. Existing mobile
   browser sessions can still use the same-origin API and the old mobile route.

## Session transfer

POST /api/auth/mobile-session on the exact customer host requires its matching
HTTPS Origin and an authenticated customer Bearer session. With rollout enabled,
it returns a random 60-second exchange code and the allowlisted mobile destination.
The database stores only the code hash,
bound to the original session, with expiry capped by that session's expiry.


On the mobile hostname, POST to the same path checks the exact mobile Origin
and exchange code. A transaction consumes the code, revokes the source session and
creates a replacement customer session with the original expiry. Replay,
expired/revoked source sessions and admin sessions are rejected. Failures roll
back the exchange. This moves the session to the mobile browser origin. Returning
to desktop requires customer login again and honors ?view=desktop.

API tokens remain in per-origin sessionStorage and Authorization headers.
The browser carries the exchange code in the mobile URL fragment, which is
excluded from HTTP navigation requests. The mobile page removes the fragment
before redeeming the code in an Authorization header. No parent-domain
authentication cookie is used.
