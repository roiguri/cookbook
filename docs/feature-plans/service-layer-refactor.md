# Service-Layer Refactor — Plan

## Status

**✅ Complete.** Umbrella branch `refactor/service-layer` (#211) ready to merge into `development`. All structural goals met; the ESLint convention rule is in place and passes with zero exemptions.

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
├── _firebase/                               # internal infrastructure (only services may import)
├── auth/
│   └── auth-service.js
├── users/
│   ├── user-service.js                      # owns users/{uid}
│   ├── favorites-service.js                 # delegates → UserService
│   └── notification-service.js              # delegates → UserService; FCM SDK direct
├── recipes/
│   ├── recipe-service.js                    # owns recipes/{id}; composes image + media services
│   ├── recipe-image-service.js              # image storage ops + URL reads; NO Firestore
│   ├── recipe-image-proposal-service.js     # proposal/moderation workflow
│   ├── media-instruction-service.js         # media-instruction Storage ops
│   └── ai-enhancement-service.js
├── pdf/
│   └── pdf-service.js                       # scanned-PDF reads (page index + page image URLs)
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

| PR        | Scope                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #197      | PR-A: `RecipeService` + `RecipeImageProposalService` API                                                                                                  |
|           | PR-B/C/D: form-submit / delete / image-proposal migrations                                                                                                |
| #212      | PR-E: search bypasses → `RecipeService.list`                                                                                                              |
| #213      | PR-F: self-heal → `RecipeService.update` PATCH                                                                                                            |
| #214      | PR-G: page list-queries                                                                                                                                   |
| #216      | Dead search-service removal                                                                                                                               |
| #218      | Phase 0: services restructured into by-domain folders                                                                                                     |
| #219      | PR-H: AI image enhance + `RecipeImageService` introduced                                                                                                  |
| #220      | PR-I: `UserService` API                                                                                                                                   |
| #222–#226 | PR-J1–J4: user-doc callers routed through `UserService`                                                                                                   |
| #227      | PR-L: `ActiveMealService` API                                                                                                                             |
| #228      | PR-M: active-meal callers migrated                                                                                                                        |
| #231      | Preview-modal approval → `RecipeService`                                                                                                                  |
| #232      | PR-N: `FailedUrlExtractionService`                                                                                                                        |
| #233      | PR-O1: `UserService.listAvatarOptions` + component-storage cleanup                                                                                        |
| #237      | Infra: jest config ignores `.claude/worktrees/` for cross-worktree test discovery                                                                         |
| #236      | PR-Q1a-1: `setPrimaryImage` → `RecipeService` (utils + service old method removed)                                                                        |
| #238      | PR-Q1a-2: `replaceImage` → `RecipeService`; `RecipeImageService.replaceFiles` (Storage-only)                                                              |
| #239      | PR-Q1a-3: `uploadAndBuildImageMetadata` → `RecipeImageService.uploadFile`                                                                                 |
| #240      | PR-Q1a-4: `RecipeImageService.deleteFiles`; `removeAllRecipeImages` inlined into `RecipeService.delete`                                                   |
| #241      | PR-Q1a-5: `migrateImageToCategory` → `RecipeImageService.migrateFilesToCategory`                                                                          |
| #242      | PR-Q1b-1: `getOptimizedImageUrl` + `getPrimaryImageUrl` → `RecipeImageService.{getOptimizedUrl, getPrimaryUrl}`                                           |
| #244      | PR-Q1b-2: `getImageUrl(path)` → `RecipeImageService.getFullUrl(image)` with typed input                                                                   |
| #245      | PR-Q2: 4 proposal helpers inlined into `RecipeImageProposalService`; `deleteImageFiles` helper + Firestore/Storage imports gone from utils                |
| #249      | PR-Q3: new `MediaInstructionService` (5 methods); `recipe-media-utils.js` becomes pure                                                                    |
| #252      | PR-Q4: deleted `getRecipeById` + `getRecipesForCards` from utils; 6 callers route through `RecipeService.get` + `formatRecipeData(...)`                   |
| #253      | PR-O2-1: dropped dead `firebase/storage` import from `recipe_import_modal.js`                                                                             |
| #254      | PR-O2-2: `RecipeService.create` service-stamps `creationTime`; dropped `firebase/firestore` import from `propose_recipe_component.js`                     |
| #255      | PR-O2-3: new `PdfService` (`getPageIndex`, `getPageImageUrl`); `pdf_viewer.js` migrated off raw Firebase SDKs                                             |
| #256      | PR-O2-4: strict `no-restricted-imports` ESLint rule for `_firebase/*` + raw `firebase/{firestore,storage,auth}` outside `src/js/services/**`; closes #215 |

### Naming deviations from the original plan

- `uploadFiles` plural → **`uploadFile`** (singular) with positional + options shape: `uploadFile(recipeId, category, file, { isPrimary, uploadedBy })`. The call writes exactly one file (Storage Resize extension regenerates variants async); plural would have misled.
- `migrateFilesToCategory` shipped as `(recipeId, image, newCategory)` — drops the `oldCategory` parameter (was only used in an error log).
- `getRecipeById` / `getRecipesForCards` weren't strict passthroughs — they applied `formatRecipeData` to the Firestore result. Q4 kept `RecipeService.get` raw and pushed the formatting decision to caller boundaries (`formatRecipeData(await RecipeService.get(id))`). This split lets render paths get normalized defaults while update paths (notably the edit form) keep the raw shape for dirty-state baselining.
- O2 was originally planned as a single PR (just adding the ESLint rule). Pre-O2 audit surfaced three uncleaned violations in `src/lib/`: a dead `firebase/storage` import in `recipe_import_modal.js`, a `Timestamp.now()` write in `propose_recipe_component.js`, and Firestore + Storage reads in `pdf_viewer.js`. O2 split into 4 PRs — three cleanup PRs followed by the rule — so each violation could be reviewed and smoked independently.
- `propose_recipe_component.js` previously set `creationTime: Timestamp.now()` itself. O2-2 moved that responsibility into `RecipeService.create` (single source of truth; caller-supplied creationTime is now ignored). Preserves the project-wide `Timestamp.now()` convention from PR #98.
- `pdf_viewer.js` Firestore + Storage reads moved into a new thin domain service `PdfService` (`src/js/services/pdf/pdf-service.js`) rather than calling `_firebase/*` services directly. Named `PdfService` (not `DocumentService`, which collides with the Firestore-document mental model, nor `CookbookService`, which is too generic since the whole app is a cookbook).

## Final state — all acceptance criteria met

| Criterion                                                                                                                                 | Status                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint rule passes with no exemptions                                                                                                     | ✅ PR-O2-4 added strict `no-restricted-imports` patterns scoped to `src/**` with `src/js/services/**` excluded. Verified with a negative test (forbidden import caught with the configured message). |
| Raw `firebase/{firestore,storage,auth}` + `_firebase/*-service` imports outside `src/js/services/**`                                      | ✅ 0 hits                                                                                                                                                                                            |
| `RecipeImageService` has zero Firestore calls                                                                                             | ✅                                                                                                                                                                                                   |
| `recipe-image-utils.js` / `recipe-media-utils.js` / `recipe-data-utils.js` contain only pure helpers (no `await`, no service/SDK imports) | ✅ verified via grep                                                                                                                                                                                 |
| `npm run lint && npx prettier --check && npm test && npm run build` green                                                                 | ✅ 0 errors, 543/543 tests, build ✓                                                                                                                                                                  |

### Public surfaces

- `RecipeService`: `get`, `list`, `generateId`, `create`, `update`, `delete`, `setPrimaryImage`, `replaceImage`.
- `RecipeImageService`: `uploadFile`, `replaceFiles`, `deleteFiles`, `migrateFilesToCategory`, `getOptimizedUrl`, `getPrimaryUrl`, `getFullUrl`.
- `RecipeImageProposalService`: `propose`, `approve`, `reject`, `listPending`.
- `MediaInstructionService`: `upload`, `delete`, `deleteMany`, `removeAll`, `getUrl`.
- `PdfService`: `getPageIndex`, `getPageImageUrl`.

### Issues opened during the umbrella (follow-ups, out of scope)

- #243 — investigate / remove image-carousel legacy string-path fallback (found smoking Q1b-2)
- #248 — pending-image approval modal: "remove" button is non-functional (found smoking Q2)
- #250 — search button "active" border doesn't match search-bar shape (found smoking Q3)
- #251 — manager dashboard: dirty state persists after switching panels (found smoking Q3)

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
