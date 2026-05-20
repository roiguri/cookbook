# Service-Layer Refactor — Plan

## Context

The codebase currently mixes "services" and "utils" inconsistently. Some domains have a single service that owns all access (`notification-service`); others have logic split between a service file and several utility files (`recipes`); others have no service at all and pages call `FirestoreService` directly (`users`, `failed_url_extractions`).

This umbrella refactor consolidates everything around **one service per domain entity** as the only public access point, with utilities reserved for pure stateless helpers (formatting, validation, display). It only merges to `development` when every domain is on the new convention and an ESLint rule enforces it.

**Umbrella branch:** `refactor/service-layer` (off `development`).

## Convention

1. **One service per domain entity** — static class in `src/js/services/<entity>-service.js`. Public methods are the only API.
2. **Services own all data access** for their domain — Firestore reads/writes, Storage uploads/downloads, cross-collection joins.
3. **Utilities are pure helpers** — formatting, validation, display helpers, ID generators. No I/O. Live in `src/js/utils/`.
4. **Only services may import `FirestoreService` / `StorageService`.** Enforced by ESLint in Phase 6.
5. **Pages and lib components import services**, not utilities or low-level wrappers, for any data operation.

---

## Phase 1 — Recipes

### PR-A — Recipe service API ✅ MERGED (#197)

**Goal achieved:** `RecipeService` + `RecipeImageProposalService` exist as the only public entry points, with full tests.

- `src/js/services/recipe-service.js` — `get`, `list`, `generateId`, `create`, `update` (PATCH semantics), `setPrimaryImage`, `delete`
- `src/js/services/recipe-image-proposal-service.js` — `propose`, `approve`, `reject`, `listPending`
- 23 new tests

### PR-B — Form submit migration 🔵 (#198, awaiting merge)

**Goal:** All recipe creation & editing goes through `RecipeService.create` / `.update`; the recipe form fetches via `RecipeService.get`.

**Files:** `propose_recipe_component.js`, `edit_recipe_component.js`, `recipe_form_component.js`, `media-instructions-editor.js`.

### PR-C — Delete migration

**Goal:** All recipe deletion goes through `RecipeService.delete`. The legacy `deleteRecipe` export is removed.

**Today (verified):**

- `src/app/pages/manager-dashboard-page.js:5,442` — imports & calls `deleteRecipe(recipeId)` from utils
- `src/lib/recipes/recipe_preview_modal/recipe_preview_modal.js:51,273` — imports & calls `deleteRecipe(recipeId)` for "reject pending recipe"
- `src/js/utils/recipes/recipe-data-utils.js:417,435` — the legacy `deleteRecipe` function itself

**Change:** both call sites → `RecipeService.delete(recipeId)`; remove the legacy function + its dead imports.

**Done when:** `grep -rn "deleteRecipe\b" src/` returns only `manager-dashboard-page.js`'s own page method (unrelated naming). `grep -rn "deleteDocument('recipes'" src/` returns only the `RecipeService.delete` implementation.

### PR-D — Image proposal / approval migration

**Goal:** Pending-image lifecycle goes through `RecipeImageProposalService`; cross-recipe `setPrimaryImage` goes through `RecipeService.setPrimaryImage`.

**Today (verified):**

- `image-proposal-modal.js:27,186` — `addPendingImages` import + call
- `image-approval-multi.js:39,40,472,524,565,624` — `approvePendingImageById` / `rejectPendingImageById` imports + 4 call sites
- `image-approval-multi.js:482,489,576,583` — `setPrimaryImage(recipe.id, ...)` (4 calls, the Firestore-writing variant)

> Note: `image-handler.js:496,558` has a LOCAL `setPrimaryImage(imageId)` instance method — different concern, not a bypass.

**Change:** modal → `RecipeImageProposalService.propose`; multi → `.approve` / `.reject` and `RecipeService.setPrimaryImage`.

**Done when:** `grep -rn "addPendingImages\|approvePendingImageById\|rejectPendingImageById" src/` returns only the service modules + `recipe-image-utils.js`. `grep -rn "setPrimaryImage(this.recipe" src/` returns nothing.

### PR-E — Search bypasses migration

**Goal:** No component outside the service layer issues `FirestoreService.queryDocuments('recipes', ...)` for search/dropdown purposes.

