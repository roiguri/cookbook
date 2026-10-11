# Feature Plan: Private recipes, To try, and collections (data-model migration)

## Context

Today every recipe lives in one shared `recipes` collection and "published" is a single `approved` flag that **only the UI respects**: `firestore.rules` lets anyone read every recipe (`allow read: if true`), authors can set `approved: true` on their own recipes, favourites and My Meal accept any recipe id, and any signed-in user can delete any recipe image in Storage.

This plan moves to the usual recipe-app shape: every recipe has an **author** and a **visibility** (the single source of truth for "published"), submissions to the family book go through a **`recipe_submissions`** approval queue (the same pattern as edit suggestions), and favourites become one personal collection among many. A "staging area" stops being a special feature — a private recipe in your own library _is_ the staging area. Untested recipes you collect sit on a **To try** shelf until you've cooked them.

Lifecycle of a recipe:

```
To try ──mark tested──▶ My library ──submit──▶ Pending review ──approve──▶ Published (the same recipe, now in the family book)
  ▲                          ▲                       │
  │                          └──rejected or withdrawn┘
  └──────────── fork (your own untested copy) ◀───────────────────────────────── Published
```

Working copy of this plan with diagrams (Claude Doc): https://claude.ai/code/artifact/aa483997-e385-4eb0-90ca-34854a0ccff9 — **this file is the source of truth**; update it as releases ship.

## Decisions (settled 2026-10-10)

