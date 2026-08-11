# Feature Plan: Personal Recipe Collections (with promotion to shared)

## Context

The app is designed around a single shared corpus. `recipes/{id}` is one global collection and `approved: boolean` is the only visibility gate; every listing surface filters `where approved == true` (`home-page.js:52`, `categories-page.js:210`, `header-search-bar.js:164`, `recipe-related-field.js:192`, `ai-image-enhancer.js:70`). `userId` records who proposed a recipe, not who owns it in any meaningful sense.

The surfaces that feel personal borrow the shared corpus's furniture. Favorites is the clearest case: it is not a page but a query parameter — `auth-controller.js:124` adds the מועדפים tab as `/categories?favorites=true`, a filtered view of everyone's recipes. `/my-meal` is the one real personal surface, with its own page module and layout, and it is the closest precedent for what this feature should feel like.

This plan inverts the model. A signed-in user gets a **personal collection**: recipes they authored (private by default) plus public recipes they saved, each carrying a private overlay (notes, serving override). Sharing becomes an explicit, moderated promotion of a personal recipe into the public corpus, and the reverse — grabbing a public recipe into your own collection — is a first-class action.

Confirmed product decisions:

- **Publishing stays gated.** `private → pending → public`, promoted by a manager. Users never write `visibility: 'public'` themselves.
- **Both directions must work.** Personal → shared (promotion) and shared → personal (save).
- **Staged rollout.** The personal layer lands first, beside the untouched shared corpus; the shared corpus becomes secondary only at the end.
- **The collection is organised by cooking lifecycle, not by a favorite flag.** Two states: `to-try` (saved, never cooked) and `rotation` (tried, kept). See "Why not `favorite`".
- **Graduation is manual.** Nothing auto-promotes; no coupling to `/my-meal`. Consequently **everything enters at `to-try`**, whatever its provenance.
- **User-defined lists come later, additively**, and are shaped now so that _sharing them between users_ stays reachable without a migration. The Stage 1 UI must be built so they slot in without rework.
- **AI extraction stays role-gated.** `approved` + `manager` only, unchanged. Plain signed-in users create recipes through the manual form.
- **Naming.** `/my-recipes` = **המתכונים שלי**; the shared corpus becomes **כל המתכונים**.
- **No unpublishing.** Publication is one-way for the owner. Managers retain delete/takedown.
- **Owners keep direct write on their own public recipes** (the status quo), with `lastEditedAt` stamped. See Slice 3.4.

## Working principles

- **Vertical slices.** Every slice is a thin top-to-bottom cut that is manually testable in the UI (or, for the migration slices, verifiable in the Firestore console). Foundation code ships _with_ the first UI that uses it.
- **Always shippable.** After each slice the app builds, tests pass (`npm run lint && npm run test && npm run build`), and there's a concrete thing to click.
- **The shared corpus keeps working throughout.** Until Stage 4, no existing read path changes behaviour. `approved` stays written in parallel with `visibility`, and the read rule stays keyed to `approved` until Stage 4, so a rollback is always a rules-only revert. See Slice 0.2 for why the rule cannot switch early.
- One slice ≈ one focused commit; the pre-commit hook (format/lint/test/build) must stay green.

## Commits (branch `feat/personal-collections`)

Every line is one commit. Tick as they land. Repo convention merges feature branches into `development`, not `main` — settle the merge target before the first PR; the rules deploys are manual and separate either way.

**Groundwork** — pre-existing bugs surfaced by the prototype; Stage 1 inherits both.

- [ ] `fix(styles): mirror recipe-card stamp and fav with logical properties`
- [ ] `fix(styles): use --font-display-he for Hebrew recipe titles`

**Stage 0 — backfill + rules lockdown.** Ships alone; the only visible change is the intended one — unapproved recipes stop being readable by direct link.

- [ ] `fix(recipes): write visibility in propose flow, drop anonymous fallback` ← before the rules
- [ ] `fix(recipes): tolerate per-recipe read failures in related recipes` ← before the rules
- [ ] `chore(recipes): backfill visibility from approved on all recipes`
- [ ] `fix(rules): gate recipe reads on approved and guard recipe writes`
- [ ] `fix(rules): stop signed-in users deleting or replacing recipe images` ← approve rule diff before deploy

**Stage 1 — personal collection.** Shared corpus untouched.

- [ ] `feat(collections): CollectionService + users/{uid}/collection rules`
- [ ] `refactor(favorites): migrate favorites array to collection entries`
- [ ] `fix(dashboard): key the pending queue on visibility, not approved` ← before private authoring
- [ ] `feat(collections): /my-recipes page with lifecycle rail and empty states`
- [ ] `fix(recipes): designed unavailable state for unreadable recipes`
- [ ] `feat(recipes): wire card stamps for private/pending/public`
- [ ] `feat(collections): create private recipes from the collection page`
- [ ] `fix(recipes): hide AI import from users without the approved role`

**Stage 2 — save from the shared corpus.**

- [ ] `feat(collections): save a public recipe to my collection`
- [ ] `feat(collections): personal overlay — notes and servings override`
- [ ] `feat(collections): manual graduation from לנסות to במטבח`
- [ ] `feat(search): group header search results by scope`

**Stage 3 — request → approve sharing.**

- [ ] `feat(recipes): request sharing (private → pending) and withdraw`
- [ ] `feat(dashboard): pending-share review actions (non-destructive reject)`
- [ ] `feat(functions): notify the owner on share approval or rejection`
- [ ] `feat(functions): split account deletion — purge personal data, reassign public recipes`
- [ ] `fix(recipes): stop hardcoding approved:true in edit-recipe-component` ← blocks owner Edit
- [ ] `feat(recipes): owner edit action + lastEditedAt stamp`
- [ ] `refactor(recipes): retire /propose-recipe in favour of create-then-share`