**Today (verified):**

- `src/lib/recipes/recipe_form_component/parts/recipe-related-field.js:189` — edit form's related-recipe search
- `src/lib/search/header-search-bar/header-search-bar.js:163` — global header search

**Change:** both → `RecipeService.list({ where: [['approved','==',true]] })`.

> **`search-service.js:153`** also queries recipes; deferred separately because the aliveness of this component is unresolved (pre-existing `TODO: extract`, possibly superseded by `unified-recipe-filter`). Will be addressed when the aliveness check happens.

**Done when:** `grep -rn "queryDocuments('recipes'" src/` returns only the manager dashboard sites (PR-G territory), home/categories (PR-G), `ai-image-enhancer.js` (PR-H), and `search-service.js` (deferred).

### PR-F — Self-heal migration

**Goal:** No component outside the service layer issues `FirestoreService.updateDocument('recipes', ...)` for narrow patches.

**Today (verified):**

- `src/lib/recipes/recipe_component/recipe_component.js:1274` — relatedRecipes self-heal (fire-and-forget stale-ID prune)

**Change:** → `RecipeService.update(recipeId, { changes: { relatedRecipes } })` — the PATCH semantics in `RecipeService.update` make this safe; only `relatedRecipes` is touched.

**Done when:** `grep -rn "updateDocument('recipes'" src/` returns only `recipe_preview_modal.js:268` (the narrow `{approved: true}` toggle, borderline-OK) and `ai-image-enhance-modal.js:445` (PR-H territory).

### PR-G — Page list-queries + dead-import cleanup

**Goal:** All recipe list/grid pages use `RecipeService.list`. No dead Firestore SDK imports remain in pages.

**Today (verified):**

- `src/app/pages/home-page.js:56` — home feed
- `src/app/pages/categories-page.js:217` — categories grid
- `src/app/pages/manager-dashboard-page.js:323` — all-recipes list (manager)
- `src/app/pages/manager-dashboard-page.js:486` — pending-recipes list
- `src/app/pages/manager-dashboard-page.js:597` — pending-images-recipes list
- `src/app/pages/recipe-detail-page.js:4` — dead `import { arrayUnion, serverTimestamp } from 'firebase/firestore'`

**Change:** all 5 query sites → `RecipeService.list(queryParams)`; remove the dead import.

**Done when:** `grep -rn "queryDocuments('recipes'" src/` returns only `ai-image-enhancer.js` (PR-H) and `search-service.js` (deferred). `grep -n "firebase/firestore" src/app/pages/recipe-detail-page.js` returns nothing.

### PR-H — AI image enhance flow (design pending)

**Goal:** AI image enhance reads/writes recipes through the service layer, including the "overwrite existing image file" semantic.

**Today (verified):**

- `ai-image-enhancer.js:69` — `FirestoreService.queryDocuments('recipes', ...)`
- `ai-image-enhance-modal.js:419` — `StorageService.uploadFile(blob, backupPath)` — `_original.<ext>` backup
- `ai-image-enhance-modal.js:423` — `StorageService.uploadFile(enhancedBlob, originalPath)` — overwrite the existing image's file
- `ai-image-enhance-modal.js:445` — `FirestoreService.updateDocument('recipes', id, { images })` — set `aiEnhanced` flag

**Blocking question:** the image-API verb. Needs its own planning session before code (per-image patch vs `replaceImage` verb vs a dedicated `RecipeImageService`).

**Done when:** all four call sites above route through service methods; `grep -rn "FirestoreService\|StorageService" src/lib/media/ai-image-enhancer/` returns nothing.

---

## Phase 2 — Users

**Goal:** `UserService` is the only public entry point for the `users` collection.

**Today (verified):**

- `src/lib/search/search-service/search-service.js:137` — `getDocument('users', ...)` for favorites
- `src/app/pages/manager-dashboard-page.js:84` — manager auth check
- `src/app/pages/manager-dashboard-page.js:241` — list all users
- `src/app/pages/manager-dashboard-page.js:306` — `updateDocument('users', uid, { role })`
- `src/app/pages/documents-page.js:59` — user role check
- `src/lib/modals/filter_modal/filter_modal.js:697` — favorites lookup for filter
- `src/js/services/favorites-service.js:42, 76, 100` — internal favorites service
- `notification-service.js` — uses raw SDK on `users/{uid}.fcmTokens`

