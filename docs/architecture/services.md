# Services / Firebase Layer

All Firebase access goes through wrapper modules in `src/js/services/`. Page modules and components consume the wrappers; they never import the Firebase SDK directly. ESLint enforces this — adding `import { ... } from 'firebase/...'` outside `src/js/services/` will fail lint.

## Files

| File                        | Responsibility                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firebase-service.js`       | One-time SDK initialization via `initFirebase(config)`. All other services depend on this having run first.                                                                                                                              |
| `auth-service.js`           | Auth state observer, sign-in/out, current-user accessor, role lookup. Caches the Firestore `users/{uid}` document and refreshes it on `recipe-favorite-changed`. Exposes `waitForAuth()` so callers can await the first auth resolution. |
| `firestore-service.js`      | CRUD for the `recipes`, `users`, `active_meals`, and `cookbook` collections. The single Firestore touchpoint.                                                                                                                            |
| `storage-service.js`        | Cloud Storage uploads/downloads/deletes, fallback-size resolution for resized images.                                                                                                                                                    |
| `favorites-service.js`      | Higher-level wrapper over the user document for favorites toggling.                                                                                                                                                                      |
| `notification-service.js`   | Surface for the in-app toast component.                                                                                                                                                                                                  |
| `ai-enhancement-service.js` | Calls the Gemini-backed Cloud Functions for recipe extraction.                                                                                                                                                                           |

Firebase configuration is in `src/js/config/firebase-config.js`. Firestore security rules live in `firestore.rules`; Storage rules in `storage.rules`.

## The "no direct SDK imports" rule

Why it matters:

1. **Bundling.** Centralising the SDK in one chunk keeps Firebase out of the per-page chunks and makes tree-shaking predictable.
2. **Testability.** Tests mock the services from `tests/common/mocks/`, never the SDK directly. New code that imports `firebase/*` somewhere else silently breaks the mocks.
3. **Migration safety.** When the SDK changes (v9 → v10, modular API tweaks), there's one place to update.

The lint rule is in `eslint.config.js` — if you genuinely need a new piece of the SDK, add it to a service wrapper.

## Patterns to reuse

### Request deduplication

When multiple components mount simultaneously and ask for the same record, naïve `getDoc` calls fire in parallel before any cache is populated. The fix is to **store and return the in-flight promise**:

```js
let _fetchPromise = null;
async function getRecipe(id) {
  if (_recipeCache.has(id)) return _recipeCache.get(id);
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = getDoc(doc(db, 'recipes', id))
    .then((snap) => {
      const data = snap.data();
      _recipeCache.set(id, data);
      return data;
    })
    .finally(() => {
      _fetchPromise = null;
    });
  return _fetchPromise;
}
```

Concurrent callers await the same network request. See `docs/lessons/performance.md` ("Service Request Deduplication").

### Bounded caches

Plain `Map` caches in a long-running SPA will leak. Prefer LRU or a fixed size cap. See `docs/lessons/performance.md` ("Package Lock Noise & Memory Leaks").

### Centralized user data with event listeners

User-specific data that mutates from the UI (favorites, role) lives in `AuthService`. Components don't `getDoc('users/...')` themselves — they read from the service cache and listen for `recipe-favorite-changed` (or similar) to know when to refresh. This is dramatically cheaper than each card fetching its own favorite state.

## Auth state and roles

Three roles, stored at `users/{uid}.role`:

- `user` — default. Can browse.
- `approved` — can propose recipes and access the grandma's-recipes page.
- `manager` — can review/approve proposed recipes via `/dashboard`.

`src/lib/auth/auth-controller.js` is a custom element (`<auth-controller>`) that owns the auth modal and dispatches `auth-state-changed` whenever the user signs in/out or the role changes. The header navigation listens for that event and adds/removes role-specific tabs (favorites, grandma's recipes, dashboard).

For server-side enforcement, the truth is in `firestore.rules` and `storage.rules` — never trust the client role check alone. The May 2026 code review (`docs/code-review-2026-05.md`) called out a Storage rule that didn't enforce manager-only delete; consult that doc for the current security backlog.

## Cloud Functions

`functions/index.js` hosts:

- **Gemini-backed recipe extraction** — pulls a recipe from an image upload or a URL. Triggered by the client via callable functions.
- **Batch recipe import** — triggered by Pub/Sub for bulk operations.
- **Firestore triggers** — for downstream side effects on recipe creation/update.

Image resizing is **not** a Cloud Function any more — it's the Firebase "Resize Images" extension; configuration and bulk-reprocessing notes live in `docs/operations/firebase-image-optimization.md`.
