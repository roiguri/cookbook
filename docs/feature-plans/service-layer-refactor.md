# Service-Layer Refactor — Plan

## Context

The codebase mixed "services" and "utils" inconsistently. Some domains had a single service that owned all access (`notification-service`); others had logic split between a service file and several utility files (`recipes`); others had no service at all and pages called `FirestoreService` directly (`users`, `failed_url_extractions`).

This umbrella refactor consolidates everything around **one service per domain entity** as the only public access point, with utilities reserved for pure stateless helpers (formatting, validation, display). It only merges to `development` when every domain is on the new convention and an ESLint rule enforces it.

**Umbrella branch:** `refactor/service-layer` (off `development`).
**Tracking issue:** #211.

## Convention

1. **One service per domain entity** — static class under `src/js/services/<domain>/`. Public methods are the only API.
2. **Services own all data access** for their domain — Firestore reads/writes, Storage uploads/downloads, cross-collection joins.
3. **Utilities are pure helpers** — formatting, validation, display helpers, ID generators. No I/O. Live in `src/js/utils/`.
4. **Only services may import `FirestoreService` / `StorageService`.** Enforced by ESLint in Phase 6. Low-level wrappers live under `src/js/services/_firebase/`.
5. **Pages and lib components import services**, not utilities or low-level wrappers, for any data operation.
6. **One owner per Firestore doc.** Field-scoped services (FavoritesService, NotificationService) delegate doc reads/writes to the owning domain service (UserService).

## Final-state directory layout

```
src/js/services/
├── _firebase/                          # internal infrastructure (services-only imports)
│   ├── firestore.js
│   ├── storage.js
│   └── client.js
├── auth/
│   └── auth-service.js                 # Firebase Auth state only — no user-doc access
├── users/
│   ├── user-service.js                 # owns users/{uid} reads/writes
│   ├── favorites-service.js            # delegates doc access → UserService
│   └── notification-service.js         # delegates doc access → UserService; FCM SDK direct
├── recipes/
│   ├── recipe-service.js               # doc CRUD only
│   ├── recipe-image-service.js         # setPrimaryImage, replaceImage (PR-H), image lifecycle
│   └── recipe-image-proposal-service.js
├── meals/
│   └── active-meal-service.js          # includes subscribe() real-time listener
└── admin/
    └── failed-url-extraction-service.js

src/js/utils/
├── common-utils.js
├── error-handler.js
├── filter-utils.js
└── recipes/
    ├── recipe-data-utils.js            # pure formatters, validators, CATEGORY_MAP
    ├── recipe-ingredients-utils.js     # pure parsers, scaling
    └── (display URL helpers — exempt from ESLint rule, tracked in #215)
```

---

## Phase 1 — Recipes ✅ MOSTLY DONE

