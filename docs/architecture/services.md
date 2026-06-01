# Services / Firebase Layer

All Firebase access goes through services in `src/js/services/`. The architecture has two tiers:

1. **Infrastructure services** (`src/js/services/_firebase/`) — thin wrappers around the raw Firebase SDKs (`firestore-service.js`, `storage-service.js`, `firebase-service.js`). **Only domain services may import these.**
2. **Domain services** (everything else under `src/js/services/<domain>/`) — own a Firestore collection or a Storage area, expose method-named APIs that match the domain ("create a recipe", "upload an image"), and compose infrastructure services to do the work.

**Pages and lib components consume domain services**, never infrastructure services and never raw Firebase SDKs directly. ESLint enforces both rules with zero exemptions (`eslint.config.js` → `no-restricted-imports`). Try to `import { doc } from 'firebase/firestore'` in `src/lib/`, lint fails.

The architecture was established by the service-layer refactor umbrella (#211). The plan-of-record with full history lives at [`docs/archive/feature-plans/service-layer-refactor.md`](../archive/feature-plans/service-layer-refactor.md).

## Directory layout

```
src/js/services/
├── _firebase/                               # infrastructure — only services may import
│   ├── firebase-service.js                  # one-time SDK init via initFirebase(config)
│   ├── firestore-service.js                 # generic Firestore CRUD primitives
│   └── storage-service.js                   # Storage upload / download / delete primitives
├── logger.js                                # Sentry wrapper — every service imports captureError
├── auth/
│   └── auth-service.js                      # auth state, sign-in/out, current user, role
├── users/
│   ├── user-service.js                      # owns users/{uid}
│   ├── favorites-service.js                 # favorites — delegates user-doc writes to UserService
│   └── notification-service.js              # in-app toast surface; FCM-token writes via UserService
├── recipes/
│   ├── recipe-service.js                    # owns recipes/{id}; composes image + media services
│   ├── recipe-image-service.js              # image Storage ops + URL reads; ZERO Firestore
│   ├── recipe-image-proposal-service.js     # propose/approve/reject pending images (bounded recipes/{id} writes)
│   ├── recipe-edit-suggestion-service.js    # suggest recipe edits (owns recipe_edit_suggestions)
│   ├── media-instruction-service.js         # cooking-step media Storage ops; ZERO Firestore
│   └── ai-enhancement-service.js            # Gemini-backed recipe extraction (callable function)
├── pdf/
│   └── pdf-service.js                       # scanned-PDF reads (page-index doc + page image URLs)
├── meals/
│   └── active-meal-service.js               # owns active_meals/{uid} (per-user shopping/cooking list)
└── admin/
    └── failed-url-extraction-service.js     # owns failed_url_extractions (manager dashboard)
```

Firebase configuration is in `src/js/config/firebase-config.js`. Firestore security rules live in `firestore.rules`; Storage rules in `storage.rules`.

## Domain service surfaces

Reference only — the JSDoc on each service class is canonical.

| Service                       | Methods                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `RecipeService`               | `get`, `list`, `generateId`, `create`, `update`, `delete`, `setPrimaryImage`, `replaceImage`                            |
| `RecipeImageService`          | `uploadFile`, `replaceFiles`, `deleteFiles`, `migrateFilesToCategory`, `getOptimizedUrl`, `getPrimaryUrl`, `getFullUrl` |
| `RecipeImageProposalService`  | `propose`, `approve`, `reject`, `listPending`                                                                           |
| `RecipeEditSuggestionService` | `create`, `listPending`, `get`, `approve`, `reject`                                                                     |
| `MediaInstructionService`     | `upload`, `delete`, `deleteMany`, `removeAll`, `getUrl`                                                                 |
| `PdfService`                  | `getPageIndex`, `getPageImageUrl`                                                                                       |
| `UserService`                 | (user-doc CRUD; canonical reference: JSDoc on the class)                                                                |
| `ActiveMealService`           | (active_meals lifecycle)                                                                                                |
| `FavoritesService`            | favorites toggle (delegates to `UserService`)                                                                           |
| `AuthService`                 | sign-in/out, current user, `waitForAuth()`, role                                                                        |
| `FailedUrlExtractionService`  | failed-URL admin queue                                                                                                  |
| `NotificationService`         | toast UI surface                                                                                                        |

## Load-bearing conventions

1. **One service per domain entity** — a static class under `src/js/services/<domain>/`.
2. **Services own all data access for their domain.** Utilities (`src/js/utils/`) are pure helpers — no I/O, no service/SDK imports.
3. **Only `_firebase/*` services may import raw Firebase SDKs** (`firebase/firestore`, `firebase/storage`, `firebase/auth`).
4. **Only code under `src/js/services/` may import the `_firebase/*` services.** Pages and lib components import domain services instead.
5. **Pages and lib components import services, never utilities for data ops.**
6. **One owner per Firestore doc.** Other services delegate doc reads/writes to the owner. Doc owner for `recipes/{id}` is `RecipeService`; for `users/{uid}` is `UserService`. `RecipeImageProposalService` writes a bounded slice of `recipes/{id}.{pendingImages, images}` as the documented exception for the moderation workflow.

### Argument convention

- **Positional** for ≤3 args, or 4 args where the last is a defaulted optional flag.
- **Hybrid** (positional required + options bag) for "core args + optional flags". Example: `RecipeImageService.uploadFile(recipeId, category, file, { isPrimary, uploadedBy })`.
- **Bag** (options object) when 5+ semantically-related config fields, or any boolean buried mid-list.

### Why the two-tier rule matters

1. **Bundling.** Centralising the SDK in `_firebase/*` keeps Firebase out of per-page chunks and makes tree-shaking predictable.
2. **Testability.** Tests mock services from `tests/common/mocks/`, never the SDK directly. Code that imports `firebase/*` somewhere else silently breaks the mocks.
3. **Migration safety.** When the SDK changes (v9 → v10, modular API tweaks), there's one place to update.
4. **Single owner per doc.** Routing every `recipes/{id}` write through `RecipeService` keeps invariants (image cleanup on delete, creationTime stamping, etc.) in one place rather than scattered across callers.

## Patterns to reuse

### Composing infrastructure inside a domain service

The infrastructure services do nothing domain-specific. Composition happens in the domain service:

```js
// src/js/services/recipes/recipe-service.js
import { FirestoreService } from '../_firebase/firestore-service.js';
import { Timestamp } from 'firebase/firestore';
import { RecipeImageService } from './recipe-image-service.js';
import { MediaInstructionService } from './media-instruction-service.js';

export class RecipeService {
  static async create({ recipeData, imagesToUpload, mediaItemsOrdered, uploadedBy }) {
    const recipeId = FirestoreService.generateId('recipes');
    // ... upload images via RecipeImageService.uploadFile ...
    // ... upload media via MediaInstructionService.upload ...
    const docPayload = { ...recipeData, creationTime: Timestamp.now(), images, mediaInstructions };
    await FirestoreService.setDocument('recipes', recipeId, docPayload);
    return { recipeId, mediaUploadResults };
  }
}
```

A lib component calling this just sees:

```js
import { RecipeService } from '../../../js/services/recipes/recipe-service.js';

await RecipeService.create({ recipeData, imagesToUpload, mediaItemsOrdered, uploadedBy });
```

It never sees Firestore, Storage, or Timestamps.

### Request deduplication and caching

When multiple components mount simultaneously and ask for the same record, naïve fetches fire in parallel before any cache is populated. The fix is to **store and return the in-flight promise** inside the service:

```js
let _fetchPromise = null;
const _recipeCache = new Map();

static async get(recipeId) {
  if (_recipeCache.has(recipeId)) return _recipeCache.get(recipeId);
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = FirestoreService.getDocument('recipes', recipeId)
    .then((data) => {
      _recipeCache.set(recipeId, data);
      return data;
    })
    .finally(() => { _fetchPromise = null; });
  return _fetchPromise;
}
```

Concurrent callers await the same network request. See [`docs/lessons/performance.md`](../lessons/performance.md) ("Service Request Deduplication").

### Bounded caches

Plain `Map` caches in a long-running SPA leak. Prefer LRU or a fixed size cap. See [`docs/lessons/performance.md`](../lessons/performance.md) ("Package Lock Noise & Memory Leaks").

### Centralised user data with event listeners

User-specific data that mutates from the UI (favorites, role) lives in `AuthService` / `UserService`. Components don't read `users/{uid}` themselves — they consume the service cache and listen for `recipe-favorite-changed` (or similar) to know when to refresh. Dramatically cheaper than each card fetching its own favorite state.

### Render vs. update reads

`RecipeService.get(id)` returns the raw Firestore document. Callers that **render** a recipe wrap it in `formatRecipeData(...)` (from `src/js/utils/recipes/recipe-data-utils.js`) to apply default-shaped fields:

```js
const recipe = formatRecipeData(await RecipeService.get(id)); // render path
const recipe = await RecipeService.get(id); // update path
```

Update paths (notably the edit form) keep the raw shape so dirty-state comparisons against subsequent form captures don't trip on defaulted fields. This split is by design.

## Error reporting

Services route caught errors through `src/js/services/logger.js` (a thin Sentry wrapper). The full story — Sentry init, release/environment flow, privacy, fingerprinting, performance impact, quota, verification — lives in [`observability.md`](./observability.md). This section covers only what you need when **writing service code**.

### The catch rule

Every `catch` block has to decide: report or not?

| Catch shape                                                           | What to do                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `} catch (e) { throw e; }` — pure rethrow                             | **Skip.** Lower layer (Firestore/Storage) already captured.                                                                                            |
| `} catch (e) { return default; }` — swallow + default                 | **`captureError(e, ...)` before the return.** Error is invisible otherwise.                                                                            |
| `} catch (e) { throw new Error('Failed to X'); }` — transform         | **`captureError(e, ...)` before the rethrow.** Original stack is lost otherwise.                                                                       |
| `} catch (e) { console.error(...); throw e; }` — log + rethrow        | **`captureError(e, ...)`.** Console alone isn't visible in production.                                                                                 |
| `} catch (e) { console.error(...); return default; }` — log + swallow | **`captureError(e, ...)`.** Same reason.                                                                                                               |
| `} catch {` — silent, no binding                                      | If intentional (existence probe, fallback chain, best-effort cleanup), leave a `// silent: <reason>` comment. Otherwise give it a binding and capture. |
| `.catch(() => {})` on a Promise — silent best-effort cleanup          | Same as silent. Cleanup noise (e.g. orphaned WebP variants) should not pollute Sentry — comment and skip.                                              |

One report per logical failure, not per layer. Re-throw unchanged → trust the lower layer.

### How to call it

```js
import { captureError } from '../logger.js'; // adjust depth

captureError(error, {
  service: 'recipe', // domain tag (see table below)
  op: 'create', // method name
  recipeId, // identifiers — searchable on the issue page
  uid,
});
```

### Service-tag values

Pick a kebab-case domain name per file and stick with it.

| File                                        | `service` tag            |
| ------------------------------------------- | ------------------------ |
| `_firebase/firestore-service.js`            | `firestore`              |
| `_firebase/storage-service.js`              | `storage`                |
| `auth/auth-service.js`                      | `auth`                   |
| `users/favorites-service.js`                | `favorites`              |
| `users/notification-service.js`             | `notification`           |
| `recipes/recipe-service.js`                 | `recipe`                 |
| `recipes/recipe-image-service.js`           | `recipe-image`           |
| `recipes/recipe-edit-suggestion-service.js` | `recipe-edit-suggestion` |
| `recipes/media-instruction-service.js`      | `media-instruction`      |
| `meals/active-meal-service.js`              | `active-meal`            |
| (SPA core) `src/app/core/router.js`         | `router`                 |
| (SPA core) `src/app/core/page-manager.js`   | `page-manager`           |

When adding a new service, add a row.

### Don't put user input in capture context

The `{ ...identifiers }` go to Sentry as searchable "extra" data. IDs and operation names only — never raw form fields, search queries, or recipe content. Privacy details in [`observability.md`](./observability.md#privacy).

## Auth state and roles

Three roles, stored at `users/{uid}.role`:

- `user` — default. Can browse.
- `approved` — can propose recipes and access the grandma's-recipes page.
- `manager` — can review/approve proposed recipes via `/dashboard`.

`src/lib/auth/auth-controller.js` is a custom element (`<auth-controller>`) that owns the auth modal and dispatches `auth-state-changed` whenever the user signs in/out or the role changes. The header navigation listens for that event and adds/removes role-specific tabs (favorites, grandma's recipes, dashboard).

For server-side enforcement, the truth is in `firestore.rules` and `storage.rules` — never trust the client role check alone. The May 2026 code review ([`docs/code-review-2026-05.md`](../code-review-2026-05.md)) called out a Storage rule that didn't enforce manager-only delete; consult that doc for the current security backlog.

## Cloud Functions

`functions/index.js` hosts:

- **Gemini-backed recipe extraction** — pulls a recipe from an image upload or a URL. Triggered by the client via callable functions (called through `ai-enhancement-service.js`).
- **Batch recipe import** — triggered by Pub/Sub for bulk operations.
- **Firestore triggers** — downstream side effects on recipe creation/update.

Image resizing is **not** a Cloud Function any more — it's the Firebase "Resize Images" extension; configuration and bulk-reprocessing notes live in [`docs/firebase-image-optimization.md`](../firebase-image-optimization.md).
