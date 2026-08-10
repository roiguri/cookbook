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
- **User-defined lists come later, additively.** The Stage 1 UI must be built so they slot in without rework.
- **AI extraction stays role-gated.** `approved` + `manager` only, unchanged. Plain signed-in users create recipes through the manual form.
- **Naming.** `/my-recipes` = **המתכונים שלי**; the shared corpus becomes **כל המתכונים**.
- **No unpublishing.** Publication is one-way for the owner. Managers retain delete/takedown.
- **Owners keep direct write on their own public recipes** (the status quo), with `lastEditedAt` stamped. See Slice 3.4.

## Working principles

- **Vertical slices.** Every slice is a thin top-to-bottom cut that is manually testable in the UI (or, for the migration slices, verifiable in the Firestore console). Foundation code ships _with_ the first UI that uses it.
- **Always shippable.** After each slice the app builds, tests pass (`npm run lint && npm run test && npm run build`), and there's a concrete thing to click.
- **The shared corpus keeps working throughout.** Until Stage 4, no existing read path changes behaviour. `approved` stays written in parallel with `visibility` so a rollback is always a rules-only revert.
- One slice ≈ one focused commit; the pre-commit hook (format/lint/test/build) must stay green.

## Status (branch `feat/personal-collections`)

| Stage | What                                           | State      |
| ----- | ---------------------------------------------- | ---------- |
| 0     | `visibility` backfill + rules lockdown         | 📋 planned |
| 1     | Personal collection page + `CollectionService` | 📋 planned |
| 2     | Save a shared recipe into your collection      | 📋 planned |
| 3     | Request → approve sharing                      | 📋 planned |
| 4     | Flip the emphasis; retire `approved` field     | 📋 planned |
| —     | User-defined lists                             | 🔮 later   |

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
  collectionIds?: string[]            ← 🔮 user lists. absent = in no list. see "User lists"
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

The cost is that the queue only drains when the user curates it. Accepted deliberately. `cookedCount` / `lastCookedAt` are **not** in the schema because nothing would populate them; they become available if `/my-meal` coupling is ever revisited.

### Why sharing needs no separate collection

`recipe_edit_suggestions` is a separate collection because its _payload_ — proposed changes to a live recipe — has nowhere to live on the recipe itself without letting a user self-apply it. A share request has no payload; the thing under review is the recipe exactly as it stands. So `visibility: 'pending'` **is** the queue: the dashboard queries `where visibility == 'pending'`, and review metadata lands in a `shareReview` map on the recipe. One fewer collection, one fewer rules block, one fewer consistency pair to keep in sync.

### Why not fork-on-publish

Image Storage paths are keyed by recipe ID — `img/recipes/{type}/{category}/{recipeId}/{fileName}` (`recipe-image-utils.js:52`). Every recipe copy costs a full re-upload of the original bytes plus regeneration of every WebP variant; `RecipeImageService.migrateCategory` exists precisely because moving these files is fiddly. Sharing a path between two recipe documents is not an option — deleting either destroys the other's images.

Since saving a shared recipe happens far more often than publishing one, that direction must be a pointer. And once it is a pointer, the `notes` / `servingsOverride` overlay covers the case forking was meant to solve ("I make it with half the sugar") without duplicating anything. True forking stays available as a rare, explicit action that pays the copy cost honestly and records `sourceRecipeId`.

### Why `userId` is not renamed to `ownerId`

`userId` already means owner in `firestore.rules` and in the recipes `update` rule. Renaming buys clarity and costs a full-collection migration plus a dual-read window in every service. Keep the field, document the meaning.

---

## The UI layer

### The IA shrinks

Today a signed-in user sees four nav tabs (דף הבית, מתכונים, הצעת מתכון, מועדפים), a manager six. In the target model:

- **מועדפים dissolves.** It becomes the lifecycle rail inside the collection page, not a top-level destination.
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

