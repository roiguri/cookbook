# NLSpec 11 — Native Push Notifications & Deep Links (App Links / URL Schemes)

- **Wave:** 3B (Parallel Advanced)
- **Depends On:** Slices `01`, `03`, `09`
- **Web Semport Oracles:** `src/js/services/users/notification-service.js`, `src/js/services/users/user-service.js`, `src/js/services/auth/auth-service.js`, `src/app.js`, `src/app/core/router.js`, `packages/cookbook-core/push-devices.js`, `functions/index.js`, `functions/notifications.js`, `public/firebase-messaging-sw.js`, `public/.well-known/assetlinks.json`, `public/.well-known/apple-app-site-association`, `firestore.rules`

## 1. User Intent

Family managers receive timely native push notifications when a new or resubmitted recipe awaits approval, tapping a notification lands them directly on `/dashboard`, signing out cleanly unregisters their device token so they stop receiving pushes, and tapping any shared recipe or app link (WhatsApp, email, browser, or URL scheme) opens directly to the target screen whether the app was cold or already running.

## 2. Behavioral Contract

1. **Clean Greenfield Multi-Platform Device Registration (`NotificationService`):**
   - Uses `deviceIdForToken(token)` and `buildDeviceRecord({ token, platform, ua, updatedAt })` from `@cookbook/core/push-devices` verbatim.
   - `platform` is strictly `'android'` on Android and `'ios'` on iOS.
   - Writes `users/{uid}/devices/{deviceId}` via **3-argument** `UserService.registerDevice(uid, deviceId, { token, platform, ua })` (matching Web `user-service.js:156` and `firestore.rules` `isValidDevice`: exact keys `['token', 'platform', 'ua', 'updatedAt']`).
   - Tracks 5 permission/registration states matching `notification-service.js`: `'unsupported' | 'denied' | 'default' | 'granted-unregistered' | 'granted-registered'`. When registered, exposes `push-permission-status` displaying **`התראות פעילות`**.
   - **Android Notification Channel (CRITICAL):** On Android startup, creates high-importance notification channel **`cookbook_default`** (matching `functions/notifications.js:110` `channelId: 'cookbook_default'`) so Android 8+ (API 26+) displays manager notifications reliably.
   - **E2E / Simulator Token Strategy:**
     - On `staging` / Android with Google Play Services: requests OS notification permission (`PermissionsAndroid.POST_NOTIFICATIONS` on Android 13+ / `@react-native-firebase/messaging` `requestPermission()` on iOS) and obtains the real FCM token via `messaging().getToken()`.
     - On `e2e` DTU builds (and iOS Simulator where Apple APNs remote tokens are unavailable without paid entitlements): generates a deterministic E2E registration token (`dtu-fcm-<platform>-<uid>-<suffix>`) so `users/{uid}/devices/{deviceId}` registration, sign-out deletion, `onRecipeSubmitted` / `onRecipeResubmitted` → `fcm-twin` per-platform payload assertions, and simulated notification tap routing are 100% testable end-to-end.
   - **Token Refresh & Sign-Out Cleanup:** Listens to `onTokenRefresh` to update the device doc. Registers `unregisterCurrentDevice(uid)` via `AuthService.registerBeforeSignOutHook` so signing out deletes `users/{uid}/devices/{deviceId}` (and calls best-effort `messaging().deleteToken()`) BEFORE Firebase sign-out.
2. **Incoming Push Notification Handling (`usePushNotifications`):**
   - **Foreground (`push-foreground-banner`):** Displays dynamic `notification.title` / `data.title` + `body` (supporting BOTH `onRecipeSubmitted` `'מתכון חדש ממתין לאישור'` and `onRecipeResubmitted` `'מתכון נשלח שוב לאישור'` + recipe name!) with tap action navigating to `data.url || '/dashboard'`.
   - **Background & Cold-Start Tap:** Listens to `messaging().onNotificationOpenedApp`, `messaging().getInitialNotification()`, AND simulated notification deep-link/payload delivery (`xcrun simctl push` on iOS Simulator with `{ aps: { alert: ... }, url: '/dashboard' }` and Android intent extras `url=/dashboard` or `cookbook-e2e://dashboard?fromPush=1`), routing cleanly to `/dashboard` once auth resolves (non-managers hit the Manager Dashboard role guard).
3. **Deep Links, Android App Links & URL Schemes (`useDeepLinks` + Expo Router):**
   - Supported routes on both custom schemes (`cookbook-e2e://`, `cookbook-staging://`, `cookbook://`) AND HTTPS App Links / Universal Links (staging domain):
     - `/recipe/:id` → opens Recipe Detail screen for `:id`
     - `/categories` (supporting `?category=...&q=...&favorites=true`) → opens Categories with pre-applied filter/search/favorites
     - `/my-recipes` (supporting `?view=all|mine|saved|shared|to-try`) → opens My Recipes (or redirects to `/home` if signed out)
     - `/my-meal` → opens My Meal (or redirects to `/home` if signed out)
     - `/grandmas-cooking` → opens Grandma's Cookbook (`approved`/`manager` only)
     - `/dashboard` → opens Manager Dashboard (`manager` only)
     - `/games` → opens 8 Easter-Egg Mini-Games
     - `/propose-recipe?importUrl=...` → opens AI Recipe Import pre-filled (Slice `06` mobile handoff)
   - Works identically on **cold start** (app killed) and **warm resume** (app backgrounded).
   - **Paid Apple Entitlements Gate:** `associatedDomains` and `aps-environment` stay gated behind `EXPO_ENABLE_APPLE_PAID_ENTITLEMENTS=true` (default `false` in `$0` v1) in `app.config.ts`.

## 3. Required `testID` Contracts

- `dashboard-push-banner`, `dashboard-push-enable-btn`, `push-permission-status`, `push-opt-out-btn`, `push-foreground-banner`
- (Routes inherit target screen `testID`s: `recipe-detail-screen`, `dashboard-screen`, `my-recipes-screen`, `my-meal-screen`, `grandma-screen`, `categories-screen`, `games-screen`)

## 4. Acceptance & Edge Cases

- **P0:** Device document at `users/{uid}/devices/{deviceId}` contains ONLY allowed keys (`token`, `platform`, `ua`, `updatedAt`) matching `firestore.rules` `isValidDevice`.
- **P0:** Signing out deletes the registered device doc from `users/{uid}/devices/{deviceId}` so no further pushes target the signed-out device.
- Both new recipe submissions (`onRecipeSubmitted`) AND rejected resubmissions (`onRecipeResubmitted`) trigger distinct `web` (data-only), `android` (`notification` + `channelId: 'cookbook_default'`), and `ios` (`notification` + `apns`) batches to `fcm-twin`.
- Cold-opening `cookbook-e2e://recipe/dtu-pub-desserts` or tapping a simulated manager push (`url: '/dashboard'`) lands directly on the target screen with zero crash or lost route during auth hydration.
