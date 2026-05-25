# Service-Layer Refactor — Plan

## Status

Umbrella branch `refactor/service-layer` (#211). In flight. Merges to `development` only after all phases below are complete and the ESLint convention rule passes.

## Convention (load-bearing)

1. **One service per domain entity** — static class under `src/js/services/<domain>/`.
2. **Services own all data access** for their domain.
3. **Utilities are pure helpers** — no I/O, no service/SDK imports. Live in `src/js/utils/`.
4. **Only services may import `_firebase/firestore-service.js` / `storage-service.js` / raw Firebase SDKs.** Enforced by ESLint in PR-O2. No exemptions.
5. **Pages and lib components import services**, never utilities for data ops.
6. **One owner per Firestore doc.** Other services delegate doc reads/writes to the owner. (Doc owner for `recipes/{id}` = `RecipeService`; for `users/{uid}` = `UserService`.)

## Argument convention (applies to all services going forward)

- **Positional** for ≤3 args, or 4 args where the last is a defaulted optional flag.
- **Hybrid** (positional required + options bag) for "core args + optional flags".
- **Bag** (options object) when 5+ semantically-related config fields, or any boolean buried mid-list.

## Final-state directory layout

```
src/js/services/
├── _firebase/                               # internal infrastructure
├── auth/
│   └── auth-service.js
├── users/
│   ├── user-service.js                      # owns users/{uid}
│   ├── favorites-service.js                 # delegates → UserService
│   └── notification-service.js              # delegates → UserService; FCM SDK direct
├── recipes/
│   ├── recipe-service.js                    # owns recipes/{id}; composes image storage
│   ├── recipe-image-service.js              # image storage ops + URL reads; NO Firestore
│   ├── recipe-image-proposal-service.js     # proposal/moderation workflow
│   └── media-instruction-service.js         # media-instruction Storage ops
├── meals/
│   └── active-meal-service.js
└── admin/
    └── failed-url-extraction-service.js

src/js/utils/
└── recipes/
    ├── recipe-data-utils.js                 # only pure helpers
    ├── recipe-image-utils.js                # only pure helpers
    ├── recipe-ingredients-utils.js
    └── recipe-media-utils.js                # only pure helpers
```

## Completed work ✅

Reference only — `git log refactor/service-layer` is authoritative.

| PR        | Scope                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------- |
| #197      | PR-A: `RecipeService` + `RecipeImageProposalService` API                                                |
|           | PR-B/C/D: form-submit / delete / image-proposal migrations                                              |
| #212      | PR-E: search bypasses → `RecipeService.list`                                                            |
| #213      | PR-F: self-heal → `RecipeService.update` PATCH                                                          |
| #214      | PR-G: page list-queries                                                                                 |
| #216      | Dead search-service removal                                                                             |
| #218      | Phase 0: services restructured into by-domain folders                                                   |
| #219      | PR-H: AI image enhance + `RecipeImageService` introduced                                                |
| #220      | PR-I: `UserService` API                                                                                 |
| #222–#226 | PR-J1–J4: user-doc callers routed through `UserService`                                                 |
| #227      | PR-L: `ActiveMealService` API                                                                           |
| #228      | PR-M: active-meal callers migrated                                                                      |
| #231      | Preview-modal approval → `RecipeService`                                                                |
| #232      | PR-N: `FailedUrlExtractionService`                                                                      |
| #233      | PR-O1: `UserService.listAvatarOptions` + component-storage cleanup                                      |
| #237      | Infra: jest config ignores `.claude/worktrees/` for cross-worktree test discovery                       |
| #236      | PR-Q1a-1: `setPrimaryImage` → `RecipeService` (utils + service old method removed)                      |
| #238      | PR-Q1a-2: `replaceImage` → `RecipeService`; `RecipeImageService.replaceFiles` (Storage-only)            |
| #239      | PR-Q1a-3: `uploadAndBuildImageMetadata` → `RecipeImageService.uploadFile`                               |
| #240      | PR-Q1a-4: `RecipeImageService.deleteFiles`; `removeAllRecipeImages` inlined into `RecipeService.delete` |
| #241      | PR-Q1a-5: `migrateImageToCategory` → `RecipeImageService.migrateFilesToCategory`                        |

### Q1a end state

- `RecipeImageService` is **Firestore-free**; 4 Storage methods only: `uploadFile`, `replaceFiles`, `deleteFiles`, `migrateFilesToCategory`.
- `RecipeService` owns all writes to `recipes/{id}`, including the image-entry side of `replaceImage` and `setPrimaryImage`.
- `recipe-service.js` no longer imports anything from `recipe-image-utils.js`.
- `recipe-image-utils.js` retains: validation, path/id helpers, a private `deleteImageFiles` helper (used by `rejectPendingImageById` until PR-Q2 inlines both), pending-image flow (PR-Q2 scope), and read helpers (PR-Q1b scope).

### Naming deviations from the original plan

- The original plan listed `uploadFiles(recipeId, category, file, uploadedBy, isPrimary = false)`. Shipped as **`uploadFile`** (singular) with the positional+options shape **`uploadFile(recipeId, category, file, { isPrimary, uploadedBy })`** — `uploadFile` writes exactly one file (Storage Resize extension regenerates variants async); plural would have misled. Singular matches the sibling-method shape (`replaceFiles(recipeId, image, blob, options)`).
- `migrateFilesToCategory` shipped with signature `(recipeId, image, newCategory)` — drops the original plan's `oldCategory` parameter (was only used in an error log).

## Remaining work — image/media + ESLint enforcement

All sub-PRs land directly on `refactor/service-layer`. One at a time.

---

### PR-Q1b — Recipe-image URL helpers leave utils

**Goal**: 3 read-side URL helpers move from `recipe-image-utils.js` into `RecipeImageService`, with **typed inputs** (no arbitrary storage-path strings).

#### `RecipeImageService` URL API

| Utils export                        | New service method                                | Notes                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getOptimizedImageUrl(image, size)` | `RecipeImageService.getOptimizedUrl(image, size)` | Mechanical move.                                                                                                                                          |
| `getPrimaryImageUrl(recipe, size)`  | `RecipeImageService.getPrimaryUrl(recipe, size)`  | Mechanical move.                                                                                                                                          |
| `getImageUrl(storagePath)`          | `RecipeImageService.getFullUrl(image)`            | **Signature change** — takes a `RecipeImage` object; resolves `image.full` internally. Prevents the service from becoming a generic storage URL resolver. |

`getPlaceholderImageUrl()` is a pure function (returns null) — stays in utils.

#### Caller migrations (7 lib files)

- `src/lib/recipes/recipe-card/recipe-card.js`
- `src/lib/recipes/recipe_component/recipe_component.js`
- `src/lib/recipes/recipe_form_component/recipe_form_component.js`
- `src/lib/media/image-carousel/image-carousel.js` — also unwinds PR-O1's temporary `getImageUrl` import; normalizes any legacy `string` to `{ full: string }` at the carousel level before the service call
- `src/lib/media/ai-image-enhancer/ai-image-enhancer.js`
- `src/lib/media/ai-image-enhancer/ai-image-enhance-modal.js` — also unwinds PR-O1's temporary `getImageUrl` import
- `src/lib/modals/image-approval-multi/image-approval-multi.js`

#### Acceptance

- 3 URL exports gone from `recipe-image-utils.js`. After Q1b, the file contains only its proposal helpers (to be removed in Q2) and pure helpers (`getPlaceholderImageUrl`, `validateImageFile`, `getRecipeImages`, etc.).
- No method on `RecipeImageService` accepts an arbitrary storage-path string.
- PR-O1's temporary `getImageUrl` import in `ai-image-enhance-modal.js` and `image-carousel.js` is unwound.
- All gates green.

---

### PR-Q2 — Inline proposal helpers into `RecipeImageProposalService`

`RecipeImageProposalService.{propose, approve, reject, listPending}` today are 1-line pass-throughs to utils. Inline the bodies; delete the 4 utils exports. No public surface change.

**Acceptance**: 4 exports gone from `recipe-image-utils.js`. The file now contains only pure helpers. Existing tests pass.

---

### PR-Q3 — `MediaInstructionService`

Media instructions (cooking-step videos/images) are a self-contained domain. Writes + URL read + the single lib-component caller migrate together.

| Method                                                               | Replaces utils function       |
| -------------------------------------------------------------------- | ----------------------------- |
| `MediaInstructionService.upload(file, recipeId, userId, onProgress)` | `uploadMediaInstructionFile`  |
| `MediaInstructionService.delete(filePath)`                           | `deleteMediaInstructionFile`  |
| `MediaInstructionService.deleteMany(filePaths)`                      | `deleteMediaInstructionFiles` |
| `MediaInstructionService.removeAll(mediaInstructions)`               | `removeAllMediaInstructions`  |
| `MediaInstructionService.getUrl(storagePath)`                        | `getMediaInstructionUrl`      |

Media-instruction storage paths ARE the domain identifier — `getUrl` takes a string by design (no richer object to type against, unlike `RecipeImage`).

Callers: `recipe-service.js` (internal media-upload helper); `media-instructions-editor.js`.

**Acceptance**: 5 media-instruction exports gone from `recipe-media-utils.js`. New service ships with its own test file. All gates green.

---

### PR-Q4 — Delete thin read passthroughs

`getRecipeById(id)` and `getRecipesForCards(opts)` in `recipe-data-utils.js` are thin duplicates of `RecipeService.get` / `RecipeService.list`. Pre-flight audit confirms signature compatibility; 5 callers update; passthroughs deleted.

Callers: `my-meal-page.js`, `recipe-card.js`, `recipe_component.js`, `recipe-related-field.js`, `image-proposal-modal.js`.

---

### PR-O2 — Strict ESLint rule, no exemptions

```js
{
  files: ['src/**/*.js', '!src/js/services/**/*.js'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['**/_firebase/firestore-service*'], message: 'Use a domain service.' },
        { group: ['**/_firebase/storage-service*'],   message: 'Use a domain service.' },
        { group: ['firebase/firestore', 'firebase/storage', 'firebase/auth'],
          message: 'Raw Firebase SDKs only inside src/js/services/**.' },
      ],
    }],
  },
}
```

**Acceptance**: `npm run lint` passes with zero exemptions. `gh issue close 215`.

---

## Acceptance criteria — umbrella → development

- ESLint rule passes with no exemptions.
- `grep -r "FirestoreService\|StorageService\|firebase/firestore\|firebase/storage\|firebase/auth" src/ --include="*.js"` returns matches only inside `src/js/services/**`.
- `RecipeImageService` has zero Firestore calls.
- `recipe-image-utils.js`, `recipe-media-utils.js`, `recipe-data-utils.js` contain only pure helpers (no `await`, no service/SDK imports).
- Full smoke walkthrough passes.
- `npm run lint && npm run format -- --check && npm test && npm run build` green.

## Final smoke walkthrough

1. Recipe display (home / categories / recipe-detail) — all image URL paths resolve
2. My meal — add, switch tabs, change servings, clear; cross-device live sync
3. Recipe propose / edit / delete — incl. category change (image migration)
4. Image proposal flow — propose as user → approve/reject as manager → primary selection
5. AI image enhance — open / enhance / save with backup
6. Image carousel — including any legacy string-path data
7. Manager dashboard — pending recipes, user admin, failed-URL extractions
8. Auth + profile — sign in, avatar change, password reset
9. Favorites — add/remove, persist across reload

Open umbrella PR with `Fixes #211` and `Fixes #215`.

## Deferred (separate work)

- Form contract (#194) — independent umbrella
- Form dirty-detection bug (#209) — folds into #194
- Media editor destructive delete/reset (#210)