If Stage 1 ships a two-tab toggle, adding user lists later means rebuilding the page's navigation. As a rail with two pinned entries, it means appending rows to something that already exists. On mobile the rail collapses to a horizontal scroller or an `app-drawer` panel (the pattern `/my-meal` already uses).

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

Note the asymmetry: an owner sees Edit in all three states, a non-owner sees הצע עריכה. There is no unpublish action in any state.

### The overlay is nearly free

`recipe_component` already accepts an `initial-servings` attribute and scales ingredients through `scaleIngredients` (`recipe_component.js:1359-1383`). `servingsOverride` is a pass-through of a value the component already takes — no new UI. `active_meals` separately stores a per-recipe `servings` for the live session; the overlay becomes the persistent default that seeds it.

Only `notes` needs a home. `/my-meal` establishes `app-drawer` as this app's pattern for auxiliary personal content.

### Empty states are a requirement, not polish

An empty filtered list is unremarkable; an empty personal cookbook on first sign-in is the user's introduction to the entire feature. Both rail entries need designed empty states that route in both directions — browse discover to save something, or add your own.

---

## Stage 0 — `visibility` backfill + rules lockdown 📋

Ships independently, changes no user-visible behaviour, and fixes two live security bugs.

### Slice 0.1 — Backfill

- One-off script (or Cloud Function) writing `visibility` to every existing recipe: `approved: true → 'public'`, `approved: false → 'pending'`.
- Both fields written in parallel from here until Stage 4. Nothing reads `visibility` yet.

### Slice 0.2 — Rules lockdown

Two bugs exist in `firestore.rules` today and both get materially worse once private recipes exist:

- **`allow read: if true` on `recipes`.** Every unapproved proposal is world-readable by ID right now. Under a private-by-default model this is a straight leak.
- **`allow update` has no field guard.** The rule is `isManager() || (isAuthenticated() && resource.data.userId == request.auth.uid)`, so an owner can set `approved: true` on their own recipe and self-publish. The entire `recipe_edit_suggestions` design exists to prevent exactly this for edits, while the recipe document itself is open.

Target rules:

```js
allow read: if resource.data.visibility == 'public'
            || isOwner(resource.data.userId) || isManager();

allow create: if isAuthenticated()
              && request.resource.data.userId == request.auth.uid
              && request.resource.data.visibility == 'private';

// owner may move private↔pending only; manager may do anything
allow update: if isManager() || (isOwner(resource.data.userId) && transitionOk());

function transitionOk() {
  let from = resource.data.visibility;
  let to = request.resource.data.visibility;
  return request.resource.data.userId == resource.data.userId
      && (to == from
          || (from == 'private' && to == 'pending')
          || (from == 'pending' && to == 'private'));
}
```

Delete stays manager-only for public recipes (others may have saved them); owners may delete their own `private` / `pending` recipes.

**Ordering constraint:** the read gate cannot deploy before the backfill completes, or every recipe missing `visibility` becomes invisible. Backfill, verify, then deploy rules — staging first, then production (`firebase deploy --only firestore:rules --project production`; outward and hard to reverse, confirm before running).

---

## Stage 1 — Personal collection 📋

The shared corpus is untouched. The existing propose flow keeps writing `approved: false` (`propose_recipe_component.js:75`) and the dashboard queue keeps working exactly as it does now.

### Slice 1.1 — `CollectionService`

- New `src/js/services/users/collection-service.js`, sole owner of `users/{uid}/collection`. Follows the `UserService` pattern (`add`, `remove`, `get`, `list`, `setState`, `updateOverlay`).
- `firestore.rules`: `match /users/{userId}/collection/{recipeId}` — read/write only if `isOwner(userId)`. Managers deliberately excluded; a personal overlay is private.

### Slice 1.2 — Favorites migration