**Stage 4 — flip the emphasis.**

Ordered for two non-atomic deploy pipelines — see "There is no atomic deploy".

- [ ] `chore(firestore): add visibility-keyed public listing indexes`
- [ ] `fix(rules): bridge read rule accepting approved OR visibility` ← deploy before app code
- [ ] `refactor(recipes): switch read paths to visibility`
- [ ] `fix(rules): tighten read rule to visibility only` ← after the stale-client window
- [ ] `chore(recipes): drop the approved field and its parallel writes`
- [ ] `feat(nav): rename to כל המתכונים, redirect favorites deep link, delete shim`

**Later 🔮**

- [ ] User-defined lists (see "User lists")
- [ ] Shared collections (see "Shared collections")

---

## The core model

Split **the recipe** from **the collection entry**. They are different objects with different owners and different lifetimes.

```
recipes/{recipeId}                    ← the content. one owner, one visibility state.
  userId: uid                         ← existing field, now meaning "owner" (not renamed — see below)
  visibility: 'private' | 'pending' | 'public'
  approved: bool                      ← legacy, written in parallel until Stage 4
  sourceRecipeId?: string             ← set only on true forks
  publishedAt?: Timestamp
  shareReview?: { reviewedBy, reviewedAt, reason }
  ...existing fields unchanged

users/{uid}/collection/{recipeId}     ← a pointer plus this user's private layer
  source: 'owned' | 'saved'           ← provenance. set once, never changes.
  state:  'to-try' | 'rotation'       ← cooking lifecycle. exclusive, manually changed.
  addedAt: Timestamp
  notes?: string
  servingsOverride?: number
  card?: { name, category, primaryImage, prepTime }   ← denormalised, see "Constraints"

  everything above is PER-USER by design, and stays correct even once
  collections are shared between users. List membership deliberately does
  NOT live here — see "Shared collections".
```

Using `recipeId` as the collection-entry doc ID is deliberate: it makes saving idempotent (you cannot save the same recipe twice) and makes "is this in my collection?" a single `getDoc` rather than a query.

### Why this split makes both directions cheap

- **Personal → shared**: flip `visibility` on the recipe document. The collection entry is untouched; the owner keeps their entry, now `source: 'owned'` pointing at a public recipe.
- **Shared → personal**: write one collection-entry document pointing at the existing public recipe. No copy, no image duplication, no divergence.

### Why not `favorite: bool`

A boolean cannot express the distinction that matters. "I have cooked this and trust it" and "I bookmarked this and never made it" are not degrees of the same thing — they answer different questions (_what should I cook tonight?_ vs _what should I try next?_). A single flag collapses both into "the user clicked a heart once", which is why favorites lists rot.

`state` is therefore a two-value lifecycle, not a flag. Because graduation is manual (see below), **rotation is always an explicit human judgement**, so every entry entering the collection starts at `to-try` regardless of provenance — authored, imported, or saved. No provenance-dependent defaults.

Consequence for the existing heart button: with no separate favorite concept, the heart on a **discover** card becomes "save to my collection" (creates the entry at `to-try`). Inside the collection the heart is meaningless and is replaced by lifecycle/remove actions — the two contexts get different card action sets rather than one shared `show-favorites` toggle.

### Why the lifecycle is not modelled as the first two user lists

Tempting, since it would give one mechanism. Rejected because the cardinalities differ:

- **Lifecycle is exclusive** — a recipe is either tried or untried, never both.
- **User lists are many-to-many** — a recipe can be in שבת _and_ מהיר _and_ של אמא.

Folding them together means either permitting a recipe in both `to-try` and `rotation` (incoherent) or imposing exclusivity on user lists (wrong). They stay separate fields; the UI presents them in one navigation rail so the user experiences them uniformly anyway.

### Why manual graduation, and what it costs

`/my-meal` already tracks per-recipe `currentStepIndex` and `servings` as you cook (`my-meal-page.js:283-287`), so auto-promotion on completion was available and was considered. Rejected: completing a recipe cannot distinguish "made it and loved it" from "made it and never again", so rotation would slowly fill with things the user didn't like.

The cost is that the queue only drains when the user curates it. Accepted deliberately.

**No cooking-frequency tracking.** `cookedCount` / `lastCookedAt` are out of scope — not deferred. The collection records _whether_ a recipe is in rotation, never _how often_ it is made. This keeps the entry honest (nothing would populate those fields without `/my-meal` coupling) and keeps the card meta line free for attribution.

### Why sharing needs no separate collection

`recipe_edit_suggestions` is a separate collection because its _payload_ — proposed changes to a live recipe — has nowhere to live on the recipe itself without letting a user self-apply it. A share request has no payload; the thing under review is the recipe exactly as it stands. So `visibility: 'pending'` **is** the queue: the dashboard queries `where visibility == 'pending'`, and review metadata lands in a `shareReview` map on the recipe. One fewer collection, one fewer rules block, one fewer consistency pair to keep in sync.

### Why not fork-on-publish

Image Storage paths are keyed by recipe ID — `img/recipes/{type}/{category}/{recipeId}/{fileName}` (`recipe-image-utils.js:52`). Every recipe copy costs a full re-upload of the original bytes plus regeneration of every WebP variant; `RecipeImageService.migrateFilesToCategory` (`recipe-image-service.js:175`) exists precisely because moving these files is fiddly. Sharing a path between two recipe documents is not an option — deleting either destroys the other's images.

Since saving a shared recipe happens far more often than publishing one, that direction must be a pointer. And once it is a pointer, the `notes` / `servingsOverride` overlay covers the case forking was meant to solve ("I make it with half the sugar") without duplicating anything. True forking stays available as a rare, explicit action that pays the copy cost honestly and records `sourceRecipeId`.

