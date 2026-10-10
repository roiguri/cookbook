# Feature Plan: Private recipes, To try, and collections (data-model migration)

## Context

Today every recipe lives in one shared `recipes` collection and "published" is a single `approved` flag that **only the UI respects**: `firestore.rules` lets anyone read every recipe (`allow read: if true`), authors can set `approved: true` on their own recipes, favourites and My Meal accept any recipe id, and any signed-in user can delete any recipe image in Storage.

This plan moves to the usual recipe-app shape: every recipe has an **author** and a **visibility**, the family book becomes a **collection** whose entries a manager approves, and favourites become one collection among many. A "staging area" stops being a special feature — a private recipe in your own library _is_ the staging area. Untested recipes you collect sit on a **To try** shelf until you've cooked them.

Lifecycle of a recipe:

```
To try ──mark tested──▶ My library ──submit──▶ Pending review ──approve──▶ Published (a copy in the family book)
  ▲                          ▲                       │
  │                          └──rejected or withdrawn┘
  └──────────── fork (your own untested copy) ◀───────────────────────────────── Published
```

Working copy of this plan with diagrams (Claude Doc): https://claude.ai/code/artifact/aa483997-e385-4eb0-90ca-34854a0ccff9 — **this file is the source of truth**; update it as releases ship.

## Decisions (settled 2026-10-10)

| Decision                                       | Decided                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Who can create private recipes                 | Approved family and managers only (sign-up is open to any Google account; one rule condition to widen)       |
| Own private recipes in collections and My Meal | Always allowed for the author                                                                                |
| What publishing does                           | **Copy.** Approval creates a new published recipe keeping `authorId` + `sourceRecipeId`; author keeps theirs |
| Editing your own published recipe              | Through edit suggestions, like everyone else                                                                 |
| Managers and private recipes                   | Readable by managers, not listed in the dashboard                                                            |
| Untested recipes you collect                   | A `stage` field on your own recipes (`to-try` / `tested`), **not** a collection                              |
| Submitting an untested recipe                  | Allowed; the Submit button warns                                                                             |
| Deploy ordering                                | Nobody uses the app during a deploy window → no dual-write; each release is one back-to-back window          |

## Target model

