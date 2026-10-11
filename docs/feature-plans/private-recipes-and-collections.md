# Feature Plan: Private recipes, To try, and collections (data-model migration)

## Context

Today every recipe lives in one shared `recipes` collection and "published" is a single `approved` flag that **only the UI respects**: `firestore.rules` lets anyone read every recipe (`allow read: if true`), authors can set `approved: true` on their own recipes, favourites and My Meal accept any recipe id, and any signed-in user can delete any recipe image in Storage.

This plan moves to the usual recipe-app shape: every recipe has an **author** and a **visibility** (the single source of truth for "published"), submissions to the family book go through a **`recipe_submissions`** approval queue (the same pattern as edit suggestions), and favourites become one personal collection among many. A "staging area" stops being a special feature — a private recipe in your own library _is_ the staging area. Untested recipes you collect sit on a **To try** shelf until you've cooked them.

Lifecycle of a recipe:

```
To try ──mark tested──▶ My library ──submit──▶ Pending review ──approve──▶ Published (a copy in the family book)
  ▲                          ▲                       │
  │                          └──rejected or withdrawn┘
  └──────────── fork (your own untested copy) ◀───────────────────────────────── Published
```

Working copy of this plan with diagrams (Claude Doc): https://claude.ai/code/artifact/aa483997-e385-4eb0-90ca-34854a0ccff9 — **this file is the source of truth**; update it as releases ship.

## Decisions (settled 2026-10-10)