**Likely split:**

- **PR-I** — `UserService` API + tests
- **PR-J1** — manager admin + documents-page user-role checks
- **PR-J2** — `favorites-service.js` and `filter_modal.js` route through `UserService`
- **PR-J3** — `notification-service.js` doc-level access via `UserService`

**Done when:** `grep -rn "Document('users'" src/` returns only `src/js/services/user-service.js`.

---

## Phase 3 — Favorites leak fix

**Goal:** `search-service.js` reads favorites through `FavoritesService`, not via direct `users` collection access.

**Today:** `src/lib/search/search-service/search-service.js:137-138` — reads `userDoc.favorites` directly.

**Change:** add `FavoritesService.getFavorites(userId)` if needed; route search-service through it.

**Done when:** `grep -rn "userDoc?.favorites\|userDoc.favorites" src/lib/` returns nothing.

> **Sequencing:** Folds into Phase 2 PR-J2 if done after that PR. Same line change either way.

---

## Phase 4 — Active meals

**Goal:** `ActiveMealService` owns all `active_meals` access including the real-time subscription. `active-meal-utils.js` is removed.

**Today (verified):**

- `src/app/pages/my-meal-page.js:8,73,80` — raw `firebase/firestore` SDK with `onSnapshot` listener
- `src/app/pages/my-meal-page.js:156,183,204,211,257,334,514,547` — 8 dynamic imports of `ActiveMealUtils`
- `src/app/pages/recipe-detail-page.js:136,138` — `ActiveMealUtils.addToMeal`
- Plus `recipe-card.js` per earlier survey

**Split:**

- **PR-L** — `ActiveMealService` with `subscribe(uid, callback) → unsubscribe` + CRUD; tests cover listener semantics.
- **PR-M** — migrate all callers; delete `active-meal-utils.js`.

**Risk:** the real-time listener is load-bearing for the my-meal page. Must preserve exact event semantics.

**Done when:** `grep -rn "onSnapshot\|active-meal-utils\|ActiveMealUtils" src/` returns only `src/js/services/active-meal-service.js`. `active-meal-utils.js` doesn't exist.

---

## Phase 5 — Failed URL extractions

**Goal:** `FailedUrlExtractionService` owns the collection.

**Today (verified):**

- `src/app/pages/manager-dashboard-page.js:718` — `queryDocuments('failed_url_extractions', ...)`
- `src/app/pages/manager-dashboard-page.js:879` — `deleteDocument('failed_url_extractions', id)`

**Done when:** `grep -rn "'failed_url_extractions'" src/` returns only `src/js/services/failed-url-extraction-service.js`.

---

## Phase 6 — Convention enforcement

**Goal:** ESLint blocks `FirestoreService` / `StorageService` imports outside `src/js/services/**`.

Resolve any remaining flagged files. Decide the `getOptimizedImageUrl` display-helper question — either exempt as a display URL helper, or move into a service.

**Done when:** `npm run lint` passes with the new rule active.

---

## Final — umbrella → development

**Pre-merge checks:**

- `npm run lint && npm run format -- --check && npm test && npm run build` green on umbrella.
- Manual walkthrough: home, categories, recipe detail, propose, edit, delete, image propose, image approve/reject (manager), AI enhance, my-meal real-time, failed-URL listing, user admin, favorites, global header search.

Open one merge PR `refactor/service-layer` → `development`. Pre-commit gate runs. Merge.

---

## Deferred (separate umbrellas / issues — NOT in this work)

1. **Form contract (issue #194)** — open. Its own umbrella. Touches 7+ components + replaces 4 utility files. Independent of service layer.
2. **search-service aliveness check** — broader question of whether `search-service.js` should be migrated or retired (possibly superseded by `unified-recipe-filter`). Deserves its own investigation; the favorites-leak fix in Phase 3 is the only piece pulled into this umbrella.
3. **Splitting `recipe-data-utils.js` / `recipe-image-utils.js` / `recipe-media-utils.js`** along service-vs-helper lines — opportunistic cleanup; not required for the convention to hold.
