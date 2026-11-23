# L1 Pyramid Summary — Domains, Services, Data Contracts & UI Conventions

> Detailed behavioral reference distilled from `docs/architecture/services.md`, `firestore.rules`, `storage.rules`, `functions/index.js`, `packages/cookbook-core/`, and `packages/cookbook-tokens/`.

## 1. Mobile Directory Layout & Two-Tier Service Boundary

```text
apps/mobile/
├── app/                          # Expo Router file-based routes (9 routes + root layout)
│   ├── _layout.tsx               # Root provider stack: RTL lock, fonts, Sentry, Firebase DTU, Auth, Share Intent, Deep Links, Push tap handler
│   ├── (tabs)/                   # Adaptive bottom tab navigator (Home, Categories, My Recipes, My Meal, + role-gated tabs)
│   │   ├── _layout.tsx
│   │   ├── index.tsx             # / (redirects or renders /home)
│   │   ├── home.tsx              # /home
│   │   ├── categories.tsx        # /categories
│   │   ├── my-recipes.tsx        # /my-recipes (signed-in)
│   │   ├── my-meal.tsx           # /my-meal (signed-in)
│   │   ├── propose-recipe.tsx    # /propose-recipe (signed-in; guest gets login prompt)
│   │   ├── grandmas-cooking.tsx  # /grandmas-cooking (approved | manager only)
│   │   └── dashboard.tsx         # /dashboard (manager only)
│   ├── recipe/[id].tsx           # /recipe/:id (detail + cook mode + actions)
│   ├── auth.tsx                  # Auth modal / sheet (login, signup, forgot password, profile, avatar builder)
│   └── games.tsx                 # /games (easter-egg 8 mini-games chooser + offline WebView host)
├── src/
│   ├── services/
│   │   ├── _firebase/            # ONLY directory allowed to import @react-native-firebase/*
│   │   │   ├── firebase-app.ts   # Emulator hookup (APP_VARIANT=e2e), SQLite offline persistence config
│   │   │   ├── auth-adapter.ts
│   │   │   ├── firestore-adapter.ts
│   │   │   ├── storage-adapter.ts
│   │   │   ├── functions-adapter.ts
│   │   │   └── messaging-adapter.ts
│   │   ├── logger.ts             # @sentry/react-native wrapper (strict zero-PII rules + e2e in-memory ring buffer for telemetry audit)
│   │   ├── auth/auth-service.ts
│   │   ├── users/{user-service.ts, favorites-service.ts, notification-service.ts}
│   │   ├── recipes/{recipe-service.ts, recipe-image-service.ts, recipe-image-proposal-service.ts, recipe-edit-suggestion-service.ts, media-instruction-service.ts, recipe-search-service.ts, recipe-share-service.ts, recipe-submission-service.ts, ai-enhancement-service.ts}
│   │   ├── meals/active-meal-service.ts
│   │   ├── pdf/pdf-service.ts
│   │   └── admin/{failed-url-extraction-service.ts, api-token-service.ts}
│   ├── components/               # Reusable RN UI primitives, recipe cards, modals, avatar builder, Cook Mode
│   ├── games-host/               # Bundled offline WebView host + RN↔WebView orientation/haptics bridge
│   └── theme/                    # Re-exports @cookbook/tokens + loaded font family constants
└── assets/                       # Fonts + bundled offline mini-game HTML/JS/CSS/PNG bundle
```

## 2. Firestore Collections & Security Rules Summary