| Step                                                                  | Status                     | Notes                                             |
| --------------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| **PR-A** — `RecipeService` + `RecipeImageProposalService` API + tests | ✅ Merged (#197)           | 23 tests; PATCH semantics on `update`             |
| **PR-B** — Form submit migration (4 focused commits)                  | ✅ Merged                  | propose / edit / dead-code / setRecipeData        |
| **PR-C** — Delete migration (3 focused commits)                       | ✅ Merged                  | preview-modal / dashboard / legacy export removed |
| **PR-D** — Image proposal/approval (2 focused commits)                | ✅ Merged                  | proposal-modal / approval-multi + setPrimaryImage |
| **PR-E** — Search bypasses                                            | ✅ Merged (#212)           | recipe-related-field + header-search-bar          |
| **PR-F** — Self-heal migration                                        | ✅ Merged (#213)           | recipe_component relatedRecipes via PATCH         |
| **PR-G** — Page list-queries + dead-import cleanup                    | ✅ Merged (#214)           | home + categories + dashboard ×3 + recipe-detail  |
| **PR-H** — AI image enhance + introduce `RecipeImageService`          | ⬜ Planned, design pending | Holds Phase 1 closer                              |

### PR-H — AI image enhance flow (design pending)

**Goal:** AI image enhance reads/writes recipes through the service layer. Introduces `RecipeImageService` and migrates `setPrimaryImage` into it.

**Today (verified):**

- `ai-image-enhancer.js:69` — `FirestoreService.queryDocuments('recipes', ...)`
- `ai-image-enhance-modal.js:419` — `StorageService.uploadFile(blob, backupPath)` — `_original.<ext>` backup
- `ai-image-enhance-modal.js:423` — `StorageService.uploadFile(enhancedBlob, originalPath)` — overwrite the existing image's file
- `ai-image-enhance-modal.js:445` — `FirestoreService.updateDocument('recipes', id, { images })` — set `aiEnhanced` flag

**Design questions:**

- Verb shape — `RecipeImageService.replaceImage(recipeId, imageId, blob, { keepOriginalBackup, fieldUpdates })` vs. per-image patch (`updateImage`).
- How to model the `_original.<ext>` AI-enhance backup vs. the Storage resize extension's auto-generated `_original` files (different lifecycles, both currently named `_original`).
- `aiEnhanced` flag bookkeeping — implicit (service handles it) or explicit (caller passes in `fieldUpdates`)?

---

## Phase 0 — Services directory restructure (do before PR-H and Phase 2-5)

**Goal:** Move existing services into by-domain folders. No behavior change.

**Files moved:**

- `firestore-service.js`, `storage-service.js`, `firebase-service.js` → `_firebase/`
- `auth-service.js` → `auth/`
- `favorites-service.js`, `notification-service.js` → `users/`
- `recipe-service.js`, `recipe-image-proposal-service.js` → `recipes/`

**Imports across `src/` updated.** One focused sub-PR.

---

## Phase 2 — Users

**Goal:** `UserService` is the only public entry point for the `users` collection. Field-scoped services delegate to it.

**Today (verified bypass sites):**

- `src/lib/search/search-service/search-service.js:137` — RESOLVED (file deleted in #216)
- `src/app/pages/manager-dashboard-page.js:84` — manager auth check
- `src/app/pages/manager-dashboard-page.js:241` — list all users
- `src/app/pages/manager-dashboard-page.js:306` — `updateDocument('users', uid, { role })`
- `src/app/pages/documents-page.js:59` — user role check
- `src/lib/modals/filter_modal/filter_modal.js:697` — favorites lookup for filter
- `src/js/services/favorites-service.js:42, 76, 100` — internal favorites service
- `notification-service.js` — uses raw SDK on `users/{uid}.fcmTokens`

**Sub-PRs:**

- **PR-I** — `UserService` API + tests
- **PR-J1** — Manager admin + documents-page user-role checks
- **PR-J2** — `favorites-service.js` delegates user-doc access through `UserService`. `filter_modal.js` also migrates.
- **PR-J3** — `notification-service.js` delegates user-doc access through `UserService` (FCM SDK direct stays).

**Done when:** `grep -rn "Document('users'" src/` returns only `src/js/services/users/user-service.js`.

---

## ~~Phase 3 — Favorites leak fix~~ ✅ RESOLVED

The favorites leak only existed in `search-service.js`, which was deleted in #216 (dead code, never instantiated). No work needed.

---

## Phase 4 — Active meals

**Goal:** `ActiveMealService` owns all `active_meals` access including the real-time subscription. `active-meal-utils.js` is removed.

**Today (verified):**

- `src/app/pages/my-meal-page.js:8, 73, 80` — raw `firebase/firestore` SDK with `onSnapshot` listener on `active_meals/{uid}`
- `src/app/pages/my-meal-page.js:156, 183, 204, 211, 257, 334, 514, 547` — 8 dynamic imports of `ActiveMealUtils`
- `src/app/pages/recipe-detail-page.js:136, 138` — `ActiveMealUtils.addToMeal`
- Plus possibly `recipe-card.js`

**Sub-PRs:**

- **PR-L** — `ActiveMealService` API with `subscribe(uid, callback) → unsubscribe` + CRUD methods replicating `ActiveMealUtils`. Tests cover listener semantics carefully.
- **PR-M** — Migrate all callers; delete `active-meal-utils.js`.

**Risk:** the listener is load-bearing for `/my-meal` UI. Must preserve exact event semantics.

**Done when:** `grep -rn "onSnapshot\|active-meal-utils\|ActiveMealUtils" src/` returns only `src/js/services/meals/active-meal-service.js`. `active-meal-utils.js` doesn't exist.

---

## Phase 5 — Failed URL extractions

**Goal:** `FailedUrlExtractionService` owns the collection.

**Today (verified):**

- `src/app/pages/manager-dashboard-page.js:718` — `queryDocuments('failed_url_extractions', ...)`
- `src/app/pages/manager-dashboard-page.js:879` — `deleteDocument('failed_url_extractions', id)`

**Done when:** `grep -rn "'failed_url_extractions'" src/` returns only `src/js/services/admin/failed-url-extraction-service.js`.

---

## Phase 6 — Convention enforcement

**Goal:** ESLint blocks `FirestoreService` / `StorageService` imports outside `src/js/services/**`.

Plus:

- Split write-side of `recipe-image-utils.js`, `recipe-media-utils.js`, `recipe-data-utils.js` into the appropriate services (write helpers move into services; pure helpers stay in utils).
- Decide on the display-helper exemption per #215.

**Done when:** `npm run lint` passes with the new rule active.

---

## Final — umbrella → development

**Pre-merge checks:**

- `npm run lint && npm run format -- --check && npm test && npm run build` green on umbrella.
- Manual walkthrough: home, categories, recipe detail, propose, edit, delete, image propose, image approve/reject (manager), AI enhance, my-meal real-time, failed-URL listing, user admin, favorites, global header search.

Open one merge PR `refactor/service-layer` → `development` with `Fixes #211`. Merge.

---

## Deferred (separate umbrellas / issues — NOT in this work)

1. **Form contract (#194)** — open. Its own umbrella. Touches 7+ components + replaces 4 utility files. Independent of service layer.
2. **Form dirty-detection bug (#209)** — media reorder / set-primary don't flag dirty. Folds into #194 territory.
3. **Media editor destructive delete + reset (#210)** — destructive on delete; reset doesn't restore.
4. **Display-helper exemption decision (#215)** — keep exempt, move into a service, or refactor URL helpers entirely.