| Path                                | Key fields                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recipes/{id}`                      | `authorId`, `visibility` (`private` \| `published`), `stage` (`to-try` \| `tested`), `testedAt`, `sourceRecipeId` (published copies), `forkedFrom`, content as today |
| `collections/{id}`                  | `ownerId`, `name`, `kind` (`book` \| `favorites` \| `personal`)                                                                                                      |
| `collections/{id}/items/{recipeId}` | `addedBy`, `addedAt`, `status` (`pending` \| `approved` \| `rejected`), `reviewedBy`, `note`, `publishedId`                                                          |
| `recipes/{id}/notes/{uid}`          | per-user `text`, `rating`, `cookLog` — later phase                                                                                                                   |
| `recipe_edit_suggestions/{id}`      | unchanged                                                                                                                                                            |
| `users/{uid}`                       | `role`, profile, tokens — `favorites` moves to a collection                                                                                                          |
| `active_meals/{uid}`                | unchanged for now                                                                                                                                                    |
| Storage `img/recipes/…`             | read follows the recipe's visibility; approval copies photos to the published recipe                                                                                 |

Access rules (enforced in `firestore.rules` / `storage.rules`, not only the UI): published recipes are public; private recipes are readable by their author and managers; non-managers can never write `visibility`, `authorId` or an item `status` beyond `pending`; a collection item may only point at a recipe its owner can read.

## Releases

| #   | Release                     | Data                                                                                                        | UI                                                                                                                | State               |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------- |
| 0   | Prep: prod → test data copy | Test project replaced with a copy of production (`scripts/migrations/000-copy-prod-to-test.sh`)             | —                                                                                                                 | ✅ 2026-10-10       |
| 1   | Lock down security          | None. Rules tests (emulator) + tightened Firestore/Storage rules; every recipe query filters published      | "Recipe not found" state                                                                                          | ⏳ next             |
| 2   | Convert the data model      | Script adds `authorId`, `visibility`, `stage: tested`; creates the book collection + items. Old fields kept | None                                                                                                              | ⬜                  |
| 3   | Private recipes and To try  | New private recipes, book submissions, published copies                                                     | My recipes (To try / My library tabs), Mark as tested, Save privately / Submit, badges, dashboard approve-as-copy | ⬜ needs design     |
| 4   | Collections                 | Script copies `users.favorites` into a favourites collection. Old list kept                                 | Favourite button unchanged; add to collection; collections view                                                   | ⬜ needs design     |
| 5   | Clean up                    | Script deletes `approved`, `userId`, `users.favorites`                                                      | None                                                                                                              | ⬜ after 2–4 settle |

Later, each purely additive: personal notes and "made it" log, forks, meal plans, shopping lists.

### Release 1 — Lock down security (next)

Branch `fix/security-rules-lockdown` off `development`. **Security change: show the exact rule diff and passing tests to the user for approval before deploying anywhere.**

1. Rules tests first: Firebase emulator config + `@firebase/rules-unit-testing` (Java 17 is installed). Tests encode today's leaks and fail before the rule change.
2. `firestore.rules`: unapproved recipes readable only by author and managers; non-managers create only as themselves with `approved: false`; non-managers can't change `approved` or the author.
3. `storage.rules`: recipe image deletes only by managers or the recipe's author (cross-service `firestore.get()` lookup of the recipe).
4. App: audit every recipe query — any list that could return unapproved recipes must filter `approved == true` or be manager-only (Firestore rejects the whole query otherwise); recipe page shows "not found" on permission-denied.

### Design (in parallel)

New screens are designed as artboards in the "Cookbook screens" canvas (https://claude.ai/artifact/SsMxNM5PKyJwdYXnfeqLz5) using the "Our Kitchen Chronicles" design system (https://claude.ai/artifact/GNWbK9XsFAjWC4uFZ3QoJ7), attached explicitly — never set an account default. Screens: not-found state; My recipes; card and recipe-page status badges and owner actions; Save privately / Submit with the untested warning; dashboard submissions queue; nav entry; add-to-collection and collections view. Releases 3 and 4 implement from the canvas.

## Release procedure

Pipeline per release: feature branch → `development` → `staging` → `main`. Each release runs its **deploy window twice**: on the test project when it reaches `staging`, then on production after the `main` merge.

| Where                       | Frontend            | Firebase project (`.firebaserc` alias)   |
| --------------------------- | ------------------- | ---------------------------------------- |
| Local dev                   | `npm run dev`       | test (`default`, also aliased `staging`) |
| Netlify development/staging | branch deploys      | test                                     |
| Production                  | Netlify from `main` | production (`production`)                |

Local dev and staging share the test project — deploying rules or running a script there changes local dev immediately.

**Deploy window** (on each project, back to back, nobody using the app):

1. Back up Firestore with a managed export (releases 2, 4, 5).
2. Merge; wait for the Netlify deploy to finish.
3. `firebase deploy --only firestore:rules,storage,functions --project staging` (or `--project production`) — always an explicit alias, never a bare `firebase deploy` (the default alias is the test project). The gcloud default project is unrelated, so every `gcloud` command needs `--project` too.
4. Run the release's data script: dry run, check counts, then `--apply`.
5. Smoke-test the release's section of `tests/docs/MANUAL_TESTING_PLAN.md` as guest, user, approved and manager.

**Data scripts** live in `scripts/migrations/NNN-name.(js|sh)`: refuse to run without an explicit project, dry run unless `--apply`, safe to re-run, print what they changed.

**Rollback:** Netlify rollback to the previous deploy + redeploy rules/functions from the previous release's commit. Old fields stay until release 5, so a restore from backup is only needed for release 5.

**Production safety nets** (checked 2026-10-10): Firestore point-in-time recovery (7 days) and weekly scheduled backups (98-day retention); Storage object versioning + 7-day soft delete. **Auth users have no backup.**

Cloud Functions are affected in releases 2–3 and 5: `functions/recipe-transfer.js` writes `approved`, and the new-proposal notification (`onRecipeCreated`) fires on `approved === false`.

## Prod → test copy (release 0)

`scripts/migrations/000-copy-prod-to-test.sh <phase> [--apply] --transfer-bucket <bucket> --backup-bucket <bucket>` with phases `check`, `backup`, `firestore`, `storage`, `auth`, `verify`. The transfer bucket lives in the production project, the backup bucket in the test project; find both with `gcloud storage buckets list --project <project-id>`. Re-run it before release 5 to rehearse the cleanup on fresh data. After a copy, sign in to local dev/staging with your **production** account.

Lessons from the first run: the test project's Firestore service agent needs read on the transfer bucket (the script now grants it before wiping test); `*.firebasestorage.app` buckets aren't reported by the Firebase project API, so the script uses the Firebase Storage buckets API; the resize extension adds ~12 thumbnails in test that production lacks (harmless).

## Resuming in a fresh session

1. Read this file, then the State column above.
2. Check `git log --oneline development` and open PRs for the release in progress.
3. For release 1, start from "Release 1 — Lock down security"; remember the approval gate before any rules deploy.
