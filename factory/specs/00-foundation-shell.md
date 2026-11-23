# NLSpec 00 — Foundation Shell, RTL Lock, Tokens, Sentry & Role-Reactive Navigation

- **Wave:** 1A (Serial Foundation)
- **Depends On:** None (Phase 1 `@cookbook/core` & `@cookbook/tokens`, Phase 2 Expo CNG shell & DTU)
- **Web Semport Oracles:** `src/app.js`, `src/app/core/router.js`, `src/js/navigation-script.js`, `src/js/services/_firebase/*`, `src/js/services/logger.js`, `src/styles/tokens.css`, `docs/architecture/design-system.md`, `docs/architecture/observability.md`, `docs/architecture/services.md`

## 1. User Intent

The app cold-starts cleanly in Hebrew RTL on both Android and iOS with the warm cream Cookbook visual identity, connects seamlessly to the local DTU in `e2e` builds (or Firebase Staging in `staging` builds), enforces strict two-tier Firebase isolation, reports errors to Sentry with zero PII, and adapts bottom tabs and header actions dynamically to guest / `user` / `approved` / `manager` roles.

## 2. Behavioral Contract

1. **Cold-Start Hebrew RTL Lock:**
   - Native config (`app.config.ts` via `expo-localization`) locks `supportsRTL: true` and `forcesRTL: true` in `AndroidManifest.xml` and `Info.plist`.
   - `app/_layout.tsx` calls `I18nManager.allowRTL(true)` and `I18nManager.forceRTL(true)` before first render. Cold boot #1 MUST render RTL without restart.
2. **Design System & Typography (`src/theme/`):**
   - Re-exports all color, surface, ink, typography scale, radii, shadow, motion, press-scale, and z-index tokens from `@cookbook/tokens`.
   - Loads bundled fonts via `expo-font` (Noto Sans Hebrew, Noto Serif Hebrew, Instrument Serif, Geist, Geist Mono) with graceful fallback so boot never stalls.
   - Core UI primitives (`src/components/ui/`): `Button`, `Card`, `Chip`, `Badge`, `ModalSheet`, `ToastProvider`, `Skeleton`, `EmptyState`, `ConfirmDialog`, `ScreenHeader`. Every clickable implements tactile press-scale (`0.97` buttons/chips, `0.90` icon buttons, `0.985` cards) using `react-native-reanimated` + subtle `expo-haptics`.
   - Custom ESLint rules forbid raw hex colors (`#[0-9a-fA-F]{3,8}`), physical directional style keys (`marginLeft`/`marginRight`/`paddingLeft`/`paddingRight`/`left`/`right`), and direct `@react-native-firebase/*` or `_firebase/*` imports outside `src/services/`.
3. **Two-Tier Firebase Infrastructure (`src/services/_firebase/`):**
   - Only `_firebase/*` imports `@react-native-firebase/{app,auth,firestore,storage,functions,messaging}`.
   - When `APP_VARIANT === 'e2e'` (or `EXPO_PUBLIC_USE_DTU === 'true'`), connects Auth (`127.0.0.1:9099`), Firestore (`127.0.0.1:8080`, `ssl: false`), Storage (`127.0.0.1:9199`), and Functions (`http://127.0.0.1:5001`) before any query runs.
   - Enables native Firestore offline persistence (`persistence: true`, generous cache size).
   - Exposes `firebase-app.ts`, `auth-adapter.ts`, `firestore-adapter.ts`, `storage-adapter.ts`, `functions-adapter.ts`, `messaging-adapter.ts`.
4. **Zero-PII Observability (`src/services/logger.ts`):**
   - Initializes `@sentry/react-native` only when DSN is configured and `environment !== 'development'` (`e2e` runs in local ring-buffer audit mode without hitting network Sentry).
   - Enforces `sendDefaultPii: false`, `tracesSampleRate: 0`, `setUser({ id: uid })` (NEVER `email`, `username`, `displayName`, `avatarUrl`), `setTag('role', role)`.
   - `beforeSend` scrubs any accidental email/token patterns, drops ignorable cancellation noise, and fingerprints Firebase errors by `error.code`.
   - `captureError(error, { service, op, ...ids })` rejects/strips non-ID user content fields (e.g. `query`, `search`, `recipeName`, `email`, `fullName`, `password`, `token`).
   - In `e2e` mode only, records every captured event & user context in an inspectable in-memory audit buffer reachable via an E2E telemetry diagnostic indicator/endpoint for automated Suite L verification.
5. **Role-Reactive Navigation Shell (`app/(tabs)/_layout.tsx` + Header):**
   - Persistent top header displays brand logo (`testID="brand-logo"`, 7-tap easter-egg detector wired to Slice 10), screen title, quick search button (`testID="header-search-btn"`), and Auth Avatar / Login button (`testID="auth-open-btn"`).
   - Bottom tab bar adapts strictly by role:
     - **Guest:** `בית` (`/home`), `מתכונים` (`/categories`), `הצעת מתכון` (`/propose-recipe` → prompts login).
     - **Signed-in `user`:** `בית`, `מתכונים`, `הספרייה שלי` (`/my-recipes`), `הארוחה שלי` (`/my-meal`), `הצעת מתכון`.
     - **`approved`:** adds `ספר סבתא` (`/grandmas-cooking`) (or accessible in top/drawer menu + tab bar without overflow) and labels propose tab `מתכון חדש`.
     - **`manager`:** additionally exposes `ניהול` (`/dashboard`).
   - All tabs and headers use logical RTL ordering (first tab on the right in RTL).

## 3. Required `testID` Contracts

- `app-root`, `brand-logo`, `header-search-btn`, `auth-open-btn`, `toast-banner`
- `tab-home`, `tab-categories`, `tab-my-recipes`, `tab-my-meal`, `tab-propose`, `tab-grandma`, `tab-dashboard`
- `dtu-status-indicator` (in `e2e` variant), `e2e-telemetry-status` (in `e2e` variant)

## 4. Acceptance & Edge Cases

- Cold launch to rendered Hebrew home screen `< 3.5 s` on Android Emulator and iOS Simulator.
- Switching roles (sign-in / sign-out / manager role change) immediately updates visible tabs without requiring app restart.
- Zero raw hex colors, zero physical left/right styles, zero direct Firebase SDK imports in screens/components.