| Collection / Path                    | Owner Service                         | Read Access                                                                                            | Write / Delete Rules                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users/{uid}`                        | `UserService`                         | Owner or `manager`                                                                                     | Create: owner with `role == 'user'` + valid `avatarConfig` (`v` int, `parts` ≤ 16, `colors` ≤ 8). Update: owner (cannot alter `role`) or `manager`. Delete: owner or `manager`.                                                                                                                                            |
| `users/{uid}/devices/{deviceId}`     | `UserService` / `NotificationService` | Owner only                                                                                             | Owner only; exact keys `['token', 'platform', 'updatedAt']` (optional `ua` ≤ 200 chars), `platform` in `['web','android','ios']`, `updatedAt` Timestamp.                                                                                                                                                                   |
| `active_meals/{uid}`                 | `ActiveMealService`                   | Owner only                                                                                             | Owner only (`recipeIds[]`, `activeRecipeId`, `recipeStates: { [id]: { servings, unselectedIngredients[] } }`, `updatedAt`).                                                                                                                                                                                                |
| `cookbook/{docId}`                   | `PdfService`                          | `approved` or `manager`                                                                                | Read-only from client (`cookbook/grandmas_cookbook` manifest: `title`, `totalPages`, `storagePrefix`, `toc[]`).                                                                                                                                                                                                            |
| `recipes/{id}`                       | `RecipeService`                       | Public if `visibility == 'published'`, else `authorId == uid`, `manager`, or shared approved recipient | Create: `manager` (any visibility), `approved` (own private), plain `user` (own private **ONLY** batched with `recipe_submissions/{id}`). Update: `manager` (any), author on own private (cannot publish), author on own published (`stage` & `testedAt` ONLY). Delete: `manager` or author on own private.                |
| `recipes/{id}/shares/{recipientUid}` | `RecipeShareService`                  | Recipient, `authorId`, or `manager` (collection-group query on `recipientUid == uid`)                  | Create: `approved`/`manager` author on own `private` recipe for another `approved`/`manager` user; exact keys `['recipientUid', 'authorId', 'authorName', 'sharedAt']` (`sharedAt == serverTimestamp()`). Update: denied. Delete: author, recipient, or manager.                                                           |
| `recipe_submissions/{recipeId}`      | `RecipeSubmissionService`             | `manager` or `authorId == uid`                                                                         | Create: author for own private recipe (`status: 'pending'`, `recipeId == id`). Update: `manager` (if `status == 'rejected'`, non-empty `rejectionReason` required!) OR author resubmitting rejected doc (`['status', 'resubmittedAt']` only, `status: 'pending'`). Delete: `manager` or author while `pending`/`rejected`. |
| `recipe_edit_suggestions/{id}`       | `RecipeEditSuggestionService`         | `manager` or `suggestedBy == uid`                                                                      | Create: any signed-in user (`suggestedBy == uid`, `status: 'pending'`). Update: `manager` only. Delete: `manager` or suggester while `pending`.                                                                                                                                                                            |
| `failed_url_extractions/{id}`        | `FailedUrlExtractionService`          | `manager` only                                                                                         | Delete: `manager` only. Created server-side by `extractRecipeFromUrl` / `extractRecipeFromVideo`.                                                                                                                                                                                                                          |
| `api_tokens/{id}`                    | `ApiTokenService` (callables only)    | Denied to all clients                                                                                  | Denied to all clients; accessed only via `createApiToken`, `listApiTokens`, `revokeApiToken`.                                                                                                                                                                                                                              |

## 3. Storage Path Contracts (`storage.rules` + `@cookbook/core`)

- **Published/Submitted Recipe Photos:** `recipes/{recipeId}/images/{imgId}.{ext}` (resized thumbnails `_400x400.webp` and `_1080x1080.webp` generated automatically; always fall back gracefully to original if WebP variant is missing).
- **Private Recipe Photos:** `users/{uid}/recipes/{recipeId}/images/{imgId}.{ext}` (readable by owner, managers, and approved family members with a `recipes/{recipeId}/shares/{recipientUid}` doc).
- **Step Media (Images & Videos):** `recipes/{recipeId}/media/{mediaId}_{sanitizedName}` (or `users/{uid}/recipes/{recipeId}/media/...` for private). Max 50 MB.
- **Edit Suggestion Staged Files:** `suggestions/{suggestionId}/images|media/{file}` → promoted server-side via `promoteSuggestionFiles` callable on manager approval.
- **Built Chef Avatar:** `user-avatars/{uid}.png` — MUST be `image/png`, `< 200 KB`, `customMetadata: { uploadedBy: uid }`; save download URL with `&v=<timestamp>` cache-buster to `users/{uid}.avatarUrl` alongside `users/{uid}.avatarConfig`.
- **Grandma's Scanned Pages:** `grandmas_cookbook/original/page.{n}.jpg` (authenticated read, UI gated to `approved`/`manager`).

## 4. Cloud Functions Callables & Triggers (`functions/index.js`)

| Function                                    | Kind              | Allowed Roles         | Input / Output                                                                                                                   |
| ------------------------------------------- | ----------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `extractRecipeFromImage`                    | `onCall`          | `approved`, `manager` | `{ images: [{ base64, mimeType }] }` → normalized Hebrew recipe JSON                                                             |
| `extractRecipeFromUrl`                      | `onCall`          | `approved`, `manager` | `{ url }` → normalized Hebrew recipe JSON (logs failure to `failed_url_extractions`)                                             |
| `extractRecipeFromVideo`                    | `onCall`          | `approved`, `manager` | `{ url }` (YouTube URL) → normalized Hebrew recipe JSON (logs failure to `failed_url_extractions`)                               |
| `enhanceFoodImage`                          | `onCall`          | `manager`             | `{ image: { base64, mimeType }, parameters?, instruction? }` → `{ base64, mimeType }`                                            |
| `promoteSuggestionFiles`                    | `onCall`          | `manager`             | `{ suggestionId }` → `{ mapping: { [oldPath]: newPath } }`                                                                       |
| `listFamilyMembers`                         | `onCall`          | `approved`, `manager` | `{}` → `{ members: [{ uid, fullName, avatarUrl, role }] }` (excludes caller)                                                     |
| `createApiToken`                            | `onCall`          | `manager`             | `{ uid, name, scope: 'read'                                                                                                      | 'write' }`→`{ token, id, ... }` (one-time plaintext secret!) |
| `listApiTokens`                             | `onCall`          | `manager`             | `{}` → `{ tokens, maxPerUser }`                                                                                                  |
| `revokeApiToken`                            | `onCall`          | `manager`             | `{ tokenId }` → `{ revoked: tokenId }`                                                                                           |
| `onRecipeSubmitted` / `onRecipeResubmitted` | Firestore trigger | Server-only           | Dispatches per-platform FCM push (`web` data-only, `android` notification, `ios` APNs) to all managers with `url: '/dashboard'`. |

## 5. Design Tokens & Accessibility / `testID` Contract

- **Tokens (`@cookbook/tokens`):**
  - Surfaces: `surface0` (`#faf6ec`), `surface1` (`#fffdf8`), `surface2` (`#f2e8cf`).
  - Brand: `primary` (`#6a994e`), `primaryDark` (`#386641`), `primaryBright` (`#a7c957`), `secondary` (`#bc4749`), `caution` (`#b7791f`).
  - Ink: `ink` (`#1c1917`), `ink2` (`#44403c`), `ink3` (`#78716c`), `ink4` (`#a8a29e`).
  - Radii: `xs=6`, `sm=10`, `md=14`, `lg=20`, `xl=28`, `pill=9999`.
  - Press scales: buttons/chips `0.97`, icon buttons `0.90`, cards `0.985` (via `react-native-reanimated` + `expo-haptics`).
- **Deterministic `testID` Convention:**
  - Every interactive element and key screen anchor MUST expose a stable kebab-case `testID` matching its slice NLSpec (e.g. `tab-home`, `tab-categories`, `tab-my-recipes`, `tab-my-meal`, `tab-dashboard`, `auth-open-btn`, `recipe-card-<id>`, `servings-inc-btn`, `cook-mode-toggle`, `avatar-save-btn`).
  - On Android, React Native maps `testID` to `resource-id` (and on iOS to `accessibilityIdentifier`), giving both Maestro and the accessibility audit deterministic cross-platform locators.
- **E2E Telemetry Audit Hook (`APP_VARIANT=e2e` only):**
  - `src/services/logger.ts` maintains a ring buffer of emitted Sentry events and exposes a lightweight debug inspection banner or E2E diagnostics route/accessor (zero effect in `staging`/`production`) so automated validators can assert `0 uncaught errors` and `0 PII fields` deterministically.
