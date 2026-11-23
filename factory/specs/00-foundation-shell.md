# NLSpec 00 — Foundation Shell, RTL Lock, Tokens, Sentry & Role-Reactive Navigation

- **Wave:** 1A (Serial Foundation)
- **Depends On:** None (Phase 1 `@cookbook/core` & `@cookbook/tokens`, Phase 2 Expo CNG shell & DTU)
- **Web Semport Oracles:** `index.html`, `src/app.js`, `src/app/core/router.js`, `src/app/core/page-manager.js`, `src/js/navigation-script.js`, `src/js/services/_firebase/firebase-service.js`, `src/js/services/_firebase/firestore-service.js`, `src/js/services/_firebase/storage-service.js`, `src/js/services/logger.js`, `src/lib/easter-egg/games-unlock.js`, `src/styles/tokens.css`, `docs/architecture/design-system.md`, `docs/architecture/observability.md`, `docs/architecture/services.md`

## 1. User Intent

The app cold-starts cleanly in Hebrew RTL on both Android and iOS with the warm cream Cookbook visual identity, connects seamlessly to the local DTU in `e2e` builds (or Firebase Staging in `staging` builds), enforces strict two-tier Firebase isolation, reports errors to Sentry with zero PII, and adapts navigation chrome dynamically to guest / `user` / `approved` / `manager` roles.

## 2. Behavioral Contract

1. **Cold-Start Hebrew RTL Lock:**
   - Native config (`app.config.ts` via `expo-localization`) locks `supportsRTL: true` and `forcesRTL: true` in `AndroidManifest.xml` and `Info.plist`.
   - `app/_layout.tsx` calls `I18nManager.allowRTL(true)` and `I18nManager.forceRTL(true)` before first render. Cold boot #1 MUST render RTL without restart.
   - In `e2e` builds, `dtu-status-indicator` surfaces `RTL: פעיל` (never `RTL: כבוי`) alongside DTU connection state.
2. **Design System & Typography (`src/theme/`):**
   - Re-exports all color, surface (`surface0: #faf6ec`, `surface1: #ffffff`, `surface2: #f6eed6`, `neutral: #f2e8cf`), ink (`#1f1d18`, `#3a3a3a`, `#6b6a63`, `#a6a49a`), typography scale, radii (`xs..2xl, pill`), shadow, motion, press-scale, and z-index tokens from `@cookbook/tokens`.
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
   - **Mobile P0 tightening beyond Web `logger.js`:** `beforeSend` scrubs accidental email/API-token (`cbk_*`) patterns, drops ignorable cancellation noise (`auth/popup-closed-by-user`, `SIGN_IN_CANCELLED`), and fingerprints Firebase errors by `error.code`. `captureError(error, { service, op, ...ids })` strips non-ID user content keys (`query`, `searchQuery`, `recipeName`, `email`, `fullName`, `password`, `token`, `apiToken`).
   - In `e2e` mode only, records every captured event & user context in an inspectable in-memory audit buffer reachable via `e2e-telemetry-status` for automated Suite L verification.
5. **Role-Reactive Navigation Shell (`app/(tabs)/_layout.tsx` + Header):**
   - Persistent top header displays brand logo (`testID="brand-logo"`, wired to the 7-tap / 2000ms easter-egg detector in Slice `10`), quick search icon (`testID="header-search-btn"`, jumping directly to `/recipe/:id` on exact single match as in Web `header-search-bar.js`), role-gated header shortcuts when needed, and Auth Avatar / Login button (`testID="auth-open-btn"` — initial fallback on green gradient circle, subtle ring without zoom when `isBuiltAvatarUrl(avatarUrl)`).
   - **Mobile-ergonomic Navigation Layout (max 5 bottom tabs to prevent phone overflow; role-gated extra destinations in top header / compact scrollable tab rail):**
     - **Guest:** Bottom tabs `דף הבית` (`tab-home`, `/home`), `מתכונים` (`tab-categories`, `/categories`), `הצעת מתכון` (`tab-propose`, `/propose-recipe` → login prompt).
     - **Signed-in `user`:** Bottom tabs `דף הבית` (`tab-home`), `מתכונים` (`tab-categories`), `הספרייה שלי` (`tab-my-recipes`), `הארוחה שלי` (`tab-my-meal`), `הצעת מתכון` (`tab-propose`).
     - **`approved`:** Bottom tabs `דף הבית` (`tab-home`), `מתכונים` (`tab-categories`), `הספרייה שלי` (`tab-my-recipes`), `הארוחה שלי` (`tab-my-meal`), `מתכון חדש` (`tab-propose`), plus header shortcut `המטעמים של סבתא` (`tab-grandma`, `/grandmas-cooking`).
     - **`manager`:** Same 5 bottom tabs + header shortcuts `המטעמים של סבתא` (`tab-grandma`, `/grandmas-cooking`) and `ממשק ניהול` (`tab-dashboard`, `/dashboard`).
   - All tabs and headers use logical RTL ordering (first tab on the right in RTL).

## 3. Required `testID` Contracts

- `app-root`, `brand-logo`, `header-search-btn`, `auth-open-btn`, `toast-banner`
- `tab-home`, `tab-categories`, `tab-my-recipes`, `tab-my-meal`, `tab-propose`, `tab-grandma`, `tab-dashboard`
- `dtu-status-indicator` (in `e2e` variant), `e2e-telemetry-status` (in `e2e` variant)

## 4. Acceptance & Edge Cases

- Cold launch to rendered Hebrew home screen `< 3.5 s` on Android Emulator and iOS Simulator.
- Switching roles (sign-in / sign-out / manager role change) immediately updates visible tabs & header shortcuts without requiring app restart.
- Zero raw hex colors, zero physical left/right styles, zero direct Firebase SDK imports in screens/components.
