# NLSpec 11 — Native Push Notifications & Deep Links (App Links / URL Schemes)

- **Wave:** 3 (Parallel Advanced)
- **Depends On:** Slices `01`, `03`, `09`
- **Web Semport Oracles:** `src/js/services/users/notification-service.js`, `src/js/services/users/user-service.js`, `packages/cookbook-core/push-devices.js`, `functions/notifications.js`, `public/.well-known/{assetlinks.json,apple-app-site-association}`, `firestore.rules` (`match /devices/{deviceId}`)

## 1. User Intent

Family managers receive timely native push notifications when a new or resubmitted recipe awaits approval, tapping a notification lands them directly on `/dashboard`, signing out cleanly unregisters their device token so they stop receiving pushes, and tapping any shared recipe or app link (WhatsApp, email, browser, or URL scheme) opens directly to the target screen whether the app was cold or already running.

## 2. Behavioral Contract

1. **Clean Greenfield Multi-Platform Device Registration (`NotificationService`):**
   - Uses `deviceIdForToken(token)` and `buildDeviceRecord({ token, platform, ua, updatedAt })` from `@cookbook/core/push-devices` verbatim.
   - `platform` is strictly `'android'` on Android and `'ios'` on iOS.
   - Writes `users/{uid}/devices/{deviceId}` via `UserService.registerDevice(uid, record)` with exact fields `{ token, platform, ua, updatedAt: serverTimestamp() }`.
   - **E2E / Simulator Token Strategy:**
     - On `staging` / Android with Google Play Services: requests OS notification permission (`PermissionsAndroid.POST_NOTIFICATIONS` on Android 13+ / `@react-native-firebase/messaging` `requestPermission()` on iOS) and obtains the real FCM token via `messaging().getToken()`.
     - On `e2e` DTU builds (and iOS Simulator where Apple APNs remote tokens are unavailable without paid entitlements): obtains a deterministic E2E registration token (`dtu-fcm-<platform>-<uid>-<suffix>`) so `users/{uid}/devices/{deviceId}` registration, sign-out deletion, `onRecipeSubmitted` → `fcm-twin` per-platform payload assertions, and simulated notification tap routing are 100% testable end-to-end!
   - **Token Refresh & Sign-Out Cleanup:** Listens to `onTokenRefresh` to update the device doc, and `unregisterCurrentDevice(uid)` deletes `users/{uid}/devices/{deviceId}` on explicit opt-out AND inside `AuthService.signOut()` before Firebase sign-out.
2. **Incoming Push Notification Handling (`usePushNotifications`):**
   - **Foreground:** Displays an in-app Hebrew toast/banner (`מתכון חדש ממתין לאישור`) with tap action navigating to `data.url` (`/dashboard`).
   - **Background & Cold-Start Tap:** Listens to `messaging().onNotificationOpenedApp`, `messaging().getInitialNotification()`, AND simulated notification deep-link/payload delivery (`xcrun simctl push` on iOS Simulator with `{ aps: { alert: ... }, url: '/dashboard' }` and Android intent extras `url=/dashboard` via `adb`), routing cleanly to `/dashboard` (after auth resolves; if signed out or non-manager, follows Manager Dashboard role guard).
3. **Deep Links, Android App Links & URL Schemes (`useDeepLinks` + Expo Router):**
   - Supported routes on both custom schemes (`cookbook-e2e://`, `cookbook-staging://`, `cookbook://`) AND HTTPS App Links / Universal Links (staging domain):
     - `/recipe/:id` → opens Recipe Detail screen for `:id`
     - `/categories` (including `?category=...&q=...`) → opens Categories with pre-applied filter/search
     - `/my-meal` → opens My Meal (or login prompt if signed out)
     - `/dashboard` → opens Manager Dashboard (manager only)
     - `/games` → opens 8 Easter-Egg Mini-Games
     - `/propose-recipe?importUrl=...` → opens AI Recipe Import pre-filled (Slice `06`)
   - Works identically on **cold start** (app killed) and **warm resume** (app backgrounded).
   - **Paid Apple Entitlements Gate:** `associatedDomains` and `aps-environment` stay gated behind `EXPO_ENABLE_APPLE_PAID_ENTITLEMENTS=true` (default `false` in `$0` v1) in `app.config.ts`.

## 3. Required `testID` Contracts

- `push-permission-status`, `push-opt-in-btn`, `push-opt-out-btn`, `push-foreground-banner`
- (Routes inherit target screen `testID`s: `recipe-detail-screen`, `dashboard-screen`, `my-meal-screen`, `categories-screen`, `games-screen`)

## 4. Acceptance & Edge Cases

- **P0:** Device document at `users/{uid}/devices/{deviceId}` contains ONLY allowed keys (`token`, `platform`, `ua`, `updatedAt`) matching `firestore.rules` `isValidDevice`.
- **P0:** Signing out deletes the registered device doc from `users/{uid}/devices/{deviceId}` so no further pushes target the signed-out device.
- Submitting a recipe as an approved/user account triggers `onRecipeSubmitted`, which dispatches distinct `web` (data-only), `android` (`notification` + `android`), and `ios` (`notification` + `apns`) batches to `fcm-twin`.
- Cold-opening `cookbook-e2e://recipe/dtu-pub-desserts` or tapping a simulated manager push (`url: '/dashboard'`) lands directly on the target screen with zero crash or lost route during auth hydration.