### Why `userId` is not renamed to `ownerId`

`userId` already means owner in `firestore.rules` and in the recipes `update` rule. Renaming buys clarity and costs a full-collection migration plus a dual-read window in every service. Keep the field, document the meaning.

---

## The UI layer

### The IA shrinks

Today a signed-in user sees four nav tabs (דף הבית, מתכונים, הצעת מתכון, מועדפים), a manager six. In the target model:

- **מועדפים dissolves.** It becomes the lifecycle rail inside the collection page, not a top-level destination. This happens in Stage 1, not Stage 4 (see Slice 1.3): keeping both tabs for three stages would show the same recipes through two different lenses.
- **הצעת מתכון dissolves.** Adding a recipe and sharing a recipe stop being one act; you add to your collection, and sharing is a later action on a recipe that already exists.
- **מתכונים is renamed to כל המתכונים** — it stops being _the_ recipes and becomes the full corpus you browse to find new ones. Chosen over a "discover" framing (גילוי / לגלות) as clearer and a better fit for a family cookbook's register.

End state: **דף הבית | כל המתכונים | המתכונים שלי** (+ סבתא, ניהול). Three tabs instead of four. The redesign is a simplification of the navigation, not an addition to it.

### The collection page is a rail, not tabs

The single most important Stage 1 UI decision. Lifecycle is the navigation axis; provenance is metadata on the card.

```
המתכונים שלי                              + הוסף

  ├ במטבח        24        ┌──────┐  ┌──────┐  ┌──────┐
  ├ לנסות         7        │  ✒   │  │      │  │      │
  │                        └──────┘  └──────┘  └──────┘
  ├ ──────────
  ├ שבת          12        ┌──────┐  ┌──────┐     ✒ = authored by me
  ├ מהיר          8        │      │  │  ✒   │     ● = private / in review
  └ + רשימה חדשה           └──────┘  └──────┘
       ↑
   Stage 1 ships everything above the divider.
   The divider and below is the additive part.
```

If Stage 1 ships a two-tab toggle, adding user lists later means rebuilding the page's navigation. As a rail with two pinned entries, it means appending rows to something that already exists. On mobile the rail collapses to a horizontal scroller — decided, not open: at two (later a handful of) entries, a drawer would cost a tap to reach the page's primary navigation. Drawers stay for genuinely secondary content, as in `/my-meal`'s ingredients panel.

The grid itself is `recipe-presentation-grid` reused as-is — it already handles pagination and add-to-meal. Provenance is a card marker plus a filter, never a segment.

### Card visibility states are already designed

`src/styles/components/cards.css:119-140` defines `.recipe-card__stamp` with `--pending` and `--approved` variants plus a `.recipe-card--pending` treatment, demoed at `design-system.html:902-923`. They are **not wired into the live component** — no `stamp` reference exists in `recipe-card.js`. Stage 1 wires them and adds a `--private` variant. The three visibility states map onto a pattern the design system already committed to.

### Recipe detail has three ownership states

Status is not an action, so it does not belong in the 3-dot dropdown — it gets a chip near the title. The _actions_ go in the existing dropdown beside הצע תמונות / הצע עריכה (`recipe-detail-page.html:13-40`), which is already the home for auth-gated recipe actions.

| You are           | Chip     | Dropdown action               |
| ----------------- | -------- | ----------------------------- |
| Owner, private    | "רק אתה" | Edit · Request sharing        |
| Owner, pending    | "בבדיקה" | Edit · Withdraw               |
| Owner, public     | "משותף"  | Edit (direct — see Slice 3.4) |
| Not owner, public | —        | Save to my collection         |

Note the asymmetry: an owner sees Edit in all three states, a non-owner sees הצע עריכה. There is no unpublish action in any state. The table's missing fourth row — **non-owner, private/pending** — is a permission-denied read, rendered by the designed unavailable state from Slice 1.3, never a blank shell.

### The overlay is nearly free

`recipe_component` already accepts an `initial-servings` attribute and scales ingredients through `scaleIngredients` (`recipe_component.js:1359-1383`). `servingsOverride` is a pass-through of a value the component already takes — no new UI. `active_meals` separately stores a per-recipe `servings` for the live session; the overlay becomes the persistent default that seeds it.

Only `notes` needs a home. `/my-meal` establishes `app-drawer` as this app's pattern for auxiliary personal content.

### Empty states are a requirement, not polish

An empty filtered list is unremarkable; an empty personal cookbook on first sign-in is the user's introduction to the entire feature. Both rail entries need designed empty states that route in both directions — browse discover to save something, or add your own.

---

## Stage 0 — `visibility` backfill + rules lockdown 📋

Ships independently, changes no user-visible behaviour, and fixes two live security bugs.

### Slice 0.1 — App prerequisites + backfill

