# NuvexaPro App browser preview deployment

Source: `deploy/mobile-web-preview-20261104` branch, `mobile/App.tsx` shared with the native client.

- Expo SDK 58, React Native Web, Metro single-page export.
- The Dockerfile installs mobile dependencies, runs typecheck + unit tests, exports Expo Web, serves the static build via unprivileged nginx on port 8080.
- For a Railway GitHub service, select this branch and expose container port 8080.
- Browser session tokens are **in-memory only**, and are erased on page reload; iOS/Android still use Expo SecureStore. Browsers do not provide the native SecureStore security guarantee.
- Do not set `EXPO_PUBLIC_API_BASE_URL` unless the HTTPS API host, CORS policy, account-deletion migration and access-control rules have been verified in that environment.
- Without that variable, the preview is interactive but authentication fails closed, rather than connecting to an unknown backend.
- Browser preview is **not** an APK, AAB, IPA, signed native binary, store approval, or proof of production API integration.
- The existing service and website branches are not modified by this isolated deployment branch.
