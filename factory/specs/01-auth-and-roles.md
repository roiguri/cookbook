# NLSpec 01 — Authentication, Roles, 3-Tab Profile & Account Lifecycle

- **Wave:** 1B (Serial Foundation)
- **Depends On:** Slice `00`
- **Web Semport Oracles:** `src/js/services/auth/auth-service.js`, `src/js/services/users/user-service.js`, `src/lib/auth/auth-controller.js`, `src/lib/auth/components/auth-content.js`, `src/lib/auth/components/login-form.js`, `src/lib/auth/components/signup-form.js`, `src/lib/auth/components/forgot-password.js`, `src/lib/auth/components/user-profile.js`, `src/lib/auth/components/auth-avatar.js`, `firestore.rules`, `storage.rules`

## 1. User Intent

Family members and guests can sign in via Email/Password or native Google Sign-In, create a new account (always starting with role `user`), reset a forgotten password, manage their 3-tab profile (`פרטים`, `אווטאר`, `אבטחה` including password changes and Google account linking/unlinking), sign out cleanly (unsubscribing push devices), or delete their account (cleaning up `user-avatars/{uid}.png`, device tokens, active meal, and `users/{uid}`). Role-restricted routes always enforce access both in UI and via live Firestore rules.

## 2. Behavioral Contract

1. **`AuthService` (`src/services/auth/auth-service.ts`) & `UserService` (`src/services/users/user-service.ts`):**
   - Maintains single source of truth for `{ user, role, profile, isAuthenticated, isApproved, isManager }` with reactive subscription hook (`useAuth()`).
   - Calls `logger.setUser({ id: uid, role })` on sign-in / role resolution and `logger.setUser(null)` on sign-out.
   - Exposes `registerBeforeSignOutHook(fn)` so Slice `11` (`NotificationService.unregisterCurrentDevice`) registers cleanup lazily without creating a circular Wave dependency.
   - `signInWithEmail(email, password)`: authenticates via Firebase Auth, loads `users/{uid}` (falling back to in-memory `{ role: 'user', favorites: [] }` if missing, matching Web `auth-service.js`). Maps all 11 Firebase Auth error codes cleanly to Hebrew (including unwrapping `INVALID_LOGIN_CREDENTIALS` from `auth/internal-error`).
   - `signUpWithEmail({ fullName, email, password })`: creates Firebase Auth account, sets `displayName`, writes `users/{uid}` with **hardcoded `role: 'user'`** and `createdAt: serverTimestamp()` (never trusts client-supplied role — `firestore.rules` enforces `role == 'user'`).
   - `signInWithGoogle()`: uses `@react-native-google-signin/google-signin` on staging/prod (creates missing `users/{uid}` with `role: 'user'`), and in `e2e` DTU mode performs deterministic Auth Emulator OAuth/mock credential sign-in so Google Sign-In works end-to-end without Google Play Services flakiness.
   - `sendPasswordReset(email)`: calls Firebase Auth `sendPasswordResetEmail` and displays Hebrew confirmation (`הקישור נשלח — בדוק את תיבת הדואר שלך.`).
   - `updateProfile({ displayName, bio, avatarUrl, avatarConfig })`: writes through `UserService.update(uid, { ...fields, updatedAt: serverTimestamp() })` (never mutating `role`).
   - `changePassword(currentPassword, newPassword)` & `linkWithGoogle()` / `unlinkGoogle()`: implements re-authentication (`reauthenticateWithCredential` + `updatePassword`) and provider link/unlink, blocking unlink when Google is the sole sign-in provider (`לא ניתן לנתק — אין שיטת כניסה נוספת`).
   - `signOut()` (mirrors Web `logout()`): invokes registered before-sign-out hooks (deleting `users/{uid}/devices/{deviceId}` best-effort) BEFORE Firebase `signOut()`, then clears user-scoped caches.
   - `deleteAccount()`: verifies recent authentication (prompting re-auth cleanly if `auth/requires-recent-login` would fail, so Firestore is never deleted while Auth remains), then deletes `user-avatars/{uid}.png` (best effort), `users/{uid}/devices/{deviceId}`, `active_meals/{uid}` (best effort), `users/{uid}`, and finally the Firebase Auth user.
2. **Auth Modal / Screen (`app/auth.tsx`):**
   - **When signed out:** Segmented tabs for `התחברות` (Login: email, password with show/hide eye toggle, `שכחת סיסמה?` link, `התחבר` CTA, `המשך עם Google` button) and `הרשמה` (Signup: `שם מלא` / `שם פרטי`, email, password with 4-level strength meter `חלשה`/`בינונית`/`חזקה`/`מצוינת` + eye toggle, password confirmation, `הרשמה` CTA, `הרשמה עם Google`), plus `שכחת סיסמה?` reset view.
   - **When signed in:** Profile sheet with **3 tabs** matching Web `auth-content.js` + `user-profile.js`:
     1. **`פרטים` (`profile-tab-info`):** Editable `שם תצוגה` (`displayName` / `fullName`) and `קצת עליי` (`bio`, max 160 chars) with save/auto-save (`✓ נשמר`), read-only email, Hebrew role badge (`משתמש` / `מאושר` / `מנהל`), and `התנתק` sign-out button.
     2. **`אווטאר` (`profile-tab-avatar`):** Hosts Slice `07` Chef Avatar Builder, enforcing unsaved-changes close guard on modal close, back button, and footer `הארוחה שלי` button.
     3. **`אבטחה` (`profile-tab-security`):** Password change section (or Google-only notice `החשבון שלך משתמש ב-Google Sign-In — אימות בסיסמה אינו מופעל.`), Connected accounts (`חשבונות מחוברים` — `חבר`/`נתק` Google), and Danger Zone (`אזור מסוכן` — `מחק חשבון` with confirmation dialog).
   - Footer shortcut button `הארוחה שלי` navigates to `/my-meal` (checking avatar close guard first).
3. **Role Guards:**
   - Navigating to `/my-recipes`, `/my-meal`, or `/grandmas-cooking` (as guest or plain `user`) or `/dashboard` (as non-manager) immediately redirects to `/home` cleanly (with `/propose-recipe` showing its login prompt modal when signed out, matching Web).
   - Signing out while on any gated screen immediately redirects to `/home`.

## 3. Required `testID` Contracts

- `auth-modal`, `auth-tab-login`, `auth-tab-signup`, `auth-email-input`, `auth-password-input`, `auth-fullname-input`, `auth-password-confirm-input`, `auth-submit-btn`, `auth-google-btn`, `auth-forgot-link`, `auth-forgot-submit-btn`, `auth-error-msg`
- `profile-tab-info`, `profile-tab-avatar`, `profile-tab-security`, `profile-role-badge`, `profile-fullname-input`, `profile-bio-input`, `profile-save-btn`, `profile-signout-btn`, `profile-change-password-btn`, `profile-google-link-btn`, `profile-delete-btn`, `confirm-delete-account-btn`

## 4. Acceptance & Edge Cases

- **P0:** Signup cannot write `role: 'approved'` or `'manager'`; user profile update cannot alter `role`.
- **P0:** Deleting account cleans up `user-avatars/{uid}.png`, device doc, and `users/{uid}` without leaving dangling state.
- **P0:** Canceling Google Sign-In (`SIGN_IN_CANCELLED`) does NOT emit a Sentry error.
- Session persists across cold app restarts via native Firebase Auth persistence.
