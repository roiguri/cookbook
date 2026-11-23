# L0 Pyramid Summary — Cookbook Native App & Software Factory

> **Audience:** Factory Orchestrator, Parallel Slice Builder Agents, AI-to-AI Reviewer Agents.
> Read `L0` first, then `L1-domains-and-services.md`, then your assigned slice NLSpec in `factory/specs/`.

## 1. Product Identity & Parity Mandate

**ספר המתכונים המשפחתי (The Family Cookbook)** is a Hebrew, RTL-first family recipe application.
The native mobile app (`apps/mobile/`, iOS & Android via React Native + Expo CNG / Expo Router) must achieve **100% functional, security, and visual parity** with the existing vanilla-JS Web SPA (`src/`) plus mobile-native superpowers (OS Share Target, Cook-Mode Wake Lock, Offline Firestore cooking, native push notifications, App Links / URL schemes).

- **Existing Web SPA = Behavioral Oracle (Semport):** Every screen, role check, edge case, Firestore/Storage write shape, and Hebrew string has an authoritative implementation under `src/app/pages/`, `src/js/services/`, `src/lib/`, `firestore.rules`, `storage.rules`, and `functions/`. When any detail is ambiguous, match the Web SPA and shared `@cookbook/core` modules verbatim.
- **Shared Packages (Single Source of Truth — Never Fork):**
  - `@cookbook/core` (`packages/cookbook-core/`) — Pure ESM domain model (`recipe-model.js`), ingredient scaling/formatting (`recipe-ingredients-utils.js`), recipe share text (`recipe-text.js`), library views (`library-views.js`), diff/status/image/media/storage-paths, filters, YouTube URL parser, LRU cache, push device IDs (`push-devices.js`), and Chef Avatar SVG engine (`avatar/chef-avatar.js`, imported directly so DiceBear stays lazy).
  - `@cookbook/tokens` (`packages/cookbook-tokens/`) — Canonical palette, surface/ink ladder, typography scale, radii, shadows, motion, press scales, and z-index layers synced 1:1 with `src/styles/tokens.css`.

## 2. Hard Non-Negotiable P0 Invariants

Every change is rejected if **any** P0 invariant fails:

1. **Branch & Environment Isolation:** Work happens strictly on `native-mobile` against local DTU (`demo-cookbook`) or Firebase Staging (`cook-book-test-479e8`). NEVER touch `development`, `staging`, `main`, or Firebase Production (`my-cook-book-67fde`).
2. **Immutable Security Rules:** Builder Agents NEVER edit `firestore.rules` or `storage.rules`. All client reads/writes/uploads must succeed against the existing live rules verbatim.
3. **Two-Tier Firebase Service Boundary:** Only `apps/mobile/src/services/_firebase/*` may import `@react-native-firebase/*`. Screens (`app/**`) and UI components (`src/components/**`) ONLY import domain services (`src/services/<domain>/*`), never `_firebase/*` or raw Firebase SDKs.
4. **Hebrew RTL Cold-Start Fidelity:** Hebrew (`he`) RTL is forced natively (`I18nManager.forceRTL(true)` + `expo-localization` config). Physical `marginLeft`/`marginRight`/`paddingLeft`/`paddingRight`/`left`/`right` are forbidden in favor of logical properties (`marginStart`/`marginEnd`, `paddingStart`/`paddingEnd`, `start`/`end`). Zero raw hex colors outside `@cookbook/tokens`.
5. **Storage `uploadedBy` & Size Compliance:** Every Storage upload sets `customMetadata: { uploadedBy: uid }`. Built avatars are 256×256 `image/png` < 200 KB at `user-avatars/{uid}.png`. Recipe media respects `PHOTO_MAX_BYTES` (5 MB, max 5 photos) and `MEDIA_MAX_BYTES` (50 MB).
6. **Zero PII in Observability (`@sentry/react-native`):** `sendDefaultPii: false`; `setUser({ id: uid })` only (NEVER email, displayName, avatar URL); `setTag('role', role)`; NEVER attach raw search queries, form inputs, recipe content, or API token secrets to `captureError` extra context.
7. **Zero Fatal Crashes & Role Enforcement:** Unauthenticated guests and plain `user` accounts must never bypass role gates (`approved`/`manager`), never self-promote `role`, and never see private recipes they do not own or share.
8. **Zero EAS Cloud Builds & Gated Apple Entitlements:** Android E2E and staging builds compile locally via Gradle; iOS Simulator builds compile via `xcodebuild` on `macos-15`. Physical-device paid Apple entitlements stay gated behind `EXPO_ENABLE_APPLE_PAID_ENTITLEMENTS=true` (default `false`).

## 3. Cookbook Digital Twin Universe (DTU) Endpoints

When `APP_VARIANT=e2e` (or `EXPO_PUBLIC_USE_DTU=true`), the app connects to local host loopback (`127.0.0.1`, wired via `adb reverse` on Android Emulator and shared loopback on iOS Simulator):

| Service                    | Host & Port      | Purpose                                                               |
| -------------------------- | ---------------- | --------------------------------------------------------------------- |
| Firebase Auth Emulator     | `127.0.0.1:9099` | Email/password & mock Google sign-in                                  |
| Firestore Emulator         | `127.0.0.1:8080` | Live `firestore.rules` enforcement                                    |
| Storage Emulator           | `127.0.0.1:9199` | Live `storage.rules` enforcement                                      |
| Cloud Functions Emulator   | `127.0.0.1:5001` | All callables + `onRecipeSubmitted` / `onRecipeResubmitted`           |
| Seed & Snapshot Controller | `127.0.0.1:9200` | `GET /health`, `POST /reset`, `POST /seed/:profile`, `GET /snapshot`  |
| Gemini AI Twin             | `127.0.0.1:9201` | Deterministic Hebrew extraction + image enhancement + fault injection |
| FCM Push Twin              | `127.0.0.1:9202` | Captures per-platform push batches + simulated notification delivery  |
| Storage Resize Twin        | `127.0.0.1:9203` | Generates real `_400x400.webp` and `_1080x1080.webp` thumbnails       |

### Deterministic DTU Seed Users (`baseline` / `all` / `empty`)

| Role              | UID              | Email                   | Password       | Display Name  |
| ----------------- | ---------------- | ----------------------- | -------------- | ------------- |
| `user`            | `dtu-user-1`     | `user@cookbook.test`    | `TestPass123!` | `אורח משפחתי` |
| `approved`        | `dtu-approved-1` | `family@cookbook.test`  | `TestPass123!` | `דנה כהן`     |
| `approved` (peer) | `dtu-approved-2` | `family2@cookbook.test` | `TestPass123!` | `יוסי לוי`    |
| `manager`         | `dtu-manager-1`  | `manager@cookbook.test` | `TestPass123!` | `מנהל המטבח`  |
