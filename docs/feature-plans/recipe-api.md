# Recipe API — Design & Build Plan

Tracking issue: _TBD_

An HTTP API that lets external tools and agents (first consumer: a personal assistant agent) read and add recipes **on behalf of a family member**, with exactly the permissions that member has in the app. Structured recipes only — the API never extracts, guesses or calls Gemini.

Status: **in progress** — decisions locked 2026-10-23; slice 0 (spike) done.

## Progress

- [x] Slice 0 — Spike: prove "act as the user" (emulators) — 16/16 checks passed, 2026-10-23
- [x] Slice 1 — Shared recipe-model module — `src/js/shared/recipe-model.js`, 2026-10-24
- [ ] Slice 2 — Token store + dashboard management
- [ ] Slice 3 — API skeleton: auth + user session + reads
- [ ] Slice 4 — Create (no media)
- [ ] Slice 5 — Media (images + media instructions)
- [ ] Slice 6 — Hardening, docs, rollout (test project → production)

Details for each slice are in [§5](#5-slices).

---

## 1. Locked decisions

| #   | Decision                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Who:** only `approved` and `manager` users. A plain `user` gets no API access. The role is re-checked on every request, so a demotion cuts access immediately.                                                                                                                       |
| 2   | **Structured only:** the caller sends a recipe in the published JSON format. No extraction endpoint, no free text, no Gemini.                                                                                                                                                          |
| 3   | **Acts as the user:** the function signs in _as the token's owner_ and does all recipe work through the Firebase **client** SDK (`firebase/firestore/lite` + `firebase/storage`). `firestore.rules` and `storage.rules` stay the single permission model for both the app and the API. |
| 4   | **Admin SDK is for token bookkeeping only:** hashing/lookup, last-used, revocation, and minting the custom token. It never reads or writes recipe data or recipe files.                                                                                                                |
| 5   | **Shared recipe-model module:** one module defines the recipe shape (allowed fields, types, defaults, normalization, file-entry shapes) and is used by both the app and the function, so both paths build identical documents.                                                         |
| 6   | **Tried / not tried is the caller's choice:** every create takes `stage: 'to-try' \| 'tested'` (default `to-try`). Like a create in the app, `tested` does **not** stamp `testedAt` (only "mark tested" later does; the recipe page falls back to `creationTime`).                     |
| 7   | **Optional submission:** `submit: true` also proposes the recipe to managers (a `recipe_submissions` doc in the same batch, as the app does).                                                                                                                                          |
| 8   | **Always private:** the API has no publish option; it always writes `visibility: 'private'`. Managers publish in the app.                                                                                                                                                              |
| 9   | **Media is part of the feature:** images and media instructions are uploaded with the recipe (multipart). The feature is not released without them.                                                                                                                                    |
| 10  | **Reads and writes ship together** as one feature.                                                                                                                                                                                                                                     |
| 11  | **Tokens:** lifetime (no expiry), named, several per user, scope `read` or `read+write`, stored as a hash only (secret shown once), last-used tracked, revocable.                                                                                                                      |
| 12  | **Tokens are managed in the manager dashboard** (for now): managers create tokens for themselves or for any approved user, list everyone's tokens (never the secret), and revoke. Each token records `createdBy`. User self-service is a later option.                                 |
| 13  | **Not in v1:** updates/deletes, publishing, large videos (two-step upload), images by URL, extraction, user self-service tokens.                                                                                                                                                       |

---

## 2. Architecture

```
caller ──HTTPS──▶ recipeApi (Cloud Function, onRequest)
                   │
                   ├─ 1. Admin SDK: hash bearer token → api_tokens/{hash}
                   │      not found / revoked / wrong scope        → 401 / 403
                   │      owner missing, disabled, not approved     → 401 / 403
                   │      bump lastUsedAt
                   ├─ 2. Admin SDK: createCustomToken(uid)
                   ├─ 3. initializeApp(config, <per-request name>)
                   │      signInWithCustomToken  → a real session for that user
                   ├─ 4. as the user (rules enforced):
                   │      firebase/storage       uploadBytes (images, media)
                   │      firebase/firestore/lite writeBatch / getDoc / query
                   └─ 5. deleteApp (always, in finally)
```

Why a per-request app instance: one function instance serves concurrent requests; a shared client app would share one sign-in state across users. A fresh named app per request isolates them completely.

Why the client SDK and not the Admin SDK: the Admin SDK bypasses both rule files, so every permission (roles, `submittedTogether`, shares, Storage upload tags) would have to be re-implemented in function code and would drift. Storage in particular has no documented REST API that applies `storage.rules`; the Firebase JS SDK does.

---

## 3. API contract (v1)

Base: `https://<region>-<project>.cloudfunctions.net/recipeApi`. Auth on every call: `Authorization: Bearer <token>`.

### Write — `POST /recipes` (scope `read+write`)

`multipart/form-data`:

- `recipe` (JSON part):

  ```jsonc
  {
    "id": "optional-client-id", // retry-safe: same id twice → returns the existing recipe
    "stage": "to-try", // "to-try" | "tested" (default "to-try")
    "submit": false, // true → also propose to managers
    "recipe": {
      // the shared recipe format; only `name` is required
      "name": "…",
      "description": "…",
      "attribution": "…",
      "category": "main-courses",
      "mainIngredient": "…",
      "difficulty": "…",
      "prepTime": 20,
      "waitTime": 0,
      "servings": 4,
      "tags": [],
      "ingredients": [{ "item": "…", "amount": "…", "unit": "…" }], // or ingredientSections
      "instructions": ["…"], // or stages
      "comments": [],
    },
    "images": [{ "part": "photo1", "isPrimary": true }],
    "mediaInstructions": [{ "part": "step1", "caption": "…" }], // in display order
  }
  ```

- one file part per referenced `part` name.

Response `201`: `{ id, name, stage, submitted, link, images: n, mediaInstructions: n }`. A retry with an existing `id` returns `200` with the same body.

### Reads (scope `read` or `read+write`)

| Endpoint                    | Returns                                                                             | Mirrors                             |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| `GET /recipes/:id`          | one recipe in the shared format, if the user can see it in the app; otherwise `404` | `RecipeService.get` + read rule     |
| `GET /recipes/mine?stage=`  | the user's own recipes (private and published), newest first                        | `RecipeService.listMine`            |
| `GET /recipes?category=&q=` | published recipes (search/filter)                                                   | `RecipeService.listPublished`       |
| `GET /categories`           | valid category ids + Hebrew labels                                                  | `recipe-data-utils.js` category map |

Reads return the same shape that `POST /recipes` accepts, with file entries resolved to download URLs.

### Errors

`400` invalid body · `401` bad/revoked token or missing user · `403` wrong scope, role, or rules denied · `404` not found _or not visible_ (never reveals existence) · `409` id taken by someone else's recipe · `413` payload too large · `429` daily cap · `500` otherwise. Body: `{ error: { code, message } }`.

---

## 4. Data model additions

`api_tokens/{sha256(token)}` — **no client access** (rules deny all; only functions touch it):

```
uid, name, scope ('read' | 'read+write'), createdBy (manager uid), createdAt,
lastUsedAt, revokedAt (null = active), revokedBy
```

Recipes created through the API get one hidden field: `createdVia: { kind: 'api', tokenId }` (for auditing and cleanup if a token leaks; not shown in the UI).

Token format: `ckb_` + 32 random bytes (base64url). Only the SHA-256 is stored.

---

## 5. Slices

Each slice merges to `development` on its own; the feature is **released to production only after slice 6**.

### Slice 0 — Spike: prove "act as the user" (throwaway branch)

Goal: remove the technical risk before building anything real. All against the emulators (the Auth emulator accepts unsigned custom tokens, so no IAM is needed locally).

- In a Node 22 function: custom token → per-request app → `signInWithCustomToken`.
- `firestore/lite` `writeBatch` of recipe + submission passes `submittedTogether` (`getAfter`).
- A write the rules forbid (other `authorId`, `published`) is rejected.
- `firebase/storage` `uploadBytes` with `uploadedBy` metadata passes `storage.rules`; a wrong tag is rejected.
- Two concurrent requests for two users don't share auth state.
- Measure added latency per request.

Exit: a short findings note appended here. If any check fails, revisit decision 3 before slice 1.

**Findings (2026-10-23)** — branch `spike/recipe-api-act-as-user`, `spikes/recipe-api/spike.mjs`; Node 22, `firebase` 11.10.0 (same as the app), Auth/Firestore/Storage emulators with this repo's rules. **16/16 passed — decision 3 stands.**

| Check                                                                                  | Result                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Custom token → per-request named app → `signInWithCustomToken`                         | ✅ correct uid                                    |
| Approved: private `to-try`; `tested` + submission in one `writeBatch`                  | ✅                                                |
| Plain user: recipe + submission batch passes `submittedTogether` (`getAfter` via lite) | ✅ (without the submission → denied)              |
| Other `authorId` / `published` create                                                  | ✅ denied                                         |
| Reads: own private, published, shared-with-me by id; other's private                   | ✅ / ✅ / ✅ / denied                             |
| Queries: `authorId == me`, `visibility == published`; unfiltered list                  | ✅ / ✅ / denied                                  |
| Storage `uploadBytes`: own `uploadedBy` tag; other's tag; `text/plain`                 | ✅ / denied / denied                              |
| 2 users × 15 interleaved concurrent sessions                                           | ✅ identities never mixed                         |
| Custom token for a **non-existent** uid                                                | ⚠️ sign-in **creates** that Auth user — confirmed |
| Disabled user                                                                          | ✅ rejected (`auth/user-disabled`)                |
| Session open + close (emulator)                                                        | median 11 ms — not representative of production   |
| Client SDK loads via CommonJS `require` (functions are CJS)                            | ✅                                                |

Carry into later slices:

- **Slice 3:** look the owner up (exists, not disabled, role) **before** `createCustomToken` — confirmed that skipping it silently creates Auth users.
- **Slice 3:** the client SDK logs every failed RPC to the console **including document paths and the request body**. Call `setLogLevel('silent')` (or `'error'` without bodies) in the function, so Cloud Logging never captures recipe content or ids.
- **Slice 1:** SDK types don't cross SDKs — an Admin write rejects the client `Timestamp` (and vice versa). The shared model must stay SDK-free (plain values); each path converts to its own SDK's types at the edge.
- **Slice 6:** real latency is only measurable on the test project — `createCustomToken` there signs through IAM (a network call) and sign-in goes through Identity Toolkit. Measure it as part of the end-to-end check.
- Not covered by the spike (by design): IAM Token Creator grant and API-key restrictions — slice 6.

### Slice 1 — Shared recipe-model module

**Done (2026-10-24).** `src/js/shared/recipe-model.js` (pure ESM, no imports, no SDK types) holds the model fields + `withModelFields`, categories, difficulties, the Storage folder layout, media types and size cap, image/media id + file-name + entry builders, `parseAmount`, and `normalizeRecipeContent` (API input: only `name` required; sent fields must be valid; unknown/server-owned fields rejected). The app's existing modules re-export from it — same exports, unchanged behaviour (965/965 existing tests still pass). `npm run sync:shared` writes the committed copy `functions/shared/recipe-model.mjs` (CommonJS functions load it with `await import()`); a unit test and the functions predeploy (`--check`) fail while it is stale. A drift-guard test fails if the app's recipe shape (`formatRecipeData`) gains a field the shared model doesn't classify.

Original scope:

- Extract the recipe shape into one module used by the app and the function: allowed fields, types, defaults (`withModelFields`), normalization (`formatRecipeData` logic), category ids, image entry `{id, full, fileName, isPrimary}` and media entry `{path, type, caption, order}` builders, file-name sanitizing.
- App switches to it with **no behaviour change** (existing tests stay green).
- Functions deploy only `functions/`: add a predeploy/build step that copies the module into `functions/`, plus a CI check that fails if the copy is stale.
- Tests: unknown and server-owned fields rejected (a caller's typo fails loudly), types validated, both ingredient/instruction formats.

### Slice 2 — Token store + dashboard management

- `api_tokens` collection, rules deny all client access (+ rules test).
- Callables (manager only): `createApiToken({ uid, name, scope })` → returns the secret once; `listApiTokens()`; `revokeApiToken({ tokenId })`. `createApiToken` refuses targets that aren't `approved`/`manager`.
- Dashboard section: list (user, name, scope, created by/at, last used, status), create dialog (pick user, name, scope; show-once secret with copy), revoke with confirm. Hebrew, RTL, existing dashboard components and tokens.
- Tests: callable auth/role guards, hash-only storage, revoke.

### Slice 3 — API skeleton: auth + user session + reads

- `recipeApi` `onRequest` function with a small router.
- Raise `functions/.eslintrc.js` `ecmaVersion` to ≥ 2020: loading the shared model needs dynamic `import()`, which the current 2018 setting fails to parse (slice 1 review).
- Auth pipeline (§2 steps 1–3, 5): token lookup, scope check, owner exists/enabled/role check, `lastUsedAt`, custom token, per-request client session, guaranteed teardown.
- Read endpoints: `GET /recipes/:id`, `/recipes/mine`, `/recipes`, `/categories`, using the same queries as `RecipeService` (queries must satisfy the rules — published filter, `authorId == me`).
- Error mapping (§3), `404` for not-visible.
- Tests on the emulators: each role, revoked token, demoted owner, deleted owner (must **not** recreate an Auth user), private recipe of another user → `404`, shared recipe readable by id.

### Slice 4 — Create (no media)

- `POST /recipes` with a JSON-only body (multipart arrives in slice 5; the parser is written to accept both).
- Shared model normalizes the recipe; server sets `authorId`, `visibility: 'private'`, `stage` (no `testedAt`, as in the app), `creationTime`, `createdVia`.
- `submit: true` → recipe + submission in one `writeBatch`.
- Caller-supplied `id` with a create-only precondition → retry-safe; existing own recipe → `200`, someone else's → `409`.
- Daily per-token cap.
- Tests: tried vs not tried, submit on/off, retry, plain-user token impossible, rules rejection surfaces as `403`, manager notification trigger fires on submit.

### Slice 5 — Media (images + media instructions)

- Multipart parsing (Cloud Functions body cap ~32 MB per request); per-file type/size checks matching `MediaInstructionService` and `storage.rules` (≤ 50 MB, image/video only).
- Upload as the user via `firebase/storage` to `recipes/{id}/images/…` and `recipes/{id}/media/…` with `uploadedBy` metadata, using the shared entry builders.
- Order: upload files → write the recipe batch; on any failure delete the uploaded files (same contract as `RecipeService.create`).
- Reads return resolved download URLs; the resize extension's WebP variants appear as for app uploads.
- Tests: primary image, mixed image/video media in order with captions, rejected type, oversize, failure mid-way leaves no orphan files.

### Slice 6 — Hardening, docs, rollout

- Docs: `docs/architecture/recipe-api.md` (contract, auth model, examples with `curl`), update `services.md` and `CLAUDE.md` further-reading.
- Sentry/logging for the function (no tokens or recipe content in logs).
- **Test project:** grant the function's service account _Service Account Token Creator_ on itself (needed for `createCustomToken`) — **needs explicit approval**; check the web API key's restrictions allow server-side `signInWithCustomToken` (or add a server key restricted to the Identity Toolkit API) — **needs explicit approval**.
- End-to-end on the test project with a real token: create tried/not-tried, with media, submit, all reads.
- **Production:** same IAM/API-key steps (approval again), deploy with `--project production`, create the first token from the dashboard, smoke test, release.

---

## 6. Edge cases (and where they're handled)

| Edge case                                                       | Handling                                                                                  | Slice |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----- |
| Token for a deleted user would silently recreate an Auth user   | look the user up before minting; missing/disabled → `401`; deleting a user revokes tokens | 3     |
| Demoted owner                                                   | role checked per request; rules also read the role live                                   | 3     |
| Concurrent users on one instance                                | per-request named client app; no module-level user state                                  | 0, 3  |
| Rules don't validate most fields                                | shared model allow-list + type checks; server sets owner/visibility/time fields           | 1, 4  |
| Agent retries create duplicates                                 | caller-supplied `id` + create-only precondition                                           | 4     |
| Queries rejected because they could return unreadable docs      | copy the app's queries; no "list shared with me" in v1                                    | 3     |
| Orphan files after a failed write                               | delete uploaded files on failure                                                          | 5     |
| Request too large for a function                                | `413`; large videos are the later two-step upload                                         | 5     |
| Leaked token                                                    | revoke in dashboard (next request fails); `createdVia` finds what it wrote                | 2, 4  |
| Token Creator grant lets the function mint a login for any user | uid comes only from the stored token record, never the request; small tested lookup       | 3, 6  |
| Each API call updates the user's Auth "last sign-in"            | accepted — the app doesn't use it                                                         | —     |

---

## 7. Later (not v1)

- Updates and deletes through the API.
- Large videos: reserve id → upload files one by one → post the recipe.
- Image by URL (server fetch with private-address blocking).
- User self-service tokens in the profile panel.
- Consumer side: a cookbook skill in the assistant agent (separate repo).
