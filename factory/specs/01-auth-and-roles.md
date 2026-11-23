# NLSpec 01 — Authentication, Roles, Profile & Account Lifecycle

- **Wave:** 1B (Serial Foundation)
- **Depends On:** Slice `00`
- **Web Semport Oracles:** `src/js/services/auth/auth-service.js`, `src/js/services/users/user-service.js`, `src/lib/auth/auth-controller.js`, `src/lib/auth/components/{login-form,signup-form,forgot-password,user-profile,auth-avatar}.js`, `firestore.rules` (`match /users/{userId}`), `storage.rules` (`match /user-avatars/{fileName}`)

## 1. User Intent

Family members and guests can sign in via Email/Password or native Google Sign-In, create a new account (always starting with role `user`), reset a forgotten password, view/edit their profile, sign out cleanly (unsubscribing push devices), or delete their account (removing both `user-avatars/{uid}.png` and `users/{uid}`). Role-restricted routes always enforce access both in UI and via live Firestore rules.

## 2. Behavioral Contract

1. **`AuthService` (`src/services/auth/auth-service.ts`) & `UserService` (`src/services/users/user-service.ts`):**
   - Maintains single source of truth for `{ user, role, profile, isAuthenticated, isApproved, isManager }` with reactive subscription hook (`useAuth()`).
   - Calls `logger.setUser({ id: uid, role })` on sign-in / role resolution and `logger.setUser(null)` on sign-out.
   - `signInWithEmail(email, password)`: authenticates via Firebase Auth, loads `users/{uid}` (creating default `{ email, fullName, role: 'user', favorites: [], createdAt }` if missing).
   - `signUpWithEmail({ fullName, email, password })`: creates Firebase Auth account, sets `displayName`, writes `users/{uid}` with **hardcoded `role: 'user'`** (never trusts client-supplied role — `firestore.rules` enforces `role == 'user'`).
   - `signInWithGoogle()`: uses `@react-native-google-signin/google-signin` on staging/prod, and in `e2e` DTU mode performs deterministic Auth Emulator OAuth/mock credential sign-in so Google Sign-In works end-to-end without Google Play Services flakiness.
   - `sendPasswordReset(email)`: calls Firebase Auth `sendPasswordResetEmail` and displays clear Hebrew confirmation (`קישור לאיפוס סיסמה נשלח למייל`).
   - `signOut()`: deletes current device doc from `users/{uid}/devices/{deviceId}` (best effort via `NotificationService.unregisterCurrentDevice`) BEFORE calling Firebase `signOut()`, then clears user-scoped caches.
   - `deleteAccount()`: deletes `user-avatars/{uid}.png` (best effort), deletes `users/{uid}/devices/{deviceId}`, deletes `users/{uid}` Firestore doc, deletes `active_meals/{uid}` if present, and deletes Firebase Auth user (handling `auth/requires-recent-login` cleanly with Hebrew re-auth prompt).
2. **Auth Modal / Screen (`app/auth.tsx`):**
   - **When signed out:** Segmented tabs for `התחברות` (Login) and `הרשמה` (Signup), plus `שכחתי סיסמה` (Forgot Password) view and `התחברות עם Google` button. Inline Hebrew validation errors for invalid email, short password (<6 chars), mismatched password confirm, and Firebase Auth error codes (`auth/invalid-credential`, `auth/email-already-in-use`, `auth/user-not-found`).
   - **When signed in:** Profile sheet with two tabs: `פרופיל` (Profile: display name edit, email read-only, Hebrew role badge `משתמש` / `משפחה מאושרת` / `מנהל`, sign-out button, delete-account flow with confirmation dialog) and `אווטאר` (hosts Slice `07` Chef Avatar Builder, enforcing unsaved-changes close guard).
3. **Role Guards:**
   - Navigating directly to `/my-recipes`, `/my-meal` while signed out redirects to `/home` and prompts login.
   - Navigating to `/grandmas-cooking` as guest or `user` redirects to `/home` with informative Hebrew toast.
   - Navigating to `/dashboard` as guest, `user`, or `approved` redirects to `/home`.
   - Signing out while on a gated screen immediately redirects to `/home`.

## 3. Required `testID` Contracts

- `auth-modal`, `auth-tab-login`, `auth-tab-signup`, `auth-email-input`, `auth-password-input`, `auth-fullname-input`, `auth-password-confirm-input`, `auth-submit-btn`, `auth-google-btn`, `auth-forgot-link`, `auth-forgot-submit-btn`, `auth-error-msg`
- `profile-tab-info`, `profile-tab-avatar`, `profile-role-badge`, `profile-fullname-input`, `profile-save-btn`, `profile-signout-btn`, `profile-delete-btn`, `confirm-delete-account-btn`

## 4. Acceptance & Edge Cases

- **P0:** Signup cannot write `role: 'approved'` or `'manager'`; user profile update cannot alter `role`.
- **P0:** Deleting account cleans up `user-avatars/{uid}.png` and `users/{uid}` without leaving dangling state.
- **P0:** Canceling Google Sign-In (`SIGN_IN_CANCELLED`) does NOT emit a Sentry error.
- Session persists across cold app restarts via native Firebase Auth persistence.
