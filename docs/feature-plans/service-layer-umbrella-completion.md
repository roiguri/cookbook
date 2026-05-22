# Plan: service-layer umbrella — completion (revised)

This plan supersedes the earlier "Phase 7 follow-up umbrella" framing. All work below lands inside the current `refactor/service-layer` umbrella (#211) **before** the umbrella merges to `development`. There is no follow-up umbrella.

## Why this revision

After Phase 5 we identified that the planned ESLint exemption for `src/js/utils/recipes/**` would hide two structural problems we want eliminated, not deferred:

1. **Three utils files mix pure helpers with data-access code.** Writes (uploads, deletes, Firestore updates) live alongside formatters and validators. The convention says writes belong in services.
2. **One method has two homes.** `setPrimaryImage` exists on `RecipeImageService` (as a thin pass-through) and in `recipe-image-utils.js` (real implementation). The umbrella's stated goal is one canonical home per operation.

The umbrella's premise has always been "services own all data access." Shipping with an exemption + a duplicate would undercut that promise. This revision finishes the job in the same umbrella.

## Three goals (load-bearing for umbrella merge)

1. **Service layer is the only data-access API.** No file outside `src/js/services/**` imports `_firebase/firestore-service.js`, `_firebase/storage-service.js`, or raw Firebase SDKs (`firebase/firestore`, `firebase/storage`, `firebase/auth`). Enforced by a strict ESLint rule with **no exemptions**.
2. **Every operation has one canonical home.** No method exists on two services, and no service method is a thin pass-through to a utils function. The utils function either becomes the service method, or it goes away.
3. **Utils contain only pure helpers.** Synchronous, no `await`, no service or SDK imports. Acceptable shapes: formatters, validators, ID generators, in-memory transformations, constants.

## End state — acceptance criteria for umbrella merge

- `npm run lint` passes with the strict `no-restricted-imports` rule (no exemptions, no `eslint-disable` overrides).
- `grep -r "FirestoreService\|StorageService\|firebase/firestore\|firebase/storage\|firebase/auth" src/ --include="*.js"` shows imports only inside `src/js/services/**`.
- `src/js/utils/recipes/recipe-image-utils.js`, `recipe-media-utils.js`, `recipe-data-utils.js` contain only pure helpers (no `await`, no service/SDK imports).
- PR-Q0 audit findings (in this plan) verified by inspection: every cross-service name duplicate is either a legitimate CRUD primitive across domains or a domain-typed wrapper over a `_firebase/*` service. No accidental cross-service duplicates remain.
- `gh issue close 215` (the read-helper exemption question is moot).
- Full smoke walkthrough passes (list at the end of this plan).

## Branching

All sub-PRs land directly on `refactor/service-layer`. No nested sub-umbrella.

```
development
└── refactor/service-layer (#211 umbrella, in-flight)
    ├── refactor/component-storage-cleanup        (PR-O1 — currently staged, uncommitted)
    ├── refactor/service-dedupe-audit             (PR-Q0)
    ├── refactor/recipe-image-writes-into-service (PR-Q1a — recipe-image writes)
    ├── refactor/recipe-image-proposal-inline     (PR-Q1b — proposal: inline existing pass-throughs)
    ├── refactor/media-instruction-service        (PR-Q1c — new domain: writes + URL + caller)
    ├── refactor/recipe-image-urls-into-service   (PR-Q2  — recipe-image URL helpers)
    ├── refactor/recipe-service-passthroughs      (PR-Q3  — getRecipeById/getRecipesForCards)
    └── refactor/service-layer-eslint             (PR-O2  — strict rule, no exemptions)
```

One sub-PR at a time. Each merges into `refactor/service-layer` before the next one branches off. After PR-O2, the umbrella merges to `development`.

**Sub-PR sizing principle**: each PR touches one domain and one concern. Recipe-image writes (Q1a) is separate from recipe-image-proposal (Q1b) is separate from media-instructions (Q1c) is separate from recipe-image URL reads (Q2) — even though three of them touch the same utils file. Smaller PRs make review and rollback predictable.

## Sub-PR sequence

### PR-O1 — Component storage cleanup (currently staged, uncommitted)

**What ships now (final-state code):**

- `UserService.listAvatarOptions()` — new service method covering the avatar grid Storage read.
- `user-profile.js` migrated to use it; drops direct `StorageService` + `firebase/storage` imports.
- Test mocks updated (`auth-service.test.mjs`, `favorites-service.test.mjs`) for UserService's new StorageService dependency.

**What is temporarily-routed-through-utils (will be unwound in PR-Q2):**

- `ai-image-enhance-modal.js` and `image-carousel.js` switched from direct `StorageService.getFileUrl(path)` to the existing utils helper `getImageUrl(path)`. This moves the violation rather than fixing it — PR-Q2 will route both through `RecipeImageService` with proper domain typing.

Ship as one commit, merge into umbrella, then proceed.

---

### PR-Q0 — Service de-duplication audit (one-time, findings documented)

PR-Q0 is a planning/documentation step, not a code change. Done once at the start of the umbrella completion to lock down the dedupe scope. No script is committed — the audit was a one-shot inspection. Real layering enforcement is the ESLint `no-restricted-imports` rule in PR-O2.

**Method used:** grep over `src/js/services/**/*.js` for `static [async] methodName(` declarations, grouped by name. Manual inspection of each multi-site name to classify legitimate vs. accidental.

**Utils ↔ service pass-throughs (eliminated in Q1a/b/c):**

| Service method                           | Status today                                         | Resolution PR                             |
| ---------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| `RecipeImageService.setPrimaryImage`     | thin pass-through to utils `setPrimaryImage`         | PR-Q1a (inline impl, delete utils export) |
| `RecipeImageProposalService.propose`     | thin pass-through to utils `addPendingImages`        | PR-Q1b (inline)                           |
| `RecipeImageProposalService.approve`     | thin pass-through to utils `approvePendingImageById` | PR-Q1b (inline)                           |
| `RecipeImageProposalService.reject`      | thin pass-through to utils `rejectPendingImageById`  | PR-Q1b (inline)                           |
| `RecipeImageProposalService.listPending` | thin pass-through to utils `getPendingImages`        | PR-Q1b (inline)                           |

**Cross-service name duplicates (all legitimate — kept as-is):**

| Name                                        | Services                                                                                                               | Why it's OK                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `get`, `list`, `create`, `update`, `delete` | `UserService`, `RecipeService`, `FailedUrlExtractionService`                                                           | CRUD primitives — each owns a different collection.                    |
| `generateId`                                | `FirestoreService` (generic, takes collection arg) + `RecipeService` (domain-typed wrapper that pre-fills `'recipes'`) | Layered: domain service → low-level wrapper service. Expected pattern. |

**Zero accidental cross-service duplicates of the same operation.** The 5 utils↔service rows are the only real duplication to fix, and they're already assigned to Q1a/b/c.

**Acceptance:**

- Audit performed; findings (above) documented in this plan.
- No code change required in PR-Q0; the dedupe goal is met by completing Q1a/b/c.

---

### PR-Q1a — Recipe-image writes leave utils → `RecipeImageService`

Move every write-side function specific to **approved** recipe images from `recipe-image-utils.js` into `RecipeImageService`. Proposal-side writes are PR-Q1b. Media-instruction writes are PR-Q1c.

**Functions to move:**

| Utils export                                                        | Resolution                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setPrimaryImage(recipeId, imageId)`                                | Inline the body into `RecipeImageService.setPrimaryImage` (the existing pass-through is replaced with the real impl). Delete the utils export and the `setPrimaryImageInternal` import in the service file. |
| `deleteImageFiles({ full })`                                        | Move into the service file. Default to public static `RecipeImageService.deleteFiles(image)`. If no external callers remain after PR-Q1a/b/c, downgrade to module-private.                                  |
| `removeAllRecipeImages(recipeId)`                                   | → `RecipeImageService.removeAllForRecipe(recipeId)`                                                                                                                                                         |
| `migrateImageToCategory(image, recipeId, oldCategory, newCategory)` | → `RecipeImageService.migrateToCategory(...)`                                                                                                                                                               |
| `uploadAndBuildImageMetadata({...})`                                | → `RecipeImageService.uploadAndBuildMetadata(...)`                                                                                                                                                          |

**No new methods added beyond `RecipeImageService.deleteFiles` / `removeAllForRecipe` / `migrateToCategory` / `uploadAndBuildMetadata`.** `setPrimaryImage` is consolidated, not added.

**Caller updates:**

- `recipe-service.js` — internal calls switch from utils to `RecipeImageService.*`.

**Out of scope for Q1a:** proposal-side writes (Q1b), media-instructions (Q1c), URL helpers (Q2).

**Acceptance:**

- These 5 exports gone from `recipe-image-utils.js`.
- `setPrimaryImage` exists once (in `RecipeImageService`).
- Existing `recipe-service.test.mjs` covers `recipe-service.js` callers. Add tests for new public methods on `RecipeImageService` if not already covered by existing service tests.
- All gates green.

---

### PR-Q1b — Recipe-image-proposal: inline the existing pass-throughs

`RecipeImageProposalService` already has the full public API (`propose`, `approve`, `reject`, `listPending`). Each method today is a 1-line pass-through to a utils function. **This PR adds zero new methods.** It only inlines the implementations and deletes the utils exports.

**Inlines:**

| Service method (existing)                | Utils impl to inline + delete                           |
| ---------------------------------------- | ------------------------------------------------------- |
| `RecipeImageProposalService.propose`     | `addPendingImages(recipeId, files, category, uploader)` |
| `RecipeImageProposalService.approve`     | `approvePendingImageById(recipeId, pendingImageId)`     |
| `RecipeImageProposalService.reject`      | `rejectPendingImageById(recipeId, pendingImageId)`      |
| `RecipeImageProposalService.listPending` | `getPendingImages(recipeId)`                            |

**No public surface change.** No callers update. The utils file shrinks by 4 exports.

**Out of scope:** anything beyond these 4 inlines. If one of the utils impls calls another utils function moved in Q1a, the service method imports from the new `RecipeImageService` location — straightforward dependency reshuffle inside the service folder.

**Acceptance:**

- 4 exports gone from `recipe-image-utils.js`.
- `RecipeImageProposalService` has the same 4 public methods, now with inline bodies (no utils imports).
- Existing tests still pass — surface didn't change.

---

### PR-Q1c — `MediaInstructionService`: whole new domain in one PR

Media instructions are a self-contained domain (cooking-step videos/images attached to a recipe). The 4 writes + 1 URL read + the single lib-component caller all migrate together. Putting writes + URL + caller in one PR keeps the new service's birth coherent.

**Create `src/js/services/recipes/media-instruction-service.js`:**

| Method                                                               | Replaces utils function            |
| -------------------------------------------------------------------- | ---------------------------------- |
| `MediaInstructionService.upload(file, recipeId, userId, onProgress)` | `uploadMediaInstructionFile(...)`  |
| `MediaInstructionService.delete(filePath)`                           | `deleteMediaInstructionFile(...)`  |
| `MediaInstructionService.deleteMany(filePaths)`                      | `deleteMediaInstructionFiles(...)` |
| `MediaInstructionService.removeAll(mediaInstructions)`               | `removeAllMediaInstructions(...)`  |
| `MediaInstructionService.getUrl(storagePath)`                        | `getMediaInstructionUrl(...)`      |

5 public methods total. `getUrl` takes a string — explicitly noted: media-instruction storage paths ARE the domain identifier (there's no richer object to type against, unlike `RecipeImage`); the input string is a typed domain reference, not a generic Storage path.

**Caller updates:**

- `src/js/services/recipes/recipe-service.js` — `recipe-service.js`'s internal `uploadMediaItems` helper currently calls the utils functions; swap to `MediaInstructionService.*`.
- `src/lib/media/media-instructions-editor/media-instructions-editor.js` — only lib-component caller. Migrate to `MediaInstructionService` for both writes and the URL read.

**Acceptance:**

- All 5 media-instruction exports gone from `recipe-media-utils.js` → file now contains only its 3 pure helpers.
- New `MediaInstructionService` ships with its own test file (`tests/js/services/media-instruction-service.test.mjs`).
- All gates green.

---

### PR-Q2 — Recipe-image URL helpers → `RecipeImageService` (with domain typing)

The component-callsite-heavy PR. Moves the 3 recipe-image URL helpers into `RecipeImageService`, with the load-bearing constraint that service methods take **recipe-image-typed inputs** (RecipeImage / recipe objects), not arbitrary storage paths.

**Moves:**

| Utils export                        | New service method                                | Notes                                           |
| ----------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `getOptimizedImageUrl(image, size)` | `RecipeImageService.getOptimizedUrl(image, size)` | Already takes a `RecipeImage`; mechanical move. |
| `getPrimaryImageUrl(recipe, size)`  | `RecipeImageService.getPrimaryUrl(recipe, size)`  | Already takes a recipe; mechanical move.        |
| `getImageUrl(storagePath)`          | `RecipeImageService.getFullUrl(image)`            | **Signature change** — see below.               |

**Signature change for `getImageUrl`:**
The current `getImageUrl(string)` is a generic Storage URL resolver. Migrating as-is would erode `RecipeImageService`'s domain boundary (avatars / PDFs / etc. would creep onto a recipe-image service). The new method is `RecipeImageService.getFullUrl(image)` where `image: RecipeImage`; the method resolves `image.full` internally. Both current callers update:

- `ai-image-enhance-modal.js`: already has `this._image`; passes the object instead of `this._image.full`. Also unwinds PR-O1's `getImageUrl` import.
- `image-carousel.js`: the legacy `typeof image === 'string' && image.startsWith('img/recipes/')` branch normalizes `string → { full: string }` at the carousel level before the service call. Also unwinds PR-O1's `getImageUrl` import.

**Caller updates (7 component/page files — recipe-image only):**

- `src/lib/recipes/recipe-card/recipe-card.js`
- `src/lib/recipes/recipe_component/recipe_component.js`
- `src/lib/recipes/recipe_form_component/recipe_form_component.js`
- `src/lib/media/image-carousel/image-carousel.js`
- `src/lib/media/ai-image-enhancer/ai-image-enhancer.js`
- `src/lib/media/ai-image-enhancer/ai-image-enhance-modal.js`
- `src/lib/modals/image-approval-multi/image-approval-multi.js`

(Media-instruction URL caller is NOT in this PR — `media-instructions-editor.js`'s URL call already migrated to `MediaInstructionService.getUrl` in PR-Q1c.)

**Acceptance:**

- These 3 exports gone from `recipe-image-utils.js` → file now contains only its 6 pure helpers.
- No method on `RecipeImageService` accepts an arbitrary storage-path string (audit by grep for `string.*path` in service signatures).
- PR-O1's temporary `getImageUrl` import in `ai-image-enhance-modal.js` and `image-carousel.js` is unwound.
- All gates green.

---

### PR-Q3 — Thin read passthroughs deleted

`getRecipeById(id)` and `getRecipesForCards(opts)` in `recipe-data-utils.js` are thin duplicates of `RecipeService.get(id)` / `RecipeService.list(opts)`. **Pre-flight audit** confirms signature compatibility:

```bash
grep -rn "getRecipeById\|getRecipesForCards" src/ --include="*.js"
```

Any caller that relies on a utils-specific behavior (default sort, error swallow, field projection) gets that behavior pushed onto `RecipeService` first, then the passthrough is deleted.

**Caller updates (5 files):**

- `src/app/pages/my-meal-page.js`
- `src/lib/recipes/recipe-card/recipe-card.js`
- `src/lib/recipes/recipe_component/recipe_component.js`
- `src/lib/recipes/recipe_form_component/parts/recipe-related-field.js`
- `src/lib/media/image-proposal-modal/image-proposal-modal.js`

**Acceptance:**

- `recipe-data-utils.js` retains only its 10 pure helpers (constants, formatters, validators).
- `RecipeService.get` / `RecipeService.list` are the only entry points to recipes-collection reads.
- All gates green.

---

### PR-O2 — Strict ESLint rule, no exemptions

The convention enforcer. Adds `no-restricted-imports` to the ESLint config with this shape:

```js
// .eslintrc — applied to all .js/.mjs files NOT under src/js/services/
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

Optionally, also add a `no-restricted-syntax` rule (or a custom audit step) that fails CI if a service method name appears on two services (uses the audit script from PR-Q0).

**Acceptance:**

- `npm run lint` passes with zero exemptions and zero `eslint-disable` overrides.
- `gh issue close 215` (the read-helper exemption question is resolved by elimination).
- All gates green.

---

## Risks

| PR  | Risk                                                                               | Mitigation                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Avatar grid breaks                                                                 | Manual smoke: open user profile, change avatar                                                                                                              |
| Q0  | Audit misses a duplicate                                                           | Grep for static method names; run script in CI before umbrella merge                                                                                        |
| Q1a | Behavior change in moved recipe-image writes                                       | Existing `recipe-service.test.mjs` covers most paths. Add inline tests for new public methods if not covered. Smoke recipe propose/edit/delete after merge. |
| Q1a | `setPrimaryImage` consolidation breaks `image-approval-multi.js` calls             | That file already calls `RecipeImageService.setPrimaryImage` — only the impl changes. Smoke: manager approve+primary flow.                                  |
| Q1b | Inline introduces subtle bug in propose/approve/reject flows                       | Proposal-service test should already exist (added in PR-A); rerun. Smoke: end-user propose → manager approve.                                               |
| Q1c | New service breaks media-instructions editor                                       | New service tests + manual smoke: add a media instruction (video upload, image), delete one, edit category (triggers `removeAll`).                          |
| Q2  | 7 components break simultaneously                                                  | Single squashed commit so revert is one-shot. Smoke list below.                                                                                             |
| Q2  | `image-carousel` legacy string-path branch behaves differently after normalization | Carousel smoke specifically: recipes with old string-path images if any exist in dev data.                                                                  |
| Q3  | A passthrough caller relied on a util-specific behavior                            | Pre-flight signature audit before opening the PR.                                                                                                           |
| O2  | ESLint rule too aggressive, blocks legitimate service-internal call                | Service files explicitly excluded from the restriction by file pattern.                                                                                     |

## Open questions (settle before opening the relevant PR)

1. **PR-Q1a — public vs module-private moved helpers.** E.g. `migrateImageToCategory` is service-internal only — public static method (`RecipeImageService.migrateToCategory`) or module-scoped (`_migrateToCategory`)? Default: public for testability, unless truly private to one service.
2. **PR-Q2 — image-carousel legacy string branch.** Normalize at the carousel callsite, normalize upstream in the data layer, or retire the branch entirely? Resolve in PR-Q2 by surveying whether any current data actually triggers that branch.
3. **PR-Q3 — signature divergence check.** Pre-flight audit of every caller of `getRecipeById` / `getRecipesForCards` to confirm `RecipeService.get` / `list` is a drop-in replacement. If not, plan an extra PR.
4. **PR-O2 — dedupe enforcement in lint or via script.** Whether the "one canonical home per method" rule lives in ESLint config (`no-restricted-syntax`) or as a standalone audit script run in pre-commit. Both work; pick one in PR-O2 design.

The earlier "`addPendingImages` vs `propose` semantic split" question is removed — confirmed by reading the service that `propose` IS the `addPendingImages` pass-through, so PR-Q1b is purely inlining, no naming decision needed.

## Service method naming convention

All new methods follow **verb-first** naming to match existing services (`get`, `list`, `create`, `update`, `delete`, `addToArrayField`, `removeFromArrayField`, `listPending`, `subscribe`, `setPrimaryImage`, `replaceImage`):

- URL reads: `getFullUrl`, `getOptimizedUrl`, `getPrimaryUrl`, `getUrl` (on `MediaInstructionService`)
- Storage writes: `deleteFiles`, `removeAllForRecipe`, `migrateToCategory`, `uploadAndBuildMetadata`, `upload`, `delete`, `deleteMany`, `removeAll`
- Proposal lifecycle: `add`, `approve`, `reject`, `listPending`, `propose`

If a name collides with an existing method, rename the new one to something more specific rather than overload.

## Final smoke walkthrough (before umbrella → development)

Run on `refactor/service-layer` after PR-O2 merges, before opening the umbrella → development PR:

1. **Recipe display**: home, categories, recipe-detail — images render (full, optimized, primary URL paths exercised)
2. **My meal**: add recipes, switch tabs, change servings, remove, clear meal; cross-tab/device live sync
3. **Recipe propose/edit/delete**: create with images + media instructions; edit (change category, replace image, remove media); delete
4. **Image proposal flow** (manager): propose images as approved user → approve/reject as manager → primary image selection
5. **AI image enhance**: open enhance modal → enhance → save (before-image URL via `getFullUrl`; after-image save)
6. **Image carousel**: legacy string-path recipes (if any exist in dev data) — confirm normalization works
7. **Manager dashboard**: pending recipes, user role admin, failed URL extractions
8. **Auth + profile**: sign in (Google + email/password), open profile, change avatar, password reset
9. **Favorites**: add/remove favorites; persists across reload
10. `npm run lint && npm run format -- --check && npm test && npm run build`

Open the umbrella PR with `Fixes #211` and `Fixes #215`.
