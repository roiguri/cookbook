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

| PR        | Scope                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| #197      | PR-A: `RecipeService` + `RecipeImageProposalService` API                                                                                   |
|           | PR-B/C/D: form-submit / delete / image-proposal migrations                                                                                 |
| #212      | PR-E: search bypasses → `RecipeService.list`                                                                                               |
| #213      | PR-F: self-heal → `RecipeService.update` PATCH                                                                                             |
| #214      | PR-G: page list-queries                                                                                                                    |
| #216      | Dead search-service removal                                                                                                                |
| #218      | Phase 0: services restructured into by-domain folders                                                                                      |
| #219      | PR-H: AI image enhance + `RecipeImageService` introduced                                                                                   |
| #220      | PR-I: `UserService` API                                                                                                                    |
| #222–#226 | PR-J1–J4: user-doc callers routed through `UserService`                                                                                    |
| #227      | PR-L: `ActiveMealService` API                                                                                                              |
| #228      | PR-M: active-meal callers migrated                                                                                                         |
| #231      | Preview-modal approval → `RecipeService`                                                                                                   |
| #232      | PR-N: `FailedUrlExtractionService`                                                                                                         |
| #233      | PR-O1: `UserService.listAvatarOptions` + component-storage cleanup                                                                         |
| #237      | Infra: jest config ignores `.claude/worktrees/` for cross-worktree test discovery                                                          |
| #236      | PR-Q1a-1: `setPrimaryImage` → `RecipeService` (utils + service old method removed)                                                         |
| #238      | PR-Q1a-2: `replaceImage` → `RecipeService`; `RecipeImageService.replaceFiles` (Storage-only)                                               |
| #239      | PR-Q1a-3: `uploadAndBuildImageMetadata` → `RecipeImageService.uploadFile`                                                                  |
| #240      | PR-Q1a-4: `RecipeImageService.deleteFiles`; `removeAllRecipeImages` inlined into `RecipeService.delete`                                    |
| #241      | PR-Q1a-5: `migrateImageToCategory` → `RecipeImageService.migrateFilesToCategory`                                                           |
| #242      | PR-Q1b-1: `getOptimizedImageUrl` + `getPrimaryImageUrl` → `RecipeImageService.{getOptimizedUrl, getPrimaryUrl}`                            |
| #244      | PR-Q1b-2: `getImageUrl(path)` → `RecipeImageService.getFullUrl(image)` with typed input                                                    |
| #245      | PR-Q2: 4 proposal helpers inlined into `RecipeImageProposalService`; `deleteImageFiles` helper + Firestore/Storage imports gone from utils |
| #249      | PR-Q3: new `MediaInstructionService` (5 methods); `recipe-media-utils.js` becomes pure                                                     |
| #252      | PR-Q4: deleted `getRecipeById` + `getRecipesForCards` from utils; 6 callers route through `RecipeService.get` + `formatRecipeData(...)`    |

### Naming deviations from the original plan

- `uploadFiles` plural → **`uploadFile`** (singular) with positional + options shape: `uploadFile(recipeId, category, file, { isPrimary, uploadedBy })`. The call writes exactly one file (Storage Resize extension regenerates variants async); plural would have misled.
- `migrateFilesToCategory` shipped as `(recipeId, image, newCategory)` — drops the `oldCategory` parameter (was only used in an error log).
- `getRecipeById` / `getRecipesForCards` weren't strict passthroughs — they applied `formatRecipeData` to the Firestore result. Q4 kept `RecipeService.get` raw and pushed the formatting decision to caller boundaries (`formatRecipeData(await RecipeService.get(id))`). This split lets render paths get normalized defaults while update paths (notably the edit form) keep the raw shape for dirty-state baselining.

## Pre-O2 audit (state of `refactor/service-layer`)

Status snapshot taken before kicking off the final ESLint-enforcement PR. The umbrella's structural goals are met; the enforcement rule will lock them in.

### ✅ Goals met

| Acceptance criterion                                                                                                                      | Status                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `recipe-image-utils.js` / `recipe-media-utils.js` / `recipe-data-utils.js` contain only pure helpers (no `await`, no service/SDK imports) | ✅ verified via grep                                                                            |
| `RecipeImageService` has zero Firestore calls                                                                                             | ✅ verified (only mention is a JSDoc note)                                                      |
| All sub-PRs land green                                                                                                                    | ✅ `npm test` (534/534), `npm run lint` (0 errors), `prettier --check` clean, `npm run build` ✓ |

### Final-state service layout (matches the plan)

```
src/js/services/recipes/
├── recipe-service.js                    # owns recipes/{id}; composes images + media
├── recipe-image-service.js              # 4 Storage write methods + 3 URL read methods; zero Firestore
├── recipe-image-proposal-service.js     # 4 proposal/moderation methods; bounded recipes/{id} writes
├── media-instruction-service.js         # 5 media Storage methods; zero Firestore
└── ai-enhancement-service.js            # pre-existing AI helper
```

`RecipeImageService` public surface:
`uploadFile`, `replaceFiles`, `deleteFiles`, `migrateFilesToCategory`, `getOptimizedUrl`, `getPrimaryUrl`, `getFullUrl`.

`RecipeImageProposalService` public surface:
`propose`, `approve`, `reject`, `listPending`.

`MediaInstructionService` public surface:
`upload`, `delete`, `deleteMany`, `removeAll`, `getUrl`.

### ⚠️ Outstanding for PR-O2

`grep` for `FirestoreService` / `StorageService` / raw `firebase/*` SDKs outside `src/js/services/**` still returns 3 hits:

| File                                                                | Imports                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/recipes/recipe_form_component/propose_recipe_component.js` | `Timestamp` from `firebase/firestore`                                                                                     |
| `src/lib/recipes/recipe_import_modal/recipe_import_modal.js`        | `getStorage, ref, uploadString, getDownloadURL` from `firebase/storage` — **dead imports** (never referenced in the file) |
| `src/lib/utilities/pdf_viewer/pdf_viewer.js`                        | `doc, getDoc` from `firebase/firestore`; `ref, getDownloadURL` from `firebase/storage`                                    |

PR-O2 migrates these (the dead one is a delete; the other two route through `FirestoreService` / `StorageService`) and then adds the strict `no-restricted-imports` rule scoped to non-service code.

### Issues opened during the umbrella

- #243 — investigate / remove image-carousel legacy string-path fallback (Q1b-2)
- #248 — pending-image approval modal: "remove" button is non-functional (found while smoking Q2)
- #250 — search button "active" border doesn't match search-bar shape (found while smoking Q3)
- #251 — manager dashboard: dirty state persists after switching panels (found while smoking Q3)

## Remaining work

Only **PR-O2** left. See below.

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
