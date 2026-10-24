# Recipe API

An HTTP API for reading recipes and adding new ones from outside the app — e.g. an assistant agent that turns a link into a recipe. It acts **as the token's owner**: everything it reads or writes goes through `firestore.rules` and `storage.rules`, exactly as in the app.

Design, decisions and slice history: [`docs/feature-plans/recipe-api.md`](../feature-plans/recipe-api.md). Code: `functions/api/` (exported as `recipeApi` from `functions/index.js`); the recipe shape and its rules: `src/js/shared/recipe-model.js`.

## At a glance

- **Who:** approved family and managers only. The role is checked on every request — a demotion cuts access at once.
- **Tokens:** personal, lifetime, at most 3 per user, scope `read` or `read+write`. Managers issue and revoke them in the dashboard (each user's expanded record). The secret is shown once; only its SHA-256 is stored.
- **Reads:** your own recipes, published ones, and ones shared with you — managers included (a leaked manager token must not expose every library).
- **Writes:** create only. Every recipe is private; you choose tried / not tried, and optionally send it for approval. No updates, deletes or publishing.
- **Limit:** 1,000 requests per token per UTC day (every authenticated request counts).

## Calling it

```
Base:  https://us-central1-<project>.cloudfunctions.net/recipeApi
Auth:  Authorization: Bearer ckb_…        (every request)
```

`<project>` is the Firebase project id (`.firebaserc`). All paths are under `/v1`. Responses are JSON and never cached (`Cache-Control: no-store`). Expect 1–3 s per call; the first call after a quiet period is slower (cold start).

Keep the token out of shell history and files:

```bash
read -rsp 'token: ' TOKEN; echo
API=https://us-central1-<project>.cloudfunctions.net/recipeApi
curl -s -H "Authorization: Bearer $TOKEN" "$API/v1/me"
```

## Endpoints

| Method & path          | Scope        | Returns                                                                           |
| ---------------------- | ------------ | --------------------------------------------------------------------------------- |
| `GET /v1/me`           | any          | `{ user: { name, role }, token: { name, scope } }`                                |
| `GET /v1/categories`   | any          | `{ categories: [{ id, label }] }` — the valid `category` ids, Hebrew labels       |
| `GET /v1/recipes/mine` | any          | `{ recipes: [summary] }` — your recipes, newest first; `?stage=to-try\|tested`    |
| `GET /v1/recipes`      | any          | `{ recipes: [summary] }` — published, newest first; `?category=<id>`, `?q=<name>` |
| `GET /v1/recipes/{id}` | any          | a full recipe, or `404` if it isn't yours, published or shared with you           |
| `POST /v1/recipes`     | `read+write` | creates a recipe (below)                                                          |

`q` matches part of the name, case-insensitively. A recipe you can't see answers `404`, the same as one that doesn't exist.

**Summary:** `{ id, name, category, stage, visibility, isMine, createdAt, path }`.

**Full recipe:**

```jsonc
{
  "id": "…",
  "path": "/recipe/…", // on the site
  "visibility": "private", // or "published"
  "stage": "to-try", // or "tested"
  "isMine": true,
  "createdAt": "2026-10-24T09:12:00.000Z",
  "updatedAt": null,
  "testedAt": null,
  "recipe": { … }, // the content, in exactly the shape POST accepts
  "images": [{ "id": "img-…", "isPrimary": true, "url": "https://…" }],
  "mediaInstructions": [{ "type": "video", "caption": "…", "url": "https://…" }], // in order
}
```

`url` is `null` for a file that is missing. URLs are long-lived, as in the app: one stays valid after the recipe stops being shared with you. The author's identity is never returned.

## Creating a recipe — `POST /v1/recipes`

```jsonc
{
  "id": "my-agent-7f3a91c2", // optional; 8–64 of A–Z a–z 0–9 _ - — makes retries safe
  "stage": "to-try", // "to-try" (default) or "tested"
  "submit": false, // true: also send it to the managers for approval
  "recipe": { … }, // see below
}
```

`201` → `{ id, path, stage, submitted, created: true, images, mediaInstructions }` (the last two are counts).

**Retries:** send your own `id`, and send the **identical body** again. The request is validated first, as always; then, if a recipe with that id is already yours, the answer is `200` with `created: false` and the same fields as above, describing the recipe as it is (its stage, whether it was submitted, its file counts). Nothing is changed or uploaded — a retry never edits a recipe. An id that belongs to someone else's recipe is `409`. So is a retry with `submit: true` for a recipe that was saved without it (send it for approval from the app).

### The recipe

The recipe must be **complete**, as the recipe form requires: `name`, `category`, `difficulty`, `prepTime`, `servings`, ingredients and instructions. Every field you send must be valid; unknown fields are errors (a typo fails loudly), and so are fields the server owns (`authorId`, `visibility`, `stage`, `images`, …).

| Field                                          | Type                                             | Rules                                                                              |
| ---------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `name`                                         | string                                           | required                                                                           |
| `category`                                     | string                                           | required; an id from `GET /v1/categories`                                          |
| `difficulty`                                   | string                                           | required; `"קלה"`, `"בינונית"` or `"קשה"`                                          |
| `prepTime`                                     | whole minutes                                    | required; 1–100,000                                                                |
| `waitTime`                                     | whole minutes                                    | 0–100,000                                                                          |
| `servings`                                     | whole number                                     | required; 1–10,000                                                                 |
| `servingsUnit`                                 | string                                           | e.g. `"עוגיות"`                                                                    |
| `ingredients`                                  | `[{ item, amount?, unit? }]`                     | **or** `ingredientSections` — one of them is required, never both                  |
| `ingredientSections`                           | `[{ title, items: [{ item, amount?, unit? }] }]` | at least 2 sections, each with a title and items (for one list, use the flat form) |
| `instructions`                                 | `["step", …]`                                    | **or** `stages` — one of them is required, never both                              |
| `stages`                                       | `[{ title, instructions: ["step", …] }]`         | at least 2 stages, each with a title and steps                                     |
| `description`, `attribution`, `mainIngredient` | string                                           | `attribution` is who the recipe is from                                            |
| `tags`                                         | `["…"]`                                          | no commas inside a tag                                                             |
| `comments`                                     | `["…"]`                                          |                                                                                    |
| `relatedRecipes`                               | `["recipe-id", …]`                               | published recipes only, no repeats, at most 4, never the recipe itself             |

Ingredient `amount` is a positive number under 1,000,000 or a common fraction — `2`, `0.5`, `"1/2"`, `"1½"` (stored as a number). Put ranges and "to taste" in `item`. Strings are trimmed; empty rows are dropped, and `null` or an empty list counts as leaving the field out (so a required field sent as `null` is reported as missing). Text length and list sizes are not limited; a stored recipe must stay under ~900 KB.

### Photos and step media

Send `multipart/form-data` instead of JSON: the same JSON in a part named **`request`**, plus one file part per file. The JSON names the parts:

```jsonc
{
  "recipe": { … },
  "images": [{ "part": "photo1", "isPrimary": true }, { "part": "photo2" }],
  "mediaInstructions": [{ "part": "step1", "caption": "ללוש עד שהבצק חלק" }], // display order
}
```

- **Photos:** JPEG, PNG or WebP, up to 5 MB each, at most 5, exactly one primary (the first, unless you mark one). Thumbnails are made automatically, as for the app's uploads.
- **Step media:** JPEG, PNG, WebP, GIF, MP4, WebM or QuickTime, up to 50 MB each, optional caption.
- One request carries at most **30 MB** and 30 files. Larger videos aren't supported yet.
- `images` / `mediaInstructions` in a plain JSON body are refused (`400 bad-request`): files need multipart.
- Each file's bytes must match its declared type, and every file part must be named by an entry (and vice versa).

Everything is checked before anything is stored; if the write then fails, the uploaded files are removed.

## Errors

```json
{
  "error": {
    "code": "incomplete-recipe",
    "message": "…",
    "details": [{ "field": "servings", "message": "is required" }]
  }
}
```

`details` comes with the 400s you can fix field by field. Branch on `code`, not `message`.

Errors raised by the platform before the API runs are **not** in this shape: a body declared as JSON that doesn't parse gets a plain `400` HTML page, and a body over 32 MB gets the platform's `413`. Treat any non-JSON error response as `bad-request` / `payload-too-large`.

| Status | `code`                                                                    | Meaning                                                                          |
| ------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 400    | `invalid-recipe`, `incomplete-recipe`, `invalid-request`, `invalid-files` | fix the listed fields                                                            |
| 400    | `recipe-too-large`                                                        | the stored recipe would be too big                                               |
| 400    | `bad-request`                                                             | malformed body or option (see `message`)                                         |
| 401    | `unauthorized`                                                            | missing, malformed or revoked token; the owner's account is gone or disabled     |
| 403    | `forbidden`                                                               | the token lacks the scope, the owner is no longer approved, or the rules refused |
| 404    | `not-found`                                                               | unknown endpoint, or a recipe you can't see                                      |
| 405    | `method-not-allowed`                                                      |                                                                                  |
| 409    | `conflict`                                                                | the id is someone else's, or a retry that asks to submit (above)                 |
| 413    | `payload-too-large`                                                       | JSON over 1 MB, or multipart over 30 MB                                          |
| 415    | `unsupported-media-type`                                                  | send `application/json` or `multipart/form-data`                                 |
| 429    | `rate-limited`                                                            | the token's daily limit is reached; resets at 00:00 UTC                          |
| 503    | `unavailable`                                                             | too many simultaneous changes; retry                                             |
| 500    | `internal`                                                                | retry later (with the same `id`, a retry is safe)                                |

## Examples

```bash
# Published desserts whose name contains "עוגה"
curl -s -G -H "Authorization: Bearer $TOKEN" "$API/v1/recipes" \
  --data-urlencode category=desserts --data-urlencode q=עוגה

# Create (JSON)
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "$API/v1/recipes" -d @- <<'EOF'
{
  "id": "agent-shakshuka-01",
  "stage": "to-try",
  "recipe": {
    "name": "שקשוקה",
    "category": "breakfast-brunch",
    "difficulty": "קלה",
    "prepTime": 25,
    "servings": 4,
    "attribution": "https://example.com/shakshuka",
    "ingredients": [
      { "item": "ביצים", "amount": 6 },
      { "item": "רסק עגבניות", "amount": "1/2", "unit": "כוס" }
    ],
    "instructions": ["לטגן בצל ופלפל", "להוסיף עגבניות ולבשל", "לשבור ביצים ולכסות"]
  }
}
EOF

# Create with a photo and a step video (multipart). request.json holds the JSON body plus
# "images": [{ "part": "photo" }], "mediaInstructions": [{ "part": "clip", "caption": "ללוש" }]
curl -s -H "Authorization: Bearer $TOKEN" "$API/v1/recipes" \
  -F 'request=<request.json;type=application/json' \
  -F 'photo=@focaccia.jpg;type=image/jpeg' \
  -F 'clip=@kneading.mp4;type=video/mp4'
```

## Operations

- **Revoking:** dashboard → the user's record → revoke. The token stops working on its next request.
- **What did a token write?** API recipes carry a hidden `createdVia: { kind: 'api', tokenId }` (query `recipes` by `createdVia.tokenId`).
- **Logs:** the function logs only the route and an error code for 500s — never tokens, recipe content or paths — and the client SDK's own logging (Firebase and Firestore loggers) is silenced. The platform's request log (Cloud Logging, service `recipeapi`) records each request's method, URL and status, so query strings such as `?q=` appear there; never put a token in a URL.
- **Deploy prerequisites (per project, once):** the runtime service account needs _Service Account Token Creator_ on itself (to mint the owner's login), and the secret `WEB_API_KEY` must hold the project's web API key. The key's API restrictions must allow Identity Toolkit, Secure Token, Firestore and Firebase Storage (Firebase's auto-created browser key does), with no HTTP-referrer restriction.
- **Local:** `npm run dev:emulators` runs the API in the Functions emulator; `npm run test:functions` runs its integration tests.
- **Known gaps:** files can be orphaned by a crash mid-upload (#435); incomplete private recipes aren't possible yet (#434).
