# Feature Plan: Suggest an Edit (with manager approval)

## Context

Today only managers can edit a recipe (`firestore.rules` recipes `update` rule; all editing UI lives behind `/dashboard`). Regular signed-in users can _propose a new recipe_ and _suggest images_, but cannot suggest a correction to an existing recipe (a typo in an ingredient, a missing step, a better attribution).

This feature adds a **"Suggest an Edit"** action on the recipe detail page. A signed-in user submits proposed changes; the change does **not** touch the live recipe — it lands in a moderation queue (`recipe_edit_suggestions` collection) that managers review and approve/reject from the dashboard. The implementation mirrors the existing image-proposal moderation pattern (`RecipeImageProposalService` → dashboard section → approve/reject).

Confirmed product decisions:

- **Storage:** a new `recipe_edit_suggestions` collection (one doc per suggestion) — keeps the publicly-read recipe doc lean, gives an audit trail.
- **Scope:** all editable fields, including images/media.
- **Who can suggest:** any signed-in user (`isAuthenticated()`), matching the propose-recipe flow.
- **Review model (phased):** **start preview-only** — manager sees a clean diff and Approve/Reject, applying the suggestion as-is. **Editing the suggestion before applying is a later milestone.**

## Working principles

- **Vertical slices.** Every slice is a thin top-to-bottom cut that is **manually testable in the UI** (or, for Slice 1, verifiable in the Firestore console). Foundation code (pure utils, service methods) ships _with_ the first UI that uses it, not as standalone PRs.
- **Always shippable.** After each slice the app builds, tests pass (`npm run lint && npm run test && npm run build`), and there's a concrete thing to click.
- One slice = one focused PR/commit.

---

## Milestone 1 — Suggest + preview-only review (complete core loop)

### Slice 1 — Suggest an edit & confirm it persists

The whole "create" path, nothing more.

- **Build:**
  - `firestore.rules`: add the `recipe_edit_suggestions` match block (author-only `pending` create; manager-only update; read = manager or author; delete = manager or author-of-pending). **Deploy required** for non-managers to write.
  - `RecipeEditSuggestionService.create({ recipeId, suggestedBy, proposedChanges, mediaItemsOrdered, note })` — owns the collection; uploads any new image/media files to Storage (mirrors `RecipeImageProposalService`) and records `storagePaths[]` for cleanup; writes `status: 'pending'`. (+ unit tests, + `docs/architecture/services.md` rows.)
  - `suggest-edit-modal` component — wraps `recipe-form-component` seeded via the existing `setRecipeData(recipeId)`; on submit calls the service; fires `edit-suggested`.
  - Recipe detail page: dropdown menu item "הצע עריכה" (auth-gated) + `<suggest-edit-modal>` + success toast.
- **Manual test:** log in → open a recipe → "הצע עריכה" → change the title → submit → see "נשלח לאישור". Confirm a `recipe_edit_suggestions` doc with `status: pending` in the Firestore console, **and the live recipe unchanged.**
- **No `recipe-form-component` changes** in this slice.

### Slice 2 — Manager review loop (display-only diff + Approve/Reject)

The minimum review UI that closes the round-trip.

- **Build:**
  - `recipe-diff-utils.js` (pure) — at minimum a field-level `diffRecipe(current, proposed)` for a basic readable diff; includes the ingredient-normalization fix (ingredients are `{amount,unit,item}` objects → render as readable strings, compare by value, no `[object Object]`/false positives). (+ unit tests.)
  - `buildApplyPayload(current, proposed)` (pure helper) — builds the `RecipeService.update` payload from stored `proposedChanges`: tags kept images `source:'existing'`, computes `imagesToDelete`/`mediaToDelete` vs the live recipe. (+ unit tests.)
  - `RecipeEditSuggestionService.listPending() / approve() / reject()`.
  - Dashboard: `#pending-edits` section + `loadPendingEdits` + `DASHBOARD_SECTIONS.PENDING_EDITS` in `dashboard-refresh-manager.js`.
  - `edit-suggestion-review` component (**display-only**): shows the diff with **Approve** (applies `proposedChanges` via `RecipeService.update`, then stamps the suggestion approved) and **Reject** (with optional reason).