- **The propose flow starts writing `visibility: 'pending'`** alongside `approved: false` (`propose_recipe_component.js:75`). This must deploy **before** Slice 0.2's rules: the create rule references the field, and a payload without it is rejected — with the old bundle live, every proposal would 403. The same commit drops the `userId: 'anonymous'` fallback (`propose_recipe_component.js:60`): the existing create rule already requires auth so the fallback is dead code today, and it can never pass the new `userId == request.auth.uid` guard.
- **The related-recipes fetch becomes failure-tolerant.** `recipe_component.js:1266` fetches related IDs with a bare `Promise.all`; under the new read rule, one related ID pointing at a non-public recipe rejects the whole strip. Switch to per-id try/catch — `my-meal-page.js:100-116` already does exactly this. Also ships before the rules.
- One-off Admin SDK script (establishing a `scripts/` convention — none exists yet) writing `visibility` to every existing recipe: `approved: true → 'public'`, `approved: false → 'pending'`. Nothing reads `visibility` yet.
- Both fields written in parallel from here until Stage 4. The dormant server-side create in `functions/recipe-transfer.js:390` (gated dead, #202) writes **neither `userId` nor `visibility`** — if it is ever revived it must join the parallel-write set, or its documents break both the invariant and `transitionOk()`.

### Slice 0.2 — Rules lockdown

Three bugs exist in `firestore.rules` today and all get materially worse once private recipes exist:

- **`allow read: if true` on `recipes`.** Every unapproved proposal is world-readable by ID right now. Under a private-by-default model this is a straight leak.
- **`allow update` has no field guard.** The rule is `isManager() || (isAuthenticated() && resource.data.userId == request.auth.uid)`, so an owner can set `approved: true` on their own recipe and self-publish. The entire `recipe_edit_suggestions` design exists to prevent exactly this for edits, while the recipe document itself is open.
- **`allow create` has no field guard either** — `firestore.rules:84` is bare `isAuthenticated()`. Any signed-in user can self-publish today by _creating_ a recipe with `approved: true`, or spoof `userId`, via a raw SDK call. The create rule below closes this third path.

#### The read gate must key off `approved`, not `visibility`

**This is the single most dangerous thing in the plan and it is easy to get wrong.** Firestore security rules are not filters. For a `list` query, the rule must be _provable from the query's own constraints_; Firestore will not evaluate it per-document and silently drop the ones that fail.

Every live read path filters `where approved == true` (`home-page.js:52`, `categories-page.js:210`, `header-search-bar.js:164`, `recipe-related-field.js:192`, `ai-image-enhancer.js:70`). If the rule gates on `resource.data.visibility` instead, Firestore cannot prove `approved == true ⟹ visibility == 'public'` from the query, so it **rejects the entire query** with "Missing or insufficient permissions" — for every signed-out visitor and every non-manager user, immediately, **even after a flawless backfill**.

Worse, the breakage is invisible to whoever deploys it. `isManager()` does not reference `resource`, so when it is true the disjunction is globally true and every manager query is allowed. A manager deploying these rules and clicking around would see a perfectly working site while every logged-out visitor is locked out.

So Stage 0 gates on the field the live queries already filter on, and the `visibility` gate waits for Stage 4 — where it lands via a **bridge rule accepting both fields**, because this repo has no way to deploy rules and app code atomically (see "There is no atomic deploy"):

```js
// STAGE 0 — provable from `where approved == true`. Closes all three bugs.
allow read: if resource.data.approved == true
            || isOwner(resource.data.userId) || isManager();

// `in ['private', 'pending']`, not `== 'private'`: the propose flow keeps
// creating at 'pending' until Slice 3.3 retires it. Tighten there.
allow create: if isAuthenticated()
              && request.resource.data.userId == request.auth.uid
              && request.resource.data.visibility in ['private', 'pending']
              && request.resource.data.approved == false;

allow update: if isManager() || (isOwner(resource.data.userId) && transitionOk());

function transitionOk() {
  // .get() with a default: a doc the backfill somehow missed must not
  // brick its owner's updates — bare missing-key access denies in rules.
  let from = resource.data.get('visibility', 'pending');
  let to = request.resource.data.get('visibility', 'pending');
  return request.resource.data.userId == resource.data.userId
      // an owner may NEVER touch `approved` — it is the live publication
      // flag until Stage 4, and omitting this reopens the self-publish bug
      // this slice exists to close
      && request.resource.data.approved == resource.data.approved
      // review metadata is manager-authored. The owner may REMOVE
      // `shareReview` (withdraw must — Slice 3.1) but never write or
      // alter it, and may never touch `publishedAt`.
      && (request.resource.data.get('shareReview', null) == null
          || request.resource.data.shareReview == resource.data.get('shareReview', null))
      && request.resource.data.get('publishedAt', null) == resource.data.get('publishedAt', null)
      && (to == from
          || (from == 'private' && to == 'pending')
          || (from == 'pending' && to == 'private'));
}
```

Delete stays manager-only for public recipes (others may have saved them); owners may delete their own `private` / `pending` recipes.

**The parallel-write invariant** that makes this work: `approved == (visibility == 'public')`. Private and pending recipes are written with `approved: false`, so the Stage 0 rule keeps them unreadable by non-owners without ever mentioning `visibility`.

**What a locked-down link looks like.** `recipe_component.js` swallows fetch errors (explicit `TODO`s in `fetchAndPopulateRecipeData`) and fires `recipe-data-loaded` regardless, so a visitor hitting a now-unreadable recipe gets a silent empty shell, not an error card. Tolerable for the Stage 0 window — the only links that break are to unapproved proposals — but the designed "המתכון אינו זמין" state lands with Slice 1.3, before saved entries and non-owner links to private recipes make the blank shell a routine sight.

**Ordering:** backfill → verify → deploy rules, staging before production (`firebase deploy --only firestore:rules --project production`; outward and hard to reverse, confirm before running). "Verify" means an explicit completeness check — a count of `recipes` where `visibility` is missing, expected zero — not a glance at the console. Note that with the rule keyed off `approved`, an incomplete backfill degrades gracefully: it affects only the new surfaces built in Stages 1–3, never the live public read paths.

### Slice 0.3 — Storage lockdown

`storage.rules:19-23` grants **any authenticated user** `create`, `update`, and `delete` on `img/recipes/**`. Any signed-in account can therefore delete or overwrite _any_ recipe's images — the whole corpus's, not just their own — and image paths are derivable from recipe documents, which are world-readable until Slice 0.2 lands. Same class of bug as the three above, and this feature is designed to grow the signed-in population.

Fix: scope `create`/`update`/`delete` to the recipe owner or a manager. Storage rules can check ownership via cross-service `firestore.get()` on the recipe doc (the path already carries `{recipeId}`), at the cost of one Firestore read per Storage write. Public **read** stays as-is — the read-side obscurity trade-off is documented under "Constraints" and remains consciously deferred.

⚠️ Security-rule change with lockout potential — owners' image upload flows must keep working. Per working agreement, the concrete rule diff gets explained and approved before `firebase deploy --only storage` runs anywhere.

---

## Stage 1 — Personal collection 📋

The shared corpus is untouched. The existing propose flow keeps writing `approved: false` — now alongside `visibility: 'pending'` per Slice 0.1 — and the dashboard queue keeps showing exactly the same documents, re-keyed in Slice 1.4.

### Slice 1.1 — `CollectionService`

- New `src/js/services/users/collection-service.js`, sole owner of `users/{uid}/collection`. Mirrors `UserService`'s shape as the single owner of its collection — `get` / `list` / `create` / `update` / `delete` — plus the entry-specific `setState` and `updateOverlay`. (Those last two are new here; they are not existing `UserService` methods.)
- `firestore.rules`: `match /users/{userId}/collection/{recipeId}` — read/write only if `isOwner(userId)`. Managers deliberately excluded; a personal overlay is private.

### Slice 1.2 — Favorites migration

- `favorites` is an array on the user doc and will eventually hit the 1MB document limit. Migrate each entry to a collection document with `source: 'saved'`.
- **Migration state decision:** existing favorites migrate to `rotation`, not `to-try`. Hearting was the closest thing to endorsement the old model had; dumping a user's existing favorites into a "to try" queue would misrepresent them. This is the one exception to "everything enters at `to-try`", and it applies only to migrated data.
- **Script mechanics.** Admin SDK, iterating every user — a client cannot write other users' subcollections. It reads each favorited recipe to build the denormalised `card` map (O(users × favorites) reads, fine at this app's size). Dangling IDs — recipes deleted since hearting — are **skipped**, not tombstoned: there is no card data left to build a tombstone from. Favorites pointing at existing-but-unapproved recipes should not exist (the heart only ever rendered on approved cards); verify and skip if found. Hearts written _during_ the run can be lost — the script is idempotent by construction (entry ID = recipe ID), so run it twice.
- **The shim must cover BOTH read paths.** `FavoritesService` keeps its current API as a shim over `CollectionService`, so the favorites filter at `categories-page.js:210` does not change. But the grid does **not** read through `FavoritesService`: `recipe-presentation-grid.js:277-284` populates card hearts from `authService.getUserData().favorites`, and `auth-service.js:138-158` maintains its own independent cache of that array via the `recipe-favorite-changed` event. Shimming `FavoritesService` alone leaves grid hearts rendering from a dead array. This slice routes the grid through the shim and retires auth-service's favorites cache in the same commit.
- **Shim semantics, pinned:** "favorite" = "entry exists in my collection", regardless of `state`. Migrated hearts are `rotation` and Stage 2 saves enter at `to-try`; the shim returns all entry IDs so the heart's meaning doesn't drift mid-transition.
- The shim is temporary scaffolding, removed in Stage 4.