| Decision                                       | Decided                                                                                                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who can create private recipes                 | Approved family and managers only (sign-up is open to any Google account; one rule condition to widen)                                                                                               |
| Own private recipes in collections and My Meal | Always allowed for the author                                                                                                                                                                        |
| What publishing does                           | **In place** (changed from copy, 2026-10-11): the recipe itself becomes published and stays in its author's library (badge "פורסם"); one recipe, no duplicates in favourites / collections / My meal |
| Editing your own published recipe              | Through edit suggestions, like everyone else                                                                                                                                                         |
| Managers and private recipes                   | Readable by managers, not listed in the dashboard                                                                                                                                                    |
| Untested recipes you collect                   | A `stage` field on your own recipes (`to-try` / `tested`), **not** a collection                                                                                                                      |
| Submitting an untested recipe                  | Allowed; the Submit button warns                                                                                                                                                                     |
| Deploy ordering                                | Nobody uses the app during a deploy window → no dual-write; each release is one back-to-back window                                                                                                  |
| Family book model (reviewed 2026-10-11)        | **Not a collection.** `visibility` on the recipe + a `recipe_submissions` queue; collections are personal only                                                                                       |
| Approval before release 3b                     | In place — and it stays that way (see "What publishing does")                                                                                                                                        |
| Recipes with no recorded author                | `authorId: null` — never anyone's recipe; only managers edit them                                                                                                                                    |
| Resubmitting a recipe that's already published | Not possible — a published recipe changes through edit suggestions, its author included                                                                                                              |
| Pending submissions per recipe                 | At most one (submission doc id = the private recipe's id)                                                                                                                                            |

## Target model

| Path                                | Key fields                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recipes/{id}`                      | `authorId`, `visibility` (`private` \| `published`), `stage` (`to-try` \| `tested`), `testedAt`, `forkedFrom`, content as today                                                                                  |
| `recipe_submissions/{recipeId}`     | `recipeId` (the private original), `authorId`, `status` (`pending` \| `approved` \| `rejected`), `reviewedBy`, `reviewedAt`, `note`/`rejectionReason`, `createdAt` (`publishedId` unused since publish-in-place) |
| `collections/{id}`                  | `ownerId`, `name`, `kind` (`favorites` \| `personal`; a curated `book` kind can be added later if ever needed)                                                                                                   |
| `collections/{id}/items/{recipeId}` | `addedBy`, `addedAt`                                                                                                                                                                                             |
| `recipes/{id}/notes/{uid}`          | per-user `text`, `rating`, `cookLog` — later phase                                                                                                                                                               |
| `recipe_edit_suggestions/{id}`      | unchanged                                                                                                                                                                                                        |
| `users/{uid}`                       | `role`, profile, tokens — `favorites` moves to a collection                                                                                                                                                      |
| `active_meals/{uid}`                | unchanged for now                                                                                                                                                                                                |
| Storage `img/recipes/…`             | files stay where they are on approval; authors may change their recipe's files only while it is private (3b)                                                                                                     |

Access rules (enforced in `firestore.rules` / `storage.rules`, not only the UI): published recipes are public; private recipes are readable by their author and managers; only approved family and managers create private recipes; non-managers can never change `visibility`, `authorId`, `stage` or `sourceRecipeId`, nor a submission's `status` beyond `pending`; while both exist, `approved` and `visibility` must agree; the author is `authorId`, falling back to the legacy `userId`; a collection item may only point at a recipe its owner can read.

## Releases

| #   | Release                     | Data                                                                                                                                           | UI                                                                                             | State                                       |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 0   | Prep: prod → test data copy | Test project replaced with a copy of production (`scripts/migrations/000-copy-prod-to-test.sh`)                                                | —                                                                                              | ✅ 2026-10-10                               |
| 1   | Lock down security          | None. Rules tests (emulator) + tightened Firestore/Storage rules; every recipe query filters published                                         | "Recipe not found" state                                                                       | ✅ 2026-10-11 (PRs #332, #333)              |
| 2   | Convert the data model      | Script adds `authorId`, `visibility`, `stage: tested`; creates a `recipe_submissions` doc per open proposal. Old fields kept and still written | None                                                                                           | ✅ staging 2026-10-11 (PR #336) — prod held |
| 2b  | Restructure Storage         | Script copies every recipe file to `recipes/{id}/images                                                                                        | media/`, rewrites paths in recipes and edit suggestions. Old files kept                        | None                                        | ✅ staging 2026-10-11 (PR #340) — prod held |
| 3a  | Private recipes and To try  | New private recipes (no publishing yet)                                                                                                        | My recipes (To try / My library tabs), Mark as tested, Save privately, private/to-try badges   | ⬜ needs design                             |
| 3b  | Submissions and publishing  | Submissions; approval publishes in place, reject keeps the recipe with a note; authorless recipes get an author (`004`)                        | Submit to the family book, pending/rejected/published badges, dashboard queue with reject note | ⬜ needs design                             |
| 4   | Collections                 | Script copies `users.favorites` into a favourites collection. Old list kept                                                                    | Favourite button unchanged; add to collection; collections view                                | ⬜ needs design                             |
| 5   | Clean up                    | Script deletes `approved`, `userId`, `users.favorites`, `pendingImages`; removes orphaned proposal images                                      | None                                                                                           | ⬜ after 2–4 settle                         |

Later, each purely additive: personal notes and "made it" log, forks, meal plans, shopping lists.

### Release 2 — Convert the data model (on staging)

**Production rollout is held until the whole feature (releases 2–4) is complete and fully tested** (user decision 2026-10-11); releases ship to `staging` + the test project only, then roll out to production together.

Rehearsed and tested on staging 2026-10-11: fresh production copy → indexes → `002-convert-model.mjs --apply` (62 recipes converted, 7 submissions created, re-run is a no-op, no approved/visibility mismatches) → rules, storage rules and functions (`onRecipeSubmitted` created, `onRecipeCreated` removed). User-tested: approve, propose, reject, categories, suggest-edit approval, author reading their own proposal, related recipes, dashboard lists, manager push notification. Note: pending recipes have no "edit" action in the dashboard, so publishing only happens through approval.

Reviewed by an independent agent on 2026-10-11; its findings are folded in here.

1. **Data script** `scripts/migrations/002-convert-model.js` (admin SDK, `--project` required, dry run unless `--apply`, idempotent):
   - every recipe: `authorId` = `userId` or `null`; `visibility` = `approved ? 'published' : 'private'`; `stage: 'tested'`;
   - every recipe with `approved: false` (an open proposal): a `recipe_submissions/{recipeId}` doc with `status: 'pending'`.
2. **App:** every list reads `visibility == 'published'` instead of `approved == true` (home, categories, header search, related picker, image enhancer, dashboard "all recipes" — managers can read private recipes, so it must filter too); the related-recipes self-heal validates with `visibility`. Proposing writes `authorId`, `visibility: 'private'`, `stage`, keeps writing `userId`/`approved`, and creates the pending submission. The dashboard queue reads pending submissions; approving updates the recipe (`visibility` + `approved`) and the submission together; rejecting updates the submission.
3. **Rules:** recipe read/create/update on `visibility` + author (`authorId`, falling back to `userId`); create requires approved family or manager, `visibility: 'private'`, a valid `stage`; immutable `visibility`/`authorId`/`stage`/`sourceRecipeId` for non-managers; `approved` and `visibility` must agree. `recipe_submissions`: create by the author as `pending`, manager-only update, author withdraws while pending, read by author and managers. `storage.rules` `isRecipeAuthor` reads `authorId` with the `userId` fallback. Rules tests for all of it.
   _Proposals stay open to every signed-in user (role `user` included), as before: in release 2 every private recipe is a proposal. From 3a, creating a private recipe **without** submitting it is limited to approved family (rules can check the submission written in the same batch with `getAfter`)._
4. **Functions:** the new-proposal notification moves from `onRecipeCreated` (fires on `approved === false`) to `onDocumentCreated('recipe_submissions/{id}')`, otherwise managers would be pinged for every private draft. `recipe-transfer.js` writes the new fields (it is gated; delete it in release 5).
5. **Indexes:** add composite indexes for the new queries to `firestore.indexes.json` in the same release (a missing index only fails at runtime).
6. **Rollout:** refresh the test copy from production → rehearse the script (dry run, apply) → deploy → staging test. Production window: **backup → deploy indexes (let them build) → run the script (additive, safe with the old site) → merge `main`, wait for Netlify → deploy rules + functions → smoke test.**

### Release 2b — Restructure Storage (decided 2026-10-11)

Decision: **full restructure** to one folder per recipe, plus a private per-user area and a staging area for suggestion uploads. Privacy model: private material lives under `users/{uid}/…`, readable only by its owner and managers; download URLs still work for whoever has one, but you only get a URL if the rules allow the read (accepted trade-off for a family app).

| Today                                                                                              | New layout                                                                          |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `img/recipes/full/{category}/{recipeId}/{file}` + resized `_400x400` / `_1080x1080` WebP beside it | `recipes/{recipeId}/images/{file}` (+ resized beside it)                            |
| `img/recipes/full/{category}/{file}` (26 legacy files, no recipe folder)                           | `recipes/{recipeId}/images/{file}` — matched to their recipe through its `images[]` |
| `recipes/{recipeId}/media-instructions/{file}`                                                     | `recipes/{recipeId}/media/{file}`                                                   |
| Edit-suggestion uploads land in the live recipe's folder                                           | `suggestions/{suggestionId}/images                                                  | media/{file}`; copied into the recipe's folder on approval |
| —                                                                                                  | `users/{uid}/recipes/{recipeId}/images                                              | media/…` — private recipes (3a)                            |
| `Avatars/`, `documents/`, `grandmas_cookbook/`                                                     | unchanged (out of scope)                                                            |

Why: the category in the path forces file moves on every category change (the migration can fail half way); a recipe's files are split across two trees; unapproved uploads touch live recipes; there is no private area. With one folder per recipe, copying (3b's publish-as-copy) and deleting are single-prefix operations.

1. **Code:** path helpers for the new layout; uploads write there; **category changes no longer move files**; edit suggestions upload to `suggestions/{id}/`; approving a suggestion copies its files into the recipe's folder through a **Cloud Function** (admin SDK, idempotent) — the same mechanism 3b's approve-as-copy reuses.
2. **Rules** (`storage.rules`): `recipes/{recipeId}/**` public read, writes as today (tagged uploads; manager / uploader / recipe author); `suggestions/{id}/**` read and delete by the uploader and managers; `users/{uid}/**` read/write by the owner, read by managers. Old paths stay manager-write until cleanup. Rules tests for all of it.
3. **Script** `003-restructure-storage.mjs` (requires `002` to have run): copies each recipe's images (with their resized variants) and media to the new layout, then rewrites the paths in `recipes` (`images[].full`, media paths) and in `recipe_edit_suggestions` (`storagePaths`, image references). Dry run unless `--apply`; idempotent; **copies, never deletes**.
4. **Resize extension:** add the new image folders to its watched paths (`INCLUDE_PATH_LIST`), keeping the old one until cleanup. This is a configuration change on each project — it's in the runbook.
5. **Cleanup (release 5):** delete the old `img/recipes/**` and `recipes/*/media-instructions/**` trees once nothing references them.

Decided while building (2026-10-11):

- **Unique file names for every upload** (no more `primary.jpg`): an upload never overwrites an existing file, so only managers need overwrite rights (AI enhancer, photo replacement). Which image is primary is the `isPrimary` flag.
- **Copies are re-tagged:** approved suggestion files are tagged as uploaded by the approving manager, and `003` drops a copied file's `uploadedBy` tag when it isn't the recipe's author — a suggester never keeps delete rights over a live recipe's files.
- **Orphan photos aren't copied:** the test copy of production holds 126 original photos but recipes reference only 56; the rest (deleted or failed proposals) stay in the old tree and go with the cleanup release.
- Dry run on the test copy of production: 53 of 62 recipes repointed (56 photos, 4 media files), 280 files copied with variants and backups, 1 edit suggestion repointed, no missing files.

#### Release 2b — staging results (2026-10-11)

All 8 cases passed on staging, checked against Firestore and Storage after each step: propose with photos and a step photo (unique names in `recipes/{id}/…`, tagged, thumbnails, pending submission, nothing in the old tree); approve; suggest an edit with files (staged in `suggestions/{id}/`, recipe untouched); approve the suggestion (copied, re-tagged to the manager, staged files deleted); reject a suggestion; manager edit — category change with no file moves, primary flag moved, removed photo and thumbnails deleted; AI enhancer (replaced in place, `_original` backup; after the Gemini top-up); delete (whole folder emptied). Leftover: deleting a recipe leaves its `recipe_submissions` record — handle in 3b.

### Release 3a — Private recipes and To try (plan, 2026-10-11)

Designs: the "Release 3 · My recipes", "Card badges", "My private recipe" and "New recipe" rows of the Cookbook screens canvas. **Principle: no parallel implementations** — My recipes behaves exactly like Categories, a private recipe page is the normal recipe page, and every status/badge/action is one implementation used everywhere. **Reuse wins over pixel-matching the mock:** where a design differs slightly from what an existing component already does (spacing, wording of a shared control, markup), keep the existing component as it is and adapt the design, rather than forking the component (user decision 2026-10-11).

**Scope.** In 3a: the _To try_ and _My library_ tabs, the new-recipe save choice, the private recipe page with its owner menu (mark tested, edit, add to meal, delete), card status badges, the header entry. Not in 3a: the _Submitted_ tab, pending/rejected states and notes, the dashboard queue redesign and approve-as-copy (3b); the _Collections_ tab (release 4) — hidden until then. "The whole family" in the save choice submits through the existing `recipe_submissions` queue (approval still publishes in place until 3b).

**Reuse map**

| Design element                                                                                                                         | Built on (existing)                                                                         | Change                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| My recipes list: search, "more filters", category chips, grid, pagination, favourites                                                  | `categories-page.js` + `unified-recipe-filter` + `recipe-presentation-grid` + `recipe-card` | **Extract** the list behaviour now inside `categories-page.js` (~600 lines: search, category, filters, pagination, favourites events) into a shared list controller with an injected data source. Categories uses `listPublished(category)`, My recipes uses `listMine({ stage })`. Same component tree and markup. |
| Tabs (לנסות / הספרייה שלי) + "מתכון חדש"                                                                                               | header-nav pill style                                                                       | New page shell `my-recipes-page.js` (`/my-recipes?tab=…`), styles from the design's `.mr-*` rules, tokens only.                                                                                                                                                                                                     |
| Status badge on cards and on the recipe page (`.status-badge--to-try` / `--private`, later `--pending` / `--rejected` / `--published`) | `badges.css`                                                                                | **One** status-badge style in the design system, and **one** helper that derives the status from a recipe (`stage` + `visibility`, later the submission) — used by the card and the recipe page.                                                                                                                    |
| "סימון כנבדק" on To-try cards                                                                                                          | `recipe-card` options pattern (`show-add-to-meal`)                                          | New card option `show-mark-tested`, forwarded by the grid like `show-add-to-meal`; the card fires `recipe-mark-tested`.                                                                                                                                                                                             |
| Mark tested (card button and recipe menu)                                                                                              | `RecipeService`                                                                             | **One** service method `RecipeService.markTested(id)` (`stage: tested`, `testedAt`).                                                                                                                                                                                                                                |
| Private recipe page + owner menu (status block, mark tested, edit, add to meal, delete)                                                | `/recipe/:id`, `recipe-detail-page.js` menu, `recipe-component`                             | The existing ⋮ menu gains owner items when the reader is the author of a private recipe; existing "add to meal" reused; status badge shown by `recipe-component` from the shared helper.                                                                                                                            |
| Delete confirmation                                                                                                                    | `confirmation-modal` + `RecipeService.delete`                                               | Rules: an author may delete their own **private** recipe.                                                                                                                                                                                                                                                           |
| Edit own recipe                                                                                                                        | `/propose-recipe` + `recipe-form-component.setRecipeData(id)`                               | Propose page gets an edit mode (`?edit=<id>`), same form, saves via `RecipeService.update`.                                                                                                                                                                                                                         |
| New recipe: save choice (cooked? · who sees?) + untested warning                                                                       | `confirmation-modal`, propose page, `recipe-import-modal`                                   | The save step opens the choice; the import sets the default to "not cooked" and shows the design's alert. "Family" = save private + `RecipeSubmissionService.submit`.                                                                                                                                               |
| Header entry "המתכונים שלי"                                                                                                            | `auth-controller.updateNavigation` role tabs                                                | Added for approved family and managers, like "המטעמים של סבתא".                                                                                                                                                                                                                                                     |
| Empty state                                                                                                                            | `.mr-empty` design                                                                          | Shared by both tabs, copy per tab.                                                                                                                                                                                                                                                                                  |

**Data and rules**

- `RecipeService.listMine({ stage })`: `authorId == uid` and `visibility == 'private'` (+ `stage`), newest first — composite index added to `firestore.indexes.json`.
- Rules: creating a private recipe that isn't submitted in the same batch becomes **approved family / managers only** (`getAfter` on the submission); role `user` keeps proposing (create + submit). Authors may **delete** their own private recipes. Marking tested is an author update of `stage` (already allowed).
- Files of private recipes stay in `recipes/{id}/…` in 3a (privacy model as decided in 2b); with publish-in-place (3b) a recipe keeps its files when published, so the `users/{uid}/…` area stays unused for recipes.

**3a-B notes.** No rules or index changes were needed: the existing read rule already allows the author's query (`authorId == uid && visibility == 'private'`, emulator-tested), and `listMine` uses equality filters only, sorting newest-first in code — one query feeds both tabs and their counts; category is filtered in code. In 3a the library also lists recipes awaiting approval (pending/rejected badges come with 3b).

**3a-C notes.** Same `/propose-recipe` page and `propose-recipe-component` for everyone: approved family/managers see "מתכון חדש" and the save choice (built on `confirmation-modal`, which gained an optional body); plain users keep the proposal flow unchanged. A submitted recipe and its `recipe_submissions` record are written **in one batch** (`RecipeService.create({ alsoWrite })`). Rule: creating a private recipe that isn't submitted in the same batch requires approved/manager. Until 3b, approval still publishes in place, so an approved recipe leaves My recipes.

**3a-E notes.** "עריכה" in the owner menu opens the manager dashboard's editor (`edit-preview-recipe` → `edit-recipe-component`, with preview) instead of the propose page in the design — reuse over the mock. Publishing on save is now explicit: the dashboard sets `approve-on-save`; an author's save keeps the recipe private. No rules change (authors could already update their private recipe and its files).

**Decisions (2026-10-11)**

1. Role `user` gets no My recipes (no header entry, no page); they keep proposing as today.
2. Editing your own recipe is its **own slice** (3a-E), after the rest of 3a.
3. Extracting the Categories list behaviour is accepted; covered by controller unit tests and a staging regression pass on Categories.

**Slices** (each: branch → PR → `development` → `staging` → staging test with the inspector; production held)

| Slice | What                                                                                                                                                      | Status                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 3a-A  | Extract the Categories list behaviour into a shared list controller — **no visible change**                                                               | ✅ staging                 |
| 3a-B  | My recipes page: tabs (To try / My library), `listMine`, card status badges, empty state, header entry; index + read rules for own private recipes        | ✅ staging                 |
| 3a-C  | New recipe save choice (cooked? · who sees?), import → To try, untested warning; rule: unsubmitted private recipes are approved-family only               | ✅ staging (tested)        |
| 3a-D  | Private recipe page: owner ⋮ menu (status, mark tested, add to meal, delete) and the card's "mark tested"; rule: authors delete their own private recipes | ✅ staging (tested)        |
| 3a-E  | Edit own recipe (propose page edit mode)                                                                                                                  | ✅ staging (awaiting test) |

### Release 3b — Family-book submissions (plan, 2026-10-11)

Designs: "Release 3 · Family-book submissions (manager)" (Dashboard-queue / -review / -reject / -approved), "My private recipe" pending + rejected, and "My recipes · Submitted". Same principles as 3a: **one implementation per status/action, reuse over pixel-matching the mock.**

**Publish in place (decided 2026-10-11, replacing copy-on-publish).** A copy would give the author the recipe twice (their original + the book's copy) — favourites, collections and My meal would point at one or the other, and the two would drift apart. Instead the approved recipe itself becomes published and stays in its author's library with a "פורסם" badge. After publishing, everyone — the author included — changes it through edit suggestions; only managers delete it. The design's copy wording ("עותק", "המקור הפרטי לא משתנה") is adapted accordingly.

**What changes for the user**

- **Approve** publishes the recipe (as today); the stage stays the author's (a published "to try" recipe stays in their To try).
- **Reject = a note, not a delete.** The manager must write what to fix; the recipe stays private. The author sees the note on the recipe page, and can edit and **resubmit** (the queue marks it "הגשה חוזרת").
- **The author controls the submission:** "שליחה לפרסום" from the recipe menu (a private recipe not yet submitted), "ביטול השליחה" while pending, "הסרה מהרשימה" for a rejected one. A pending recipe can still be edited — the manager reviews the latest version.
- **My recipes = everything I authored:** library (tested) and To try (to-try) include published recipes, with a "פורסם" badge there (not on Categories cards). Recipes with no recorded author get one via `004-backfill-author.mjs` (on production: the manager's account).
- **Badges:** pending / rejected / published join to-try / private — on cards, the recipe page and the owner menu (status line + note).
- **Dashboard queue** (existing list and preview dialog): per-row "עוד לא נוסה" and "הגשה חוזרת" flags, reject with a required note, a short "פורסם בספר" confirmation after approving.

**Side effects found in review (2026-10-11)**

- **Storage:** authors could replace/delete files of any recipe they wrote, published included (since 2b) — bypassing edit suggestions. Fixed in 3b-A: author file changes only while the recipe is private.
- **Rules:** an author may change only `stage`/`testedAt` of their published recipe (mark tested).
- **`listMine`** drops its `visibility == private` filter (all my recipes; rules already allow `authorId == uid`).
- **Owner menu on my published recipe:** status "פורסם", mark tested (if to try), add to meal, suggest edit — no edit or delete.
- **Unused copy fields** (`sourceRecipeId` checks in the rules, `publishedId`): harmless; removed in the cleanup release.

**Reuse map**

| Design element                               | Built on                                                      | Change                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Approve                                      | `RecipeSubmissionService.approve` (in place, already)         | Unchanged; confirmation dialog after approving.                                                             |
| Reject with note, resubmit, withdraw, remove | `RecipeSubmissionService`, `confirmation-modal` (with a body) | `reject(id, { note })` keeps the recipe; `resubmit`, `withdraw`, `remove`.                                  |
| Status on cards / page / menu                | `getRecipeStatus`, `<status-badge>`, owner menu               | Status takes the submission and authorship into account; lists attach the author's submissions (one query). |
| Review dialog                                | `recipe-preview-modal` (already has approve / reject)         | "עוד לא נוסה" banner, reject → note.                                                                        |

**Slices** (each: PR → `development`; `staging` pushed when there's something to test)

| Slice | What                                                                                                                                                                                                          | Status                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 3b-A  | Rules + services: reject with note (recipe kept), resubmit / withdraw / remove by the author, author stage change on published, Storage author-files-while-private; `004-backfill-author.mjs`; emulator tests | ✅ staging (awaiting test) |
| 3b-B  | My recipes includes published; statuses pending / rejected / published on cards, page, owner menu (send, cancel, resubmit, note)                                                                              | ✅ staging (awaiting test) |
| 3b-D  | Dashboard: queue flags, reject note, approved confirmation                                                                                                                                                    | ✅ staging (awaiting test) |
| 3b-E  | Cleanup: deleting a recipe removes its submission (author and dashboard); queue self-heal updated                                                                                                             | ✅ staging (awaiting test) |

**3b-A notes.** Rules: managers' rejections must carry a note; the author may resubmit a rejected submission (only `status` → pending and a server-stamped `resubmittedAt`) and delete a pending or rejected one (an approved one stays); on their published recipe the author may change only `stage`/`testedAt`; Storage: authors and uploaders change a recipe's files only while it isn't published (legacy `approved` counts). Services: `reject({ note })` keeps the recipe; `discard` deletes a plain user's proposal (submit and forget — they'd never see a note); `cancel`, `resubmit`, `listForAuthor`; `listMine` returns published recipes too. Until 3b-D the dashboard's reject still discards. 64 rules tests; the 5 new ones fail on the old rules.

**Decisions (2026-10-11)**

1. **Credit** stays internal (`authorId`); no author name on the published recipe for now.
2. **No "נשלחו לפרסום" tab.** Every submitted recipe already lives in My library or To try; its status shows as a badge on the card, and the note and actions (resubmit, cancel) are in the recipe page's ⋮ menu (the "My private recipe" pending / rejected designs). A "rejected only" filter can be added later under "עוד מסננים". Slice 3b-C dropped.
3. **Plain users** keep "submit and forget" — no view of their submissions.

### Release 3c — "הספרייה שלי": one library (plan, 2026-10-11)

**Why.** With My recipes, favourites and (later) collections, "where are the recipes I care about?" had four answers and the nav kept growing. Recipe apps keep **two places**: discover (the family book) and **my library** (everything that's mine — written or saved), with collections as one more lens inside the library. Layout options were mocked (phone A–D + desktop) on a temporary canvas: https://claude.ai/artifact/2SNzQHvWGxZfpT1zFFAmx4 — **option B** chosen.

**Decisions (2026-10-11)**

- The page is **"הספרייה שלי"** (route stays `/my-recipes`). One list — the same list behaviour as Categories (`RecipeListController`, filter band, grid, cards) — with **scope chips** instead of tabs: **הכל · המתכונים שלי · שמרתי · לנסות** (`?view=`), each with a count. **הכל** (default) = my recipes + the recipes I saved, without duplicates.
- **No data-model change.** "שמרתי" = today's favourites (the heart); "לנסות" stays a stage of my own recipes (a "to try" mark for saved family recipes is **not** decided — see the collections issue).
- **Plain users get the page too**, with "שמרתי" only (no chips row, no new-recipe button). Approved family and managers get all four chips.
- **Nav:** "המתכונים שלי" → **"הספרייה שלי"** for every signed-in user; the **"מועדפים"** item goes (its view is "שמרתי"; Categories keeps its "show only favourites" filter); **"מתכון חדש"** leaves the nav for approved family — the button lives in the library head. Plain users and signed-out visitors keep "הצעת מתכון".
- Phone: the category row stays the shared filter component (reuse over the mock's dropdown).
- **Collections:** mocked later and tracked in a GitHub issue — the plan is a fifth chip "אוספים" showing collection covers, each collection opening this same layout.

**Status:** ✅ built, on staging (awaiting test). **Build (one slice):** saved recipes load by id from the favourites list (tolerating removed / unreadable ones); scope state in the URL; counts; per-chip empty states; badges as today (own view; saved family recipes carry none); nav changes in `auth-controller`; plain-user access to the page.

### Notes for releases 3–4 (from the review)

- **Stage is the author's alone (decided 2026-10-11).** Submitting, approval and publishing never change the private original's `stage`: a "to try" recipe can be submitted (the save choice warns, but allows it), and stays in the author's To try tab — with its pending/published badge — until the author marks it tested.

- ~~3b approval copy / copy-on-publish changes the recipe id~~ — superseded: publishing is in place (2026-10-11), so ids and links don't change.
- **Missing recipes:** favourites, My Meal and related links can point at deleted or now-unreadable recipes — load recipes one by one (never one `in` query over mixed ids), tolerate not-found, show a "removed" state.
- **Search:** authors will want their own private recipes too — a second query (`authorId == uid`) merged client-side (rules can't express OR).
- **Release 4 favourites:** stale open tabs may still write `users.favorites` after the script; have the new client read both, and re-run the idempotent copy right before release 5.

### Cleanup backlog (release 5 — don't forget)

- **Retired "Suggest images" flow** (removed from the recipe menu in release 1; image changes go through "Suggest an edit"). Delete `RecipeImageProposalService`, `image-proposal-modal`, the dashboard "pending images" section and its approval modal (`image-approval-multi`) if nothing else uses it, the `pendingImages` field on recipes and the `allowImageSuggestions` flag, and any rules that mention them.
- **Missing thumbnails in production:** ~12 recipes have no `_400x400` / `_1080x1080` WebP variants, so every page load logs a 404 and falls back to the full image. Regenerate them (re-upload the originals or run the resize extension backfill).
- **Orphaned Storage files** from failed image proposals: since the 2026-01-12 strict rules, a non-author's proposal uploaded files and then failed the Firestore write. Find files under `img/recipes/` that no recipe, edit suggestion or media instruction references, review the list, then delete.
- **Old fields** `approved`, `userId`, `users.favorites` (see release 5 row).
- **Copy-on-publish leftovers** (publishing became in-place, 2026-10-11): the `sourceRecipeId` conditions in `firestore.rules` (create/update) and the unused `publishedId` field on `recipe_submissions`.
- **Old Storage trees** `img/recipes/**` and `recipes/*/media-instructions/**` after release 2b; remove the old path from the resize extension's watched paths.
- **Replace the Resize Images extension** (decided 2026-10-11). Firebase shuts the Extensions service down on **2027-03-31**: installed extensions keep running, but can no longer be reconfigured or uninstalled. Replace it with its function kit (`@firebase-function-kits/storage-resize-images`, 0.0.1 as of 2026-10) once that matures, or with our own small `sharp` function writing the same `_400x400` / `_1080x1080` WebP files. No data or app change is needed. **Revisit January 2027; hard deadline 2027-03-31.**
- **Optional nicety:** a "photos only" shortcut that opens Suggest an edit focused on images, if proposing photos turns out to be too many clicks.

### Release 1 — Lock down security (shipped 2026-10-11)

Shipped to production 2026-10-11: `main` @ `084a715`, rules deployed with `--project production` and verified live. Post-deploy smoke test (signed out): no permission errors. **Next: release 2 (convert the data model).**

Branch `fix/security-rules-lockdown` off `development`. **Security change: show the exact rule diff and passing tests to the user for approval before deploying anywhere.**

1. Rules tests first: Firebase emulator config + `@firebase/rules-unit-testing@4` (matches `firebase` 11); run with `npm run test:rules` — the emulator needs **Java 21+** (`sudo apt install openjdk-21-jdk-headless`). Tests encode today's leaks and fail before the rule change.
2. `firestore.rules`: unapproved recipes readable only by author and managers; non-managers create only as themselves with `approved: false`; non-managers can't change `approved` or the author.
3. `storage.rules`: recipe image deletes only by managers or the recipe's author (cross-service `firestore.get()` lookup of the recipe).
4. App: audit every recipe query — any list that could return unapproved recipes must filter `approved == true` or be manager-only (Firestore rejects the whole query otherwise); recipe page shows "not found" on permission-denied. _Audit done 2026-10-10: every non-manager list already filters `approved == true`._
5. Remove **"Suggest images"** from the recipe menu (decided 2026-10-10). It was shown to everyone, but its write (`pendingImages` on someone else's recipe) has been denied by the rules since 2026-01-12, and "Suggest an edit" already covers images through a separate, secure moderation record. The new rules do **not** open `pendingImages` to non-managers. Code removal is in the cleanup backlog.

Also in this release: every Storage upload is tagged `customMetadata.uploadedBy` (`StorageService.uploadFile`), so uploaders can delete their own files (edit-suggestion cleanup) and nobody else can overwrite or delete recipe files. Files from before the release have no tag; only managers and the recipe's author can change those. Legacy images outside the `{type}/{category}/{recipeId}/` layout are manager-write only.

#### Release 1 — staging test checklist

Setup: the rules are deployed to the test project (`firebase deploy --only firestore:rules,storage --project staging`) and the branch is on the staging site. You need three sessions: **signed out**, a **new test account** (sign up on staging → role `user`), and **your manager account**. Keep DevTools open: no `permission-denied` errors should appear on normal pages.

1. **Signed out**
   - Home, Categories and a few recipe pages load normally, photos included.
   - A recipe page has **no ⋮ menu**.
   - `/recipe/does-not-exist` shows **"המתכון לא נמצא"** with a "לכל המתכונים" button that goes to Categories.
2. **Test account (role `user`)**
   - Propose a recipe **with a photo** → success message.
   - On a published recipe, ⋮ shows **"הצע עריכה"** and **"הוסף לארוחה שלי"**, and **no "הצע תמונות"**.
   - Suggest an edit that **adds a photo** → success message.
   - Add a recipe to My Meal, toggle a favourite → both work.
3. **Find the proposal's ID**: Firebase console → test project → Firestore → `recipes` → the newest doc with `approved: false`.
   - As the **test account**, open `/recipe/<that id>` → the recipe shows (the author can see their own proposal).
   - **Signed out** (or as a different account), open the same URL → **"המתכון לא נמצא"**.
4. **Manager**
   - Dashboard: every section loads (all recipes, pending recipes, pending edits, images, users).
   - Approve the test proposal → it now opens for signed-out visitors and appears in Categories.
   - Approve the edit suggestion → the new photo appears on the recipe.
   - Make another photo edit suggestion with the test account, then **reject** it → no error.
   - Edit a recipe as manager: change its photo and its category → saves, photo shows.
   - AI image enhancer: open it, pick a recipe → loads.
   - Delete the test recipe → gone.
5. **Regression spot checks**: header search, the related-recipes picker in the propose form, My Meal page, Grandma's cookbook page (approved/manager), sign out and in again.

### Design (in parallel)

New screens are designed as artboards in the "Cookbook screens" canvas (https://claude.ai/artifact/SsMxNM5PKyJwdYXnfeqLz5) using the "Our Kitchen Chronicles" design system (https://claude.ai/artifact/GNWbK9XsFAjWC4uFZ3QoJ7), attached explicitly — never set an account default. Screens: not-found state; My recipes; card and recipe-page status badges and owner actions; Save privately / Submit with the untested warning; dashboard submissions queue; nav entry; add-to-collection and collections view. Releases 3 and 4 implement from the canvas.

## Before production: open issues to resolve

Found while testing on staging, or raised for discussion (2026-10-11). **Resolve and verify all of them before the production rollout.**

### 1. Stale code in browsers (service worker) — ✅ safety fix in, follow-up in an issue

- **What happened:** a tab opened before a staging deploy kept running the previous code, wrote photos to the old Storage folders (now manager-only) and failed with an unexpected error. A reload fixed it.
- **Investigated 2026-10-11:** the suspected cause — `public/service-worker.js` serving the page cache-first with a `VERSION` unchanged since April — **does not reproduce**: on production the worker caches nothing (its install batch includes `/src/app.js` and `/src/styles/main.css`, which 404 in a production build, so the whole batch fails), and a local before/after test (simulated deploy, normal reload) showed the new page with the old worker too. The incident is explained by **a tab left open across the deploy** (old code in memory).
- **Safety fix (shipped to `development`):** pages are network-first (the saved copy is only an offline fallback); `VERSION` is stamped with each build's commit (`swVersionPlugin` in `vite.config.js`), so every deploy replaces the worker and its caches; a new worker takes over at once (`skipWaiting` / `clients.claim`); the dead paths are removed. No behaviour change for users today.
- **Rollout impact:** low — nobody uses the app during the window; any tab opened afterwards loads the new code. Ask family members to reload open tabs after the rollout.
- **Follow-up (GitHub issue):** a "new version available — reload" prompt for tabs left open across a deploy; review the worker's role overall (offline value vs. the Firebase messaging worker).

### 2. Gemini API credits (AI features)

- **What happened:** the AI image enhancer failed on staging with `402 — prepayment credits are depleted` (Google AI Studio). Recipe import from photo/URL/video uses the same key and would fail too. Topped up 2026-10-11; the enhancer then worked.
- **Production:** no credit errors in its logs in the last 30 days, and a URL import succeeded on 2026-10-09 — but its key may share the same AI Studio billing and run out the same way.
- **To decide:** pay-as-you-go with a budget alert instead of prepaid credits; which AI Studio project each environment's `GEMINI_API_KEY` belongs to.
- **To verify:** a successful AI call on production right before the rollout (or check AI Studio balances), and failures surfaced clearly to users instead of "unexpected error".

### 3. Search and private recipes — ✅ decided and built (2026-10-11)

- **Decision (option B):** searching finds the reader's own private recipes too — badged (לנסות / פרטי / ממתין / נדחה) — for approved family and managers. Browsing Categories without a search stays the family book. My recipes searches within its tab, like Categories. (Own published recipes were already in every search: publishing is in place.)
- **Built:** `RecipeSearchService.listSearchable` — the one place that merges the two queries (Firestore can't express "published OR mine"); used by the header search (single-match shortcut) and the Categories page while a search is active (the shared list controller now passes the search text to its data source). `RecipeSubmissionService.listMineWithStatus` gives My recipes and search the same badges.
- **To verify on staging:** search a word from one of your private recipes from the header and from Categories.

## Production rollout runbook

Production is held until the whole feature is complete (user decision 2026-10-11), so it rolls out **in one window following this list, top to bottom**. Every release adds its production steps here when it reaches staging — including steps that aren't code (extension settings, function deletions). Before production, do a **dress rehearsal**: fresh production copy into test (`000-copy-prod-to-test.sh`), then run this exact list against `--project staging` and run the staging checklists.

- [ ] 1. Back up production Firestore (managed export) and note the time (point-in-time recovery covers 7 days; Storage has versioning + soft delete).
- [ ] 2. Deploy indexes: `firebase deploy --only firestore:indexes --project production` — wait until they finish building. _(release 2)_
- [ ] 3. `node scripts/migrations/002-convert-model.mjs --project production` (dry run), check counts, then `--apply`. _(release 2)_
- [ ] 4. `node scripts/migrations/003-restructure-storage.mjs --project production` (dry run), check counts, then `--apply`. _(release 2b)_
- [ ] 4b. `node scripts/migrations/004-backfill-author.mjs --project production --author <manager-uid>` (dry run), check the count (test copy, 2026-10-11: 29 published recipes without an author), then `--apply`. The uid is production's own (Authentication → Users, or your doc in `users`); never commit it. _(release 3b)_
- [ ] 5. Resize extension: add the new image folders to `INCLUDE_PATH_LIST` on production. _(release 2b)_ **Only possible before 2027-03-31** (Extensions shutdown) — after that, replace the extension first (see the cleanup backlog).
- [ ] 6. Fast-forward `main` to `staging`, push, wait for the Netlify production deploy.
- [ ] 7. `firebase deploy --only firestore:rules,storage,functions --project production --force` (`--force` approves removing `onRecipeCreated`). _(release 2)_
- [ ] 0. Pre-flight: every item in "Before production: open issues to resolve" is done and verified.
- [ ] 8. Smoke test (with a normal reload, not a hard refresh — checks the service-worker fix): signed out, test account, manager — per the staging checklists.

## Release procedure

Pipeline per release: feature branch → `development` → `staging` → `main`. Each release runs its **deploy window twice**: on the test project when it reaches `staging`, then on production after the `main` merge.

| Where                       | Frontend            | Firebase project (`.firebaserc` alias)   |
| --------------------------- | ------------------- | ---------------------------------------- |
| Local dev                   | `npm run dev`       | test (`default`, also aliased `staging`) |
| Netlify development/staging | branch deploys      | test                                     |
| Production                  | Netlify from `main` | production (`production`)                |

Local dev and staging share the test project — deploying rules or running a script there changes local dev immediately.

**Deploy window** (on each project, back to back, nobody using the app):

0. Before any release with a data script: refresh the test copy from production (`000-copy-prod-to-test.sh`) and rehearse the script there first.
1. Back up Firestore with a managed export (releases 2, 4, 5).
2. Merge; wait for the Netlify deploy to finish.
3. `firebase deploy --only firestore:rules,firestore:indexes,storage,functions --project staging` (or `--project production`) — always an explicit alias, never a bare `firebase deploy` (the default alias is the test project). The gcloud default project is unrelated, so every `gcloud` command needs `--project` too.
4. Run the release's data script: dry run, check counts, then `--apply`.
5. Smoke-test the release's section of `tests/docs/MANUAL_TESTING_PLAN.md` as guest, user, approved and manager.

**Data scripts** live in `scripts/migrations/NNN-name.(js|sh)`: refuse to run without an explicit project, dry run unless `--apply`, safe to re-run, print what they changed.

**Rollback:** Netlify rollback to the previous deploy + redeploy rules/functions from the previous release's commit. Old fields stay until release 5, so a restore from backup is only needed for release 5.

**Production safety nets** (checked 2026-10-10): Firestore point-in-time recovery (7 days) and weekly scheduled backups (98-day retention); Storage object versioning + 7-day soft delete. **Auth users have no backup.**

Cloud Functions are affected in releases 2, 3b and 5: `functions/recipe-transfer.js` writes `approved`; the new-proposal notification moves to `recipe_submissions` in release 2; 3b needs no new function (publishing is in place).

## Prod → test copy (release 0)

`scripts/migrations/000-copy-prod-to-test.sh <phase> [--apply] --transfer-bucket <bucket> --backup-bucket <bucket>` with phases `check`, `backup`, `firestore`, `storage`, `auth`, `verify`. The transfer bucket lives in the production project, the backup bucket in the test project; find both with `gcloud storage buckets list --project <project-id>`. Re-run it before release 5 to rehearse the cleanup on fresh data. After a copy, sign in to local dev/staging with your **production** account.

Lessons from the first run: the test project's Firestore service agent needs read on the transfer bucket (the script now grants it before wiping test); `*.firebasestorage.app` buckets aren't reported by the Firebase project API, so the script uses the Firebase Storage buckets API; the resize extension adds ~12 thumbnails in test that production lacks (harmless).

## Resuming in a fresh session

1. Read this file, then the State column above.
2. Check `git log --oneline development` and open PRs for the release in progress.
3. For the next release, start from its section above (release 2b: "Release 2b — Restructure Storage"); before any production step read "Production rollout runbook"; security-rule changes need the user's approval before any deploy.