- **Manual test:** as manager, `/dashboard` → "הצעות עריכה ממתינות" → open the suggestion from Slice 1 → **Approve** → the recipe shows the new title and the suggestion leaves the queue. Repeat → **Reject** with a reason → dropped.
- ✅ **Feature is fully usable and demoable here.** Everything below is display polish.

### Slice 3 — Readable content diff (code-diff)

- **Build:** unified git-style line diff for recipe content (ingredients / instructions / comments). Add `recipeToLines`, `diffLines`, `diffRecipeLines` to the util; render context + red `−` / green `+` lines. Bullets carry no index prefix (inserting one item doesn't renumber the rest). (+ unit tests.)
- **Manual test:** suggest adding one ingredient and rewording a step → review shows one `+` line and a `−`/`+` pair, rest as context, no `[object Object]`.

### Slice 4 — Metadata side by side

- **Build:** `recipeMetaDiff(current, proposed)` (per-field, category mapped to its label, proposal-omitted fields treated as unchanged); render each scalar field on its own row as `old → new` (old red/struck, new green); the code-diff becomes content-only. (+ unit tests.)
- **Manual test:** suggest a category + servings change → each field on its own row.

### Slice 5 — Image / media thumbnails

- **Build:** `diffImages` / `diffMedia` (pure, matched by id / path) + a thumbnail renderer in the review modal — separate "removed" (red ring) and "added" (green ring) groups for images and for media instructions (videos as `<video controls>`); a "primary image updated" note when only the primary flag moves. Replaces any count summary. (+ unit tests.)
- **Manual test:** suggest swapping the primary photo and adding a step video → review shows the removed image (red) and the new image/video (green) as thumbnails.

**End of Milestone 1:** users suggest edits; managers review (clean metadata + content + media diff) and approve/reject. No in-review editing.

---

## Milestone 2 — Edit before apply

### Slice 6 — Editable review

- **Build:** `recipe-form-component.setRecipeDataObject(data)` (seed the form from an in-memory object + re-baseline). Add a **preview/edit toggle** to `edit-suggestion-review`; edit mode mounts `recipe-form-component` seeded with the suggested state. Approve now applies the **form's collected data** (replacing Slice 2's direct apply for the edit case), recomputing `imagesToDelete`/`mediaToDelete` against the live recipe.
- **Manual test:** open a suggestion → toggle to edit → change a value the suggester didn't → Approve → the tweak landed on the recipe.

### Slice 7 — Live re-diff on toggle

- **Build:** `collectProposed()` derives the proposed side from the form's current state; toggling back to preview recomputes the whole diff (metadata, content, thumbnails) so manager edits are reflected.
- **Manual test:** edit a field in edit mode → toggle to "תצוגת שינויים" → the diff reflects the edit.

---

## Cross-cutting notes

- **Security (Slice 1 rules):** the separate collection is what makes the approval gate real — the recipes `update` rule already lets an owner write their own doc, so suggestions must live where a normal user cannot self-approve. Rules deploy (`firebase deploy --only firestore:rules`) is an outward, hard-to-reverse action and will be confirmed before running. `storage.rules` already permits authenticated recipe-image/media uploads — no change needed.
- **Concurrent suggestions** on the same recipe apply last-write-wins via the manager action; acceptable at current scale.
- **New-image thumbnails** resolve once the Storage Resize extension generates the WebP variant; `getOptimizedUrl` falls back to the original meanwhile.
- A full prior implementation of all seven slices exists as a backup patch at `/tmp/suggest-edit-feature.patch` (not committed) and can be mined per-slice.