| Decision                                       | Decided                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Who can create private recipes                 | Approved family and managers only (sign-up is open to any Google account; one rule condition to widen)         |
| Own private recipes in collections and My Meal | Always allowed for the author                                                                                  |
| What publishing does                           | **Copy.** Approval creates a new published recipe keeping `authorId` + `sourceRecipeId`; author keeps theirs   |
| Editing your own published recipe              | Through edit suggestions, like everyone else                                                                   |
| Managers and private recipes                   | Readable by managers, not listed in the dashboard                                                              |
| Untested recipes you collect                   | A `stage` field on your own recipes (`to-try` / `tested`), **not** a collection                                |
| Submitting an untested recipe                  | Allowed; the Submit button warns                                                                               |
| Deploy ordering                                | Nobody uses the app during a deploy window → no dual-write; each release is one back-to-back window            |
| Family book model (reviewed 2026-10-11)        | **Not a collection.** `visibility` on the recipe + a `recipe_submissions` queue; collections are personal only |
| Approval before release 3b                     | In place: the recipe itself becomes published; copy-on-publish arrives in 3b                                   |
| Recipes with no recorded author                | `authorId: null` — never anyone's recipe; only managers edit them                                              |
| Resubmitting a recipe that's already published | Becomes an edit suggestion on the published copy (`publishedId`), never a second copy                          |
| Pending submissions per recipe                 | At most one (submission doc id = the private recipe's id)                                                      |

## Target model

| Path                                | Key fields                                                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recipes/{id}`                      | `authorId`, `visibility` (`private` \| `published`), `stage` (`to-try` \| `tested`), `testedAt`, `sourceRecipeId` (published copies), `forkedFrom`, content as today                                  |
| `recipe_submissions/{recipeId}`     | `recipeId` (the private original), `authorId`, `status` (`pending` \| `approved` \| `rejected`), `reviewedBy`, `reviewedAt`, `note`/`rejectionReason`, `publishedId` (the copy, from 3b), `createdAt` |
| `collections/{id}`                  | `ownerId`, `name`, `kind` (`favorites` \| `personal`; a curated `book` kind can be added later if ever needed)                                                                                        |
| `collections/{id}/items/{recipeId}` | `addedBy`, `addedAt`                                                                                                                                                                                  |
| `recipes/{id}/notes/{uid}`          | per-user `text`, `rating`, `cookLog` — later phase                                                                                                                                                    |
| `recipe_edit_suggestions/{id}`      | unchanged                                                                                                                                                                                             |
| `users/{uid}`                       | `role`, profile, tokens — `favorites` moves to a collection                                                                                                                                           |
| `active_meals/{uid}`                | unchanged for now                                                                                                                                                                                     |
| Storage `img/recipes/…`             | read follows the recipe's visibility; approval copies photos to the published recipe                                                                                                                  |

Access rules (enforced in `firestore.rules` / `storage.rules`, not only the UI): published recipes are public; private recipes are readable by their author and managers; only approved family and managers create private recipes; non-managers can never change `visibility`, `authorId`, `stage` or `sourceRecipeId`, nor a submission's `status` beyond `pending`; while both exist, `approved` and `visibility` must agree; the author is `authorId`, falling back to the legacy `userId`; a collection item may only point at a recipe its owner can read.

## Releases

| #   | Release                     | Data                                                                                                                                           | UI                                                                                                            | State                                       |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 0   | Prep: prod → test data copy | Test project replaced with a copy of production (`scripts/migrations/000-copy-prod-to-test.sh`)                                                | —                                                                                                             | ✅ 2026-10-10                               |
| 1   | Lock down security          | None. Rules tests (emulator) + tightened Firestore/Storage rules; every recipe query filters published                                         | "Recipe not found" state                                                                                      | ✅ 2026-10-11 (PRs #332, #333)              |
| 2   | Convert the data model      | Script adds `authorId`, `visibility`, `stage: tested`; creates a `recipe_submissions` doc per open proposal. Old fields kept and still written | None                                                                                                          | ✅ staging 2026-10-11 (PR #336) — prod held |
| 2b  | Restructure Storage         | Script copies every recipe file to `recipes/{id}/images                                                                                        | media/`, rewrites paths in recipes and edit suggestions. Old files kept                                       | None                                        | ✅ staging 2026-10-11 (PR #340) — prod held |
| 3a  | Private recipes and To try  | New private recipes (no publishing yet)                                                                                                        | My recipes (To try / My library tabs), Mark as tested, Save privately, private/to-try badges                  | ⬜ needs design                             |
| 3b  | Submissions and publishing  | Submissions; approval creates the published copy (Cloud Function)                                                                              | Submit to the family book, pending/rejected badges, dashboard submissions queue with approve-as-copy / reject | ⬜ needs design                             |
| 4   | Collections                 | Script copies `users.favorites` into a favourites collection. Old list kept                                                                    | Favourite button unchanged; add to collection; collections view                                               | ⬜ needs design                             |
| 5   | Clean up                    | Script deletes `approved`, `userId`, `users.favorites`, `pendingImages`; removes orphaned proposal images                                      | None                                                                                                          | ⬜ after 2–4 settle                         |

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

### Notes for releases 3–4 (from the review)

- **3b approval copy** runs server-side (callable or trigger, admin SDK), copies the recipe and its photos (`img/recipes/{type}/{category}/{recipeId}/…` plus the `_400x400`/`_1080x1080` variants), is idempotent via `publishedId`, and writes the submission `status` last.
- **Copy-on-publish changes the recipe id:** curated links (`relatedRecipes`) to the private original must map through `sourceRecipeId`; published recipes must never link to private ones.
- **Missing recipes:** favourites, My Meal and related links can point at deleted or now-unreadable recipes — load recipes one by one (never one `in` query over mixed ids), tolerate not-found, show a "removed" state.
- **Search:** authors will want their own private recipes too — a second query (`authorId == uid`) merged client-side (rules can't express OR).
- **Copies:** decide whether the published copy keeps the original's `creationTime`.
- **Release 4 favourites:** stale open tabs may still write `users.favorites` after the script; have the new client read both, and re-run the idempotent copy right before release 5.

### Cleanup backlog (release 5 — don't forget)

- **Retired "Suggest images" flow** (removed from the recipe menu in release 1; image changes go through "Suggest an edit"). Delete `RecipeImageProposalService`, `image-proposal-modal`, the dashboard "pending images" section and its approval modal (`image-approval-multi`) if nothing else uses it, the `pendingImages` field on recipes and the `allowImageSuggestions` flag, and any rules that mention them.
- **Missing thumbnails in production:** ~12 recipes have no `_400x400` / `_1080x1080` WebP variants, so every page load logs a 404 and falls back to the full image. Regenerate them (re-upload the originals or run the resize extension backfill).
- **Orphaned Storage files** from failed image proposals: since the 2026-01-12 strict rules, a non-author's proposal uploaded files and then failed the Firestore write. Find files under `img/recipes/` that no recipe, edit suggestion or media instruction references, review the list, then delete.
- **Old fields** `approved`, `userId`, `users.favorites` (see release 5 row).
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

Found while testing on staging (2026-10-11). **Resolve and verify both before the production rollout.**

### 1. Stale code in browsers (service worker)

- **What happened:** a tab opened before a staging deploy kept running the previous code, wrote photos to the old Storage folders (now manager-only) and failed with an unexpected error. A hard refresh fixed it.
- **Why it's bigger than open tabs:** `public/service-worker.js` serves everything **cache-first, including `index.html`**, and only resets its cache when its hard-coded `VERSION` changes (last changed 2026-04-30). A returning visitor or the installed app can keep loading **old code after a deploy**, possibly for many releases.
- **Why it matters for this rollout:** after production goes live, old code would write to closed folders and miss the new fields — failures exactly like the one on staging.
- **To decide:** network-first (or stale-while-revalidate) for HTML, a `VERSION` tied to the build so every deploy refreshes the cache, and/or a "new version available — reload" prompt. At minimum the rollout must change `VERSION`.
- **To verify on staging:** load the site, deploy a change, reload normally (no hard refresh) — the new code must arrive.

### 2. Gemini API credits (AI features)

- **What happened:** the AI image enhancer failed on staging with `402 — prepayment credits are depleted` (Google AI Studio). Recipe import from photo/URL/video uses the same key and would fail too. Topped up 2026-10-11; the enhancer then worked.
- **Production:** no credit errors in its logs in the last 30 days, and a URL import succeeded on 2026-10-09 — but its key may share the same AI Studio billing and run out the same way.
- **To decide:** pay-as-you-go with a budget alert instead of prepaid credits; which AI Studio project each environment's `GEMINI_API_KEY` belongs to.
- **To verify:** a successful AI call on production right before the rollout (or check AI Studio balances), and failures surfaced clearly to users instead of "unexpected error".

## Production rollout runbook

Production is held until the whole feature is complete (user decision 2026-10-11), so it rolls out **in one window following this list, top to bottom**. Every release adds its production steps here when it reaches staging — including steps that aren't code (extension settings, function deletions). Before production, do a **dress rehearsal**: fresh production copy into test (`000-copy-prod-to-test.sh`), then run this exact list against `--project staging` and run the staging checklists.

- [ ] 1. Back up production Firestore (managed export) and note the time (point-in-time recovery covers 7 days; Storage has versioning + soft delete).
- [ ] 2. Deploy indexes: `firebase deploy --only firestore:indexes --project production` — wait until they finish building. _(release 2)_
- [ ] 3. `node scripts/migrations/002-convert-model.mjs --project production` (dry run), check counts, then `--apply`. _(release 2)_
- [ ] 4. `node scripts/migrations/003-restructure-storage.mjs --project production` (dry run), check counts, then `--apply`. _(release 2b)_
- [ ] 5. Resize extension: add the new image folders to `INCLUDE_PATH_LIST` on production. _(release 2b)_ **Only possible before 2027-03-31** (Extensions shutdown) — after that, replace the extension first (see the cleanup backlog).
- [ ] 6. Fast-forward `main` to `staging`, push, wait for the Netlify production deploy.
- [ ] 7. `firebase deploy --only firestore:rules,storage,functions --project production --force` (`--force` approves removing `onRecipeCreated`). _(release 2)_
- [ ] 0. Pre-flight: both items in "Before production: open issues to resolve" are done and verified.
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

Cloud Functions are affected in releases 2, 3b and 5: `functions/recipe-transfer.js` writes `approved`; the new-proposal notification moves to `recipe_submissions` in release 2; the approval copy is a function in 3b.

## Prod → test copy (release 0)

`scripts/migrations/000-copy-prod-to-test.sh <phase> [--apply] --transfer-bucket <bucket> --backup-bucket <bucket>` with phases `check`, `backup`, `firestore`, `storage`, `auth`, `verify`. The transfer bucket lives in the production project, the backup bucket in the test project; find both with `gcloud storage buckets list --project <project-id>`. Re-run it before release 5 to rehearse the cleanup on fresh data. After a copy, sign in to local dev/staging with your **production** account.

Lessons from the first run: the test project's Firestore service agent needs read on the transfer bucket (the script now grants it before wiping test); `*.firebasestorage.app` buckets aren't reported by the Firebase project API, so the script uses the Firebase Storage buckets API; the resize extension adds ~12 thumbnails in test that production lacks (harmless).

## Resuming in a fresh session

1. Read this file, then the State column above.
2. Check `git log --oneline development` and open PRs for the release in progress.
3. For the next release, start from its section above (release 2b: "Release 2b — Restructure Storage"); before any production step read "Production rollout runbook"; security-rule changes need the user's approval before any deploy.
