# Feature Plan: Suggest an Edit (with manager approval)

## Context

Today only managers can edit a recipe (`firestore.rules` recipes `update` rule; all editing UI lives behind `/dashboard`). Regular signed-in users can _propose a new recipe_ and _suggest images_, but cannot suggest a correction to an existing recipe (a typo in an ingredient, a missing step, a better attribution).

This feature adds a **"Suggest an Edit"** action on the recipe detail page. A signed-in user submits proposed changes; the change does **not** touch the live recipe — it lands in a moderation queue (`recipe_edit_suggestions` collection) that managers review and approve/reject from the dashboard. The implementation mirrors the existing image-proposal moderation pattern (`RecipeImageProposalService` → dashboard section → approve/reject).

Confirmed product decisions:

- **Storage:** a new `recipe_edit_suggestions` collection (one doc per suggestion) — keeps the publicly-read recipe doc lean, gives an audit trail.
- **Scope:** all editable fields, including images/media.
- **Who can suggest:** any signed-in user (`isAuthenticated()`), matching the propose-recipe flow.
- **Review model (phased):** **preview-only first** — the manager sees a full-recipe diff and Approve/Reject, applying the suggestion as-is. **Editing the suggestion before applying is Milestone 2.**

## Working principles

- **Vertical slices.** Every slice is a thin top-to-bottom cut that is **manually testable in the UI** (or, for Slice 1, verifiable in the Firestore console). Foundation code (pure utils, service methods) ships _with_ the first UI that uses it.
- **Always shippable.** After each slice the app builds, tests pass (`npm run lint && npm run test && npm run build`), and there's a concrete thing to click.
- One slice ≈ one focused commit; the pre-commit hook (format/lint/test/build/visual) must stay green.

## Status (branch `feat/suggest-edit-approval`)

| Slice | What                                                       | State        |
| ----- | ---------------------------------------------------------- | ------------ |
| 1     | Suggest → persist (create path)                            | ✅ committed |
| 2     | Manager review loop (approve/reject)                       | ✅ committed |
| 3     | Full-recipe contextual diff view (subsumes old slices 3–5) | ✅ committed |
| M2    | Edit-before-apply                                          | ⏳ deferred  |

Remaining to ship Milestone 1: deploy `firestore.rules` to **production** (staging done), then open the PR → `development`.

---

## Milestone 1 — Suggest + preview-only review ✅

### Slice 1 — Suggest an edit & confirm it persists ✅

The whole "create" path.

- `firestore.rules`: `recipe_edit_suggestions` match block (author-only `pending` create; manager-only update; read = manager or author; delete = manager or author-of-pending).
- `RecipeEditSuggestionService.create({ recipeId, suggestedBy, proposedChanges, mediaItemsOrdered, note })` — owns the collection; uploads new image/media files to Storage (mirrors `RecipeImageProposalService`) and records `storagePaths[]` for cleanup; writes `status: 'pending'`. New images upload **non-primary** (unique filename) so they never overwrite the live `primary.jpg`, and under the recipe's **current** category.
- `suggest-edit-modal` — wraps `recipe-form-component` (seeded via `setRecipeData(recipeId)`); resets the form on open/close so reopening doesn't duplicate images; submits to the service; fires `edit-suggested`.
- Recipe detail page: auth-gated "הצע עריכה" dropdown item + `<suggest-edit-modal>` + success toast.

### Slice 2 — Manager review loop (approve / reject) ✅

- `buildApplyPayload(current, proposed)` (pure) — builds the `RecipeService.update` args from stored `proposedChanges`: tags kept images `source:'existing'`, computes `imagesToDelete` / `mediaToDelete` vs the live recipe. Approval always writes through **`RecipeService.update`** (single doc owner).
- `RecipeEditSuggestionService.listPending() / get() / approve() / reject()`. Reject deletes the suggestion's `storagePaths` (images via `RecipeImageService.deleteFiles`, media via `MediaInstructionService.delete`) and stamps the doc.
- Dashboard: `#pending-edits` section + `loadPendingEdits` + `reviewSuggestion` + `DASHBOARD_SECTIONS.PENDING_EDITS` in `dashboard-refresh-manager.js`.
- `edit-suggestion-review` component (display-only): header + Approve / Reject, body delegated to the diff view (Slice 3).