- `favorites` is an array on the user doc and will eventually hit the 1MB document limit. Migrate each entry to a collection document with `source: 'saved'`.
- **Migration state decision:** existing favorites migrate to `rotation`, not `to-try`. Hearting was the closest thing to endorsement the old model had; dumping a user's existing favorites into a "to try" queue would misrepresent them. This is the one exception to "everything enters at `to-try`", and it applies only to migrated data.
- `FavoritesService` keeps its current API as a shim over `CollectionService` so the favorites filter at `categories-page.js:210` does not change in this stage. The shim is temporary scaffolding, removed in Stage 4.

### Slice 1.3 — The collection page

- New route `/my-recipes` + page module. Nav item המתכונים שלי added in `auth-controller.js:updateNavigation` (alongside מועדפים, which still works — both point at the user's own data through different views).
- Router navigation guard: unauthenticated → redirect with login prompt.
- Lifecycle rail (two pinned entries), `recipe-presentation-grid` for the grid, designed empty states for both entries.
- `recipe-card` gains stamp wiring + the `--private` variant.

### Slice 1.4 — Private recipe authoring

- Recipes created from the collection page default to `visibility: 'private'`, `source: 'owned'`, `state: 'to-try'`, writing the collection entry in the same operation.
- Manual form for all signed-in users; the AI import path inside `recipe_form_component:111` stays gated to `approved` + `manager` by the existing function guards. No change to `functions/index.js`.
- Not transactional across the two writes; a failed entry write leaves an orphan private recipe. The collection view self-heals by also querying `recipes where userId == uid`.

---

## Stage 2 — Save a shared recipe 📋

One collection-entry write plus the affordance. Cheap because Stage 1 built the model, and it is what makes the collection useful _before_ any sharing flow exists.

- "Save to my collection" on `/recipe/:id` for public recipes, auth-gated like הצע עריכה. Creates the entry at `to-try`.
- The discover card's heart becomes save; the collection card's actions become lifecycle + remove.
- Overlay editing (notes, servings) on the saved entry.
- Manual graduation control: `to-try → rotation` from the card menu and the recipe detail page.

---

## Stage 3 — Request → approve sharing 📋

### Slice 3.1 — Request

- Owner action on a private recipe: `private → pending`, allowed by the Stage 0 transition guard. Withdraw is the reverse transition.

### Slice 3.2 — Manager review

- Dashboard section querying `where visibility == 'pending'` (replaces the `where approved == false` query at `manager-dashboard-page.js:503`), following the pending-edits precedent in `dashboard-refresh-manager.js`.
- Approve writes `visibility: 'public'`, `publishedAt`, and `approved: true` for parallel-write compatibility. Reject writes `visibility: 'private'` plus `shareReview.reason`.
- Reuses `recipe_preview_modal`, which already does approve/reject against a recipe document (`recipe_preview_modal.js:267`).

### Slice 3.3 — Retire the old propose path

- `/propose-recipe` and its nav item are removed; adding a recipe happens in the collection page. The `approved: false` write disappears.

### Slice 3.4 — Owner edits on public recipes: keep direct write

**Decided: the owner keeps direct write on their own public recipe** — the status quo, since `firestore.rules` already grants update on `resource.data.userId == request.auth.uid` with no approved-status condition. Add a `lastEditedAt` stamp on every write.

The gate is therefore an **entry** gate, not a content-integrity gate: we vet what enters the corpus, authors stay responsible for their own content, and `recipe_edit_suggestions` handles what it was built for — _strangers_ proposing changes to someone else's recipe.

Reasoning:

- **Locking owners out creates a trap.** A manager can approve a stranger's suggestion onto your recipe. Without direct write, the author's only recourse for a bad approved edit is to file a suggestion against their own work and wait in the same queue.
- **A field-split (text queued, images direct) was considered and rejected** — it has the risk backwards. Images are the higher-risk vandalism vector and already have their own moderation flow (`RecipeImageProposalService`); text is the lower-risk one. The split would gate the safe fields and expose the dangerous one.
- **What changes in the new model is volume, not mechanism.** Publishing becomes a first-class flow, so more users will own public recipes. The real question is at what scale post-moderation stops being adequate — not soon, at this app's size.

**This is the only decision in the plan that is reversible for free.** It lives entirely in `firestore.rules` plus one UI toggle: no schema change, no migration, no backfill. If the corpus grows or something goes wrong, tightening to queue-only for public recipes is an afternoon's work. Everything else decided here (the lifecycle field, the visibility states, the `card` denormalisation) carries migration cost if revisited.

Optional follow-on, not required to ship: a manager dashboard feed of recently-edited public recipes, ordered by `lastEditedAt`, giving post-hoc visibility without pre-moderation friction.

---

## Stage 4 — Flip the emphasis 📋

- Read paths move from `approved == true` to `visibility == 'public'`: `home-page.js:52`, `categories-page.js:210`, `header-search-bar.js:164`, `recipe-related-field.js:192`, `ai-image-enhancer.js:70`, `manager-dashboard-page.js:340`, and the related-recipes filter at `recipe_component.js:1269` (`fetched.filter(r => r && r.approved)`).
- Firestore composite indexes updated to key on `visibility` instead of `approved`.
- Drop the `approved` field and the parallel writes in `edit_recipe_component.js:69` and `recipe_preview_modal.js:267`.
- מתכונים renamed to כל המתכונים; מועדפים tab removed and `/categories?favorites=true` redirected to `/my-recipes`; the `FavoritesService` shim deleted.

---

## User lists 🔮 (later)

Purely additive on top of Stage 1:

```
users/{uid}/lists/{listId}
  name, icon?, order, createdAt
```

plus the optional `collectionIds?: string[]` on the entry. Membership queries are `where collectionIds array-contains <listId>`.

Adding this costs one subcollection, one optional array field, and one rules block — **and zero migration**, because an absent `collectionIds` already means "in no user lists". The only prerequisite is that Stage 1 shipped the rail rather than a two-tab toggle.

---

## Constraints this model buys

- **No unified feed.** "Recipes I can see" is `visibility == 'public'` OR `userId == me`, and Firestore cannot OR across two fields in one query. Two queries merged client-side, or two distinct surfaces. The staged plan keeps them distinct, but this forecloses a single blended list later without denormalisation.
- **The collection grid must render from the entry alone.** The subcollection stores IDs, so a naive implementation costs one `get` per recipe (with `in` queries capped at 30, a 200-recipe collection would be 7 round trips). The denormalised `card` map removes this entirely — listing becomes one paginated subcollection query and **zero recipe reads** — but only if `card` carries everything the grid needs. It goes stale when the source recipe changes; refresh on open, accept staleness in the grid. **Add it in Stage 1**; retrofitting means another backfill. There is consequently no need for a collection size cap.
- **Auth becomes mandatory for the core loop.** `propose_recipe_component.js:75` currently accepts `uploadedBy: 'anonymous'`; a personal collection has nowhere to put an anonymous recipe.
- **Private images are not actually private.** `storage.rules` allows public read on `img/recipes/**`. Recipe IDs are random 20-character Firestore IDs, so a private recipe's images are protected by obscurity, not by rules. Making this real means owner-scoped Storage paths plus a file migration on publish — the `migrateCategory` machinery is the precedent. Deferred, but consciously.
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

This must run as a **Cloud Function** on user deletion, not a client-side cascade — a user closing the tab mid-delete would leave exactly the orphan state the policy exists to prevent. Note a latent version of this bug already exists: `user-profile.js:597` lets a user delete their own doc while recipe deletion is manager-only, so recipes already outlive their authors.

## Open product questions (decide in or out)

- **Search does not scale with the corpus.** `header-search-bar.js:162` loads every public recipe client-side to power search. Pre-existing and out of scope here, but personal collections grow the corpus and bring the ceiling closer. Worth its own issue.
- **Forking.** The schema reserves `sourceRecipeId`, but no UI is planned in Stages 0–4. Decide whether a true private copy is ever needed once the `notes` / `servingsOverride` overlay is in real use — it may not be.