### Slice 1.3 — The collection page

- New route `/my-recipes` + page module. Nav item המתכונים שלי **replaces** מועדפים in `auth-controller.js:updateNavigation` (`auth-controller.js:124`) — pulled forward from Stage 4. Keeping both tabs for three stages would show the same recipes through two different lenses (the prototype's "migration moment"); the deep link `/categories?favorites=true` keeps working through the shim until Stage 4 redirects it.
- Router navigation guard: unauthenticated → redirect with login prompt.
- Lifecycle rail (two pinned entries), `recipe-presentation-grid` for the grid, designed empty states for both entries. The rail is the page's primary navigation — it needs a keyboard/focus pass, not just `aria-current`.
- **Composite index ships in the same commit** if the grid orders entries: `where state == X orderBy addedAt desc` on the `collection` subcollection needs its own `firestore.indexes.json` entry — the same fails-only-at-runtime trap flagged for the dashboard queue.
- **The unavailable-recipe state lands here**: a designed "המתכון אינו זמין" page state replacing today's silent empty shell (see Slice 0.2). Covers non-owners hitting private/pending links and saved entries whose source recipe changed.
- The page has **two data sources** to resolve before `hideLoadingState()` — the entries query and the orphan self-heal query (`recipes where userId == uid`, provable under the Stage 0 read rule via the `isOwner` disjunct). Define the merge: entries render; owned recipes with no entry get one written back (repair), not merely displayed.
- `recipe-card` gains stamp wiring + the `--private` variant.

### Slice 1.4 — The dashboard queue re-keys to `visibility` (pulled forward from Stage 3)

**Must land before Slice 1.5.** Private recipes are written with `approved: false` under the parallel-write invariant, and the pending queue is `where approved == false` (`manager-dashboard-page.js:502`) — the only `approved == false` query in the codebase. Without this slice, every private recipe from Slice 1.5 appears in the manager queue looking exactly like an unsolicited proposal, and the preview modal's reject button hard-deletes it (`recipe_preview_modal.js:270-272`). That is Slice 3.2's "catastrophic" scenario firing two stages early, during routine queue triage.

Switch the query to `where visibility == 'pending'`. Safe on its own: after the backfill the two predicates select identical documents, and the query has no `orderBy` (the list is sorted client-side), so no composite index is needed. Slice 3.2 then only changes what the review _actions_ do, not what the queue _shows_.

### Slice 1.5 — Private recipe authoring

- Recipes created from the collection page default to `visibility: 'private'`, `source: 'owned'`, `state: 'to-try'`, writing the collection entry in the same operation.
- Manual form for all signed-in users; the AI import path inside `recipe_form_component:111` stays gated to `approved` + `manager` by the existing function guards. No change to `functions/index.js`.
- Not transactional across the two writes; a failed entry write leaves an orphan private recipe. The collection view self-heals by also querying `recipes where userId == uid`.

---

## Stage 2 — Save a shared recipe 📋

One collection-entry write plus the affordance. Cheap because Stage 1 built the model, and it is what makes the collection useful _before_ any sharing flow exists.

- "Save to my collection" on `/recipe/:id` for public recipes, auth-gated like הצע עריכה. Creates the entry at `to-try`.
- **Save is create-only.** Entry ID = recipe ID makes saving idempotent only if a repeat save is a no-op — a blind `setDoc` on an already-saved recipe silently resets `state` to `to-try` and wipes `notes`/`servingsOverride`. Check existence first, or enforce create-only semantics in the rules.
- The discover card's heart becomes save; the collection card's actions become lifecycle + remove. **Un-hearting deletes the entry — including the overlay.** A casual un-tap must not destroy notes: confirm removal when `notes` or `servingsOverride` exist.
- Overlay editing (notes, servings) on the saved entry.
- Manual graduation control: `to-try → rotation` from the card menu and the recipe detail page.
- Grouped search dedupes by ID: an owned public recipe matches both the personal query and the corpus query — it renders once, under המתכונים שלי.

---

## Stage 3 — Request → approve sharing 📋

### Slice 3.1 — Request

- Owner action on a private recipe: `private → pending`, allowed by the Stage 0 transition guard. Withdraw is the reverse transition.
- **Withdraw must clear `shareReview`.** Withdraw and reject both land on `visibility: 'private'`, so a stale rejection reason would otherwise survive a withdraw and resurface the next time the owner requests sharing — appearing to reject a request nobody had reviewed yet.

### Slice 3.2 — Manager review

- The queue already keys on `visibility == 'pending'` since Slice 1.4; this slice changes what the review **actions** do, following the pending-edits precedent in `dashboard-refresh-manager.js`. (No composite index needed while the queue stays unordered; if `orderBy` is added, the `visibility ASC, creationTime DESC` index ships in the same commit — a missing index fails at runtime the first time a manager opens the queue, not at lint or build.)
- Approve writes `visibility: 'public'`, `publishedAt`, and `approved: true` for parallel-write compatibility. Reject writes `visibility: 'private'` plus `shareReview.reason`.
- **The owner hears about the outcome.** The pending-state copy promises "נעדכן אותך" (prototype, Screen 5); nothing in the app notifies users today — `onRecipeCreated` in `functions/index.js` pushes to managers only. Wire an owner-facing notification on approve/reject in this slice, or change the copy to stop promising it. The rejection reason (`shareReview.reason`) must also surface to the owner — on the recipe detail page in its private state — or it was written for nobody.

⚠️ **Do not reuse `recipe_preview_modal` as-is.** Its approve path writes a field (`recipe_preview_modal.js:267`), but its reject path **permanently deletes the document** — `handleRecipeRejection` calls `RecipeService.delete(recipeId)` (`recipe_preview_modal.js:270-272`). That is correct for its current job (rejecting an unsolicited proposal that exists only as a proposal) and catastrophic for this one: declining to publish would destroy the author's private recipe, which they still own and may have spent real effort on.

Share review therefore needs its own review path, or an explicit mode flag on the modal that swaps the reject action from delete to `visibility: 'private'` + `shareReview.reason`. The two reviews look alike and behave oppositely on the destructive branch — worth a test that asserts the recipe still exists after a rejection.

### Slice 3.3 — Retire the old propose path

- `/propose-recipe` and its nav item are removed; adding a recipe happens in the collection page. The `approved: false` write disappears.

### Slice 3.4 — Owner edits on public recipes: keep direct write

**Decided: the owner keeps direct write on their own public recipe** — the status quo, since `firestore.rules` already grants update on `resource.data.userId == request.auth.uid` with no approved-status condition. Add a `lastEditedAt` stamp on every write.

⚠️ **`edit_recipe_component.js:69` must be fixed first, in this slice — not in Stage 4.** It sends a hardcoded, unconditional `approved: true` on every save. That is safe today only because the component is reachable exclusively from the manager preview modal (`edit_preview_recipe.js:214,257`) and `/recipe/:id` has no owner Edit button at all — only `#suggest-edit-btn`.

The moment this slice gives an owner a working Edit action, the cheapest implementation reuses that component, and **two of the three rows in the ownership-states table start failing**: an owner editing their own `private` or `pending` recipe submits `approved: true` against a document where it is `false`, which Slice 0.2's `transitionOk()` guard correctly rejects. The result is a 403 on the owner's own recipe. (The public row survives by accident — `approved` is already `true`, so the guard's equality holds.)

The component must become context-aware — omit `approved` from the payload entirely for owner-initiated saves, letting Firestore's merge semantics leave it untouched — before any non-manager Edit path is wired. The plan previously scheduled this file for Stage 4, which is far too late.

The gate is therefore an **entry** gate, not a content-integrity gate: we vet what enters the corpus, authors stay responsible for their own content, and `recipe_edit_suggestions` handles what it was built for — _strangers_ proposing changes to someone else's recipe.

Reasoning:

- **Locking owners out creates a trap.** A manager can approve a stranger's suggestion onto your recipe. Without direct write, the author's only recourse for a bad approved edit is to file a suggestion against their own work and wait in the same queue.
- **A field-split (text queued, images direct) was considered and rejected** — it has the risk backwards. Images are the higher-risk vandalism vector and already have their own moderation flow (`RecipeImageProposalService`); text is the lower-risk one. The split would gate the safe fields and expose the dangerous one.
- **What changes in the new model is volume, not mechanism.** Publishing becomes a first-class flow, so more users will own public recipes. The real question is at what scale post-moderation stops being adequate — not soon, at this app's size.

**This is the only decision in the plan that is reversible for free.** It lives entirely in `firestore.rules` plus one UI toggle: no schema change, no migration, no backfill. If the corpus grows or something goes wrong, tightening to queue-only for public recipes is an afternoon's work. Everything else decided here (the lifecycle field, the visibility states, the `card` denormalisation) carries migration cost if revisited.

Optional follow-on, not required to ship: a manager dashboard feed of recently-edited public recipes, ordered by `lastEditedAt`, giving post-hoc visibility without pre-moderation friction.

### Slice 3.5 — Account deletion stops orphaning recipes

Implements the policy under "Account deletion splits along a personal-data line": a Cloud Function on user deletion hard-deletes private/pending recipes, the collection subcollection, and overlays, and reassigns public recipes to the house account. Scheduled here rather than deferred, because Stage 1 makes the existing orphan bug materially worse — a deleted user's private recipes become permanently ownerless documents nobody but a manager can even see.

---

## Stage 4 — Flip the emphasis 📋

**The read paths and the read rule must switch in the same deploy** — that is the whole reason Stage 0 left the rule keyed to `approved`. Flipping one without the other reproduces exactly the outage described in Slice 0.2, in either direction.

- Indexes first, in their own commit, and confirmed built before anything else lands: a `visibility`-keyed equivalent of the existing `approved ASC, creationTime DESC, __name__ DESC` entry. Index builds are asynchronous and a query against an unbuilt index fails at runtime.

#### There is no atomic deploy — use a bridge rule

An earlier draft said the read paths and the read rule ship "together in one deploy". **No such thing exists in this repo.** App code ships via Netlify on a push to `main` (`CLAUDE.md:136`); rules ship via a separate, manually-invoked `firebase deploy --only firestore:rules` (`CLAUDE.md:143`). Two pipelines, no atomicity between them — and a live SPA does not force-reload open tabs, so some clients keep running the old bundle after either side lands.

Whichever side goes first, the lagging side breaks, for exactly the reason Slice 0.2 exists:

- Rules flip to `visibility` while clients still query `approved` → not provable → broken for anyone on a stale bundle.
- App code flips to `visibility` while rules still gate `approved` → not provable → broken immediately for everyone who receives the new bundle.

So the rule widens before it narrows:

```js
// PHASE 1 — bridge. Provable against BOTH the old and new queries.
allow read: if resource.data.approved == true
            || resource.data.visibility == 'public'
            || isOwner(resource.data.userId) || isManager();
```

1. **Indexes**, in their own commit, confirmed built before anything queries them — index builds are asynchronous and a query against an unbuilt index fails at runtime.
2. **Deploy the bridge rule.** Safe on its own: the `approved` disjunct still exactly matches every live query, so nothing regresses.
3. **Ship the read-path switch** to `visibility == 'public'`: `home-page.js:52`, `categories-page.js:210`, `header-search-bar.js:164`, `recipe-related-field.js:192`, `ai-image-enhancer.js:70`, `manager-dashboard-page.js:340`, the pending-images client filter at `manager-dashboard-page.js:734` (`recipe.approved === true` — dropping the field would silently empty the image-enhancement queue), and the related-recipes filter at `recipe_component.js:1269` (`fetched.filter(r => r && r.approved)`). Safe under the bridge, whichever bundle a client is running.
4. **Wait out the stale-client window**, then tighten the rule to `visibility`-only.
5. **Only then** drop the `approved` field and the parallel writes in `edit_recipe_component.js:69` and `recipe_preview_modal.js:267`.

The bridge is also what preserves the "rollback is a rules-only revert" property. Without it, reverting the rule does not un-break clients that already received the new JS bundle.

- מתכונים renamed to כל המתכונים; the מועדפים tab is already gone since Slice 1.3 — here `/categories?favorites=true` is redirected to `/my-recipes` and the `FavoritesService` shim deleted.

---

## User lists 🔮 (later)

Purely additive on top of Stage 1:

```
collections/{collectionId}              ← top-level, NOT users/{uid}/lists/*
  ownerId: uid
  name, icon?, order, createdAt

collections/{collectionId}/items/{recipeId}
  addedAt, addedBy
```

**Deliberately top-level, and membership deliberately lives under the list rather than on the user's entry** — both purely so shared collections stay reachable later. See below; the cost today is zero.

Adding this costs one collection, one subcollection, and one rules block — **and zero migration**, because nothing in Stage 1 references lists at all. The only prerequisite is that Stage 1 shipped the rail rather than a two-tab toggle.

---

## Shared collections 🔮 (later) — what this design costs

Reviewed explicitly, because it is the most likely next feature after user lists. Verdict: **two-thirds free, one-third genuinely hard — and the hard part is not in the collection model.**

### Free, because the personal layer is already per-user

`state`, `notes`, and `servingsOverride` live on `users/{uid}/collection/{recipeId}` and are **correct as designed even for shared lists**. Alice having cooked something and Bob not having cooked it are both true at once; Alice's serving override is not Bob's. A shared collection does not want these shared, so the personal overlay needs no change at all.

### Free only if the two shapes above are adopted now

Two things in the original sketch would have made sharing expensive, and both are avoided above at no present cost:

- **`users/{uid}/lists/{listId}` bakes single-ownership into the path.** A shared list has no single owner, and Firestore rules under `users/{uid}/**` naturally reduce to `isOwner(uid)`. Making that list readable by a second user means moving the document — a migration. Top-level `collections/{cid}` with an `ownerId` field costs the same today and adds a `members` map later.
- **`collectionIds: string[]` on the personal entry puts membership on the wrong side.** It answers "which of _my_ lists is this recipe in", which is private to that user by construction. If Alice adds a recipe to a shared list, the membership fact would be buried in Alice's subcollection where Bob cannot read it. Membership belongs to the list: `collections/{cid}/items/{recipeId}`.

With those two shapes, sharing a list is additive again — add `members: { uid: 'editor' | 'viewer' }` to the collection doc and widen its rules.

### The genuinely hard part: recipe visibility has no "shared with these people" state

`visibility` is `private | pending | public`. A shared collection containing Alice's **private** recipe is incoherent under that enum: the Stage 0 read rule gates on `visibility == 'public' || isOwner || isManager`, so Bob sees a hole where the recipe should be. Sharing a collection implies sharing its contents, and the model has no way to express that.

Two ways out, neither free:

1. **Restrict shared collections to public recipes.** A shared collection is a curated list drawn from the shared corpus. Coherent, needs no schema change, and is probably most of the value — a family curating "מתכונים לפסח" from recipes that already exist publicly.
2. **Add a `sharedWith: uid[]` array to the recipe** and widen the read rule with `resource.data.sharedWith.hasAny([request.auth.uid])`. Workable — rules and queries both support array-contains — but it makes "recipes I can see" a three-way OR (public / mine / shared-with-me), which Firestore still cannot express in one query. Every read path pays for it.

**Recommendation: option 1 when the time comes.** It preserves the invariant that private means private, and it sidesteps the OR problem entirely. Option 2 stays available if genuinely needed.

### Also worth knowing

The denormalised `card` map would need to live on `collections/{cid}/items/{recipeId}` too, so the shared list renders without every member reading every recipe. Same trick, same staleness trade-off.

---

## Constraints this model buys

- **No unified feed.** "Recipes I can see" is `visibility == 'public'` OR `userId == me`, and Firestore cannot OR across two fields in one query. Two queries merged client-side, or two distinct surfaces. The staged plan keeps them distinct, but this forecloses a single blended list later without denormalisation.
- **The collection grid must render from the entry alone.** The subcollection stores IDs, so a naive implementation costs one `get` per recipe (with `in` queries capped at 30, a 200-recipe collection would be 7 round trips). The denormalised `card` map removes this entirely — listing becomes one paginated subcollection query and **zero recipe reads** — but only if `card` carries everything the grid needs. It goes stale when the source recipe changes; refresh on open, accept staleness in the grid. **Add it in Stage 1**; retrofitting means another backfill. There is consequently no need for a collection size cap.
- **Auth becomes mandatory for the core loop.** `propose_recipe_component.js:75` currently accepts `uploadedBy: 'anonymous'`; a personal collection has nowhere to put an anonymous recipe.
- **Private images are not actually private.** `storage.rules` allows public read on `img/recipes/**`. Recipe IDs are random 20-character Firestore IDs, so a private recipe's images are protected by obscurity, not by rules. Making this real means owner-scoped Storage paths plus a file migration on publish — the `migrateFilesToCategory` machinery is the precedent. Deferred, but consciously. (The _write_ side — any signed-in user deleting or replacing any recipe's images — is not deferred: Slice 0.3 closes it.)
- **AI capture is a trusted-user feature.** `extractRecipeFromImage/Url/Video` are gated to `approved` + `manager` (`functions/index.js:61,135,164`) and stay that way. Plain signed-in users build their collection through the manual form. This gives the `approved` role a coherent job beyond gating grandma's cookbook (`documents-page.js:63`).

## Lifecycle edge cases (decided)

### Publication is one-way

There is no user-facing unpublish. Once a recipe is public it stays public; the owner cannot pull it back, because other users may have saved and cooked from it. Managers retain delete/takedown via the existing manager-only `delete` rule.

The visibility transition guard (Stage 0.2) already enforces this — an owner can only move `private ↔ pending`, never out of `public`.

### A removed recipe leaves a tombstone, not a hole

When a manager deletes a public recipe, every collection entry pointing at it becomes a dangling reference. The denormalised `card` map — added for read performance — solves this for free: the entry carries its own name, category, and image, so it renders as a dismissible tombstone ("המתכון אינו זמין עוד") rather than a broken tile or a silent disappearance. No cleanup job, no cascade.

### Account deletion splits along a personal-data line

- **Private recipes, the collection subcollection, notes and overrides** — hard-deleted. This is the user's own data.
- **Public recipes** — ownership reassigned to a house account. Other people have saved and cooked from them; deleting would damage other users. `attribution` is a separate field from `userId`, so textual credit survives the transfer.

This must run as a **Cloud Function** on user deletion, not a client-side cascade — a user closing the tab mid-delete would leave exactly the orphan state the policy exists to prevent. Note a latent version of this bug already exists: `user-profile.js:602` → `auth-controller.js:229` → `auth-service.js:406` → `UserService.delete` lets a user delete their own doc while recipe deletion is manager-only, so recipes already outlive their authors. Scheduled as Slice 3.5, not deferred.

## Open product questions (decide in or out)

- **Search does not scale with the corpus.** `header-search-bar.js:162` loads every public recipe client-side to power search. Pre-existing and out of scope here, but personal collections grow the corpus and bring the ceiling closer. Worth its own issue.
- **Forking.** The schema reserves `sourceRecipeId`, but no UI is planned in Stages 0–4. Decide whether a true private copy is ever needed once the `notes` / `servingsOverride` overlay is in real use — it may not be.