### Slice 3 — Full-recipe contextual diff view ✅ (replaces the originally-planned slices 3–5)

The review renders the **whole recipe in the recipe-display visual language**, with changes highlighted in context — chosen over a field-by-field or git-text diff so a manager sees ingredient/instruction changes in place plus real image rendering.

- `recipe-diff-utils.buildRecipeDiffModel(current, proposed)` (pure) — one structured model:
  - **metadata** rows (name, description, category, difficulty, mainIngredient, prep/wait time with `דק׳`, servings with `servingsUnit`, tags joined, attribution) with `before`/`after`/`changed`;
  - **ingredients / instructions / comments** as LCS line ops carrying display-shaped items, with **section/stage headers preserved as context anchors** (so a brand-new section/stage is marked added, and only the changed line diffs);
  - **images / media / related** split into kept / added / removed (images also flag `primaryChanged`; media also detects **caption-only changes**).
  - `buildApplyPayload` lives here too.
- `suggestion-diff-view` component — renders the model RTL: metadata rows (`before ← after`, LTR arrow), real image/media thumbnails (added green / removed red / caption-changed neutral), inline `+/−` content with marked headers, related recipes as read-only `recipe-card`s (by name). Ingredient lines show **amount · unit · item** LTR inside an otherwise-RTL row.
- `edit-suggestion-review` renders `<suggestion-diff-view>` in its body.

**Fixes landed during M1** (each its own commit): suggestion images never clobber the live `primary.jpg`; category change no longer deletes images during migration (`migrateFilesToCategory` no-ops when source === target; suggestion images upload under the current category); a suggestion can clear **all** media (store `mediaInstructions` even when empty). The now-unused `diffRecipe` was removed after Slice 3.

**End of Milestone 1:** users suggest edits; managers review a full contextual diff and approve/reject. No in-review editing.

---

## Milestone 2 — Edit before apply ⏳ (deferred)

### Slice 6 — Editable review

- `recipe-form-component.setRecipeDataObject(data)` (seed the form from an in-memory object + re-baseline). Add a **preview/edit toggle** to `edit-suggestion-review`; edit mode mounts `recipe-form-component` seeded with the suggested state. Approve then applies the **form's collected data** (replacing the direct apply for the edited case), recomputing `imagesToDelete` / `mediaToDelete` against the live recipe.

### Slice 7 — Live re-diff on toggle

- Derive the proposed side from the form's current state so toggling back to preview recomputes the whole diff (metadata, content, thumbnails) and reflects manager edits.

---

## Cross-cutting notes

- **Security (Slice 1 rules):** the separate collection is what makes the approval gate real — the recipes `update` rule already lets an owner write their own doc, so suggestions must live where a normal user cannot self-approve. The new rules are deployed to **staging**; **production deploy is still pending** (`firebase deploy --only firestore:rules`, an outward, hard-to-reverse action — confirm before running). `storage.rules` already permits authenticated recipe-image/media uploads — no change needed.
- **Concurrent suggestions** on the same recipe apply last-write-wins via the manager action; acceptable at current scale.
- **New-image thumbnails** resolve once the Storage Resize extension generates the WebP variant; `getOptimizedUrl` falls back to the original meanwhile.
- **Reordering** media instructions is intentionally not surfaced in the diff (only add / remove / caption change).

## Open product questions (decide in or out)

- **Suggester-facing status** — a user can't yet see whether their suggestion was approved/rejected (rules allow them to read their own; no UI). No rejection reason is captured.
- **Manager notification** on a new pending suggestion (like pending recipes).
- **Duplicate-suggestion handling** — one user can file many pending suggestions on the same recipe; no dedupe/limit.
