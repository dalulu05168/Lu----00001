# NuvexaPro — native customer mobile client (Android / iOS)

Independent React Native/Expo 58 client built from the existing customer-facing GitHub frontend.
This folder is a **development deliverable**; it is NOT an already-built APK/IPA or a published store listing.
It does not alter the web frontend, administrator frontend, database or broker execution.

## Functional scope
- Native customer login, secure device session storage, server-side authentication.
- Real server-backed account summary, internal positions and recent internal order history.
- Server-backed watchlist create/delete, with the four market codes that the existing API accepts.
- Customer support conversation GET/POST using the existing server endpoint.
- Pull-to-refresh, filtered transaction list and explicit user-initiated CSV text sharing.
- Never invent quotes, investment P/L, funds custody, actual broker fills or instrument ownership.

## Configure
1. Install Node.js >=22.13 and run `cd mobile && npm install`.
2. Run `npx expo install --fix` to align native dependency versions with the installed Expo SDK.
3. Configure `EXPO_PUBLIC_API_BASE_URL` via a local .env file or Expo Build environment;
   it must be the verified HTTPS origin of the API server (e.g. `https://actual-host`, no /api suffix).
   DO NOT point this at unverified preview infrastructure or a different customer's API.
4. `npm run typecheck` / `npm test`, then `npx expo start` for local development.
5. The existing platform SVG logo is kept at assets/brand.svg; npm postinstall uses sharp to generate 1024px iOS and Android icons.\n   A separate splash graphic and final store identity approval remain required before publication.\n   Complete EAS project linking and build credentials.
6. Review package and bundle IDs with the company **before first publication**, as identity changes after release are constrained.
7. Use `npx eas-cli build --platform android --profile production` and the equivalent iOS command,
   then TestFlight/Play internal tests; only after passing submit for review. Build credentials and store accounts are required.

## Release blockers (not implemented or not independently verified)
- User-requested branding can be swapped later, but app identifiers / icon / copy must be approved before release.
- Account deletion mechanism and privacy-policy URL have not been implemented / supplied;
  existing web service permits registration and must be assessed against store deletion rules.
- No screenshots, store metadata, app review demo account, distribution certs, or signing credentials supplied.
- No on-device Android/iOS run, build, binary, review approval or live store publication has been verified.
- Existing /api/account snapshot is capped at 100 order records; the UI must not imply full historical coverage.
- Native signup, cash/funding requests, KYC and bank linking are deliberately not exposed in this release candidate;
  financial-service flows need legal, security, backend and UX review.
- Platform APIs require customer login; production backend readiness must be confirmed before submission.
- Current platform explicitly has NO connected broker and NO verified live execution price service.
- Users must not mistake internally recorded positions, balances, or orders for custodial/cleared assets.

## Four-market copy explained
The web code defines US/HK/CN/MY as a static market picker and watchlist's API validator
accepts only these four codes. This is taxonomy, not evidence of live market data feeds.
The mobile app exposes the codes only when adding watchlist instruments and labels them clearly.

## Submission rules
Apple's financial app/entity requirements and minimum native functionality, and Google Play's
Financial features declaration, apply. Independent legal and compliance review is necessary.
Use store accounts owned by the entity entitled to offer the declared financial service.
