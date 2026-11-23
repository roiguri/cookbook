# NLSpec 04 — My Recipes (הספרייה שלי), Submissions Lifecycle & Family Sharing

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/my-recipes-page.js`, `src/app/pages/my-recipes-page.html`, `src/app/pages/recipe-detail-page.js`, `src/app/pages/recipe-detail-page.html`, `src/js/services/recipes/recipe-submission-service.js`, `src/js/services/recipes/recipe-share-service.js`, `src/lib/recipes/share-family-modal/share-family-modal.js`, `src/lib/recipes/status-badge/status-badge.js`, `packages/cookbook-core/recipe-utils/library-views.js`, `packages/cookbook-core/recipe-utils/recipe-status.js`, `firestore.rules`, `functions/index.js`, `functions/utils/family.js`

## 1. User Intent

Signed-in users manage all personal recipes in **הספרייה שלי** across 5 scope views (`הכל`, `המתכונים שלי`, `שמרתי`, `שותפו איתי`, `לנסות`). Approved family members and managers can share private recipes live with other approved family members (batch-adding recipients or revoking existing ones), view manager rejection feedback and resubmit edited recipes, toggle `to-try` ↔ `tested`, and delete private drafts cleanly (cleaning up submissions, shares, and Storage media).

## 2. Behavioral Contract

1. **Library Views (`app/(tabs)/my-recipes.tsx`):**
   - Uses `@cookbook/core` `buildLibraryViews(mine, saved, shared)` verbatim to compute all 5 lists and chip counts:
     - `all` (`הכל`), `mine` (`המתכונים שלי`), `saved` (`שמרתי`), `shared` (`שותפו איתי` — shown when count > 0 or active), `to-try` (`לנסות`).
   - Plain `user` accounts have no personal private library and see only their `saved` recipes (scope chips and `מתכון חדש` CTA hidden; empty state links to `לספר המשפחתי` → `/categories`, matching Web `my-recipes-page.js`).
   - Supports category & text filtering inside the current view, plus per-view Hebrew lede and empty states matching `src/app/pages/my-recipes-page.js` (empty states for `saved`/`shared` link to `לספר המשפחתי`). Cards show `+` Add-to-Meal and hide duplicate heart icon in My Recipes.
   - In `to-try` view, cards display a quick `סימון כנבדק` action (`RecipeService.markTested(id)`).
2. **Status Badges, Rejection Notes & Submission Lifecycle (`RecipeSubmissionService`):**
   - Displays exact status badges from `@cookbook/core/recipe-utils/recipe-status`: `פרטי`, `לנסות`, `ממתין`, `נדחה`, `פורסם`. Card badge for shared recipes shows **`מ־<firstName>`** (fallback `שותף איתך`); detail header shows **`שותף איתך ע״י <fullName>`**.
   - Rejected submissions (`recipe_submissions/{id}.status === 'rejected'`) show `הערה ממנהלי הספר` (`rejection-note-banner`) with exact `rejectionReason` (`rejection-reason-text`) on the recipe detail screen and allow the author to edit & resubmit (`עריכה ושליחה מחדש` / `resubmit-recipe-btn` — updating ONLY `['status', 'resubmittedAt']` to `'pending'` + `serverTimestamp()` per `firestore.rules`, triggering `onRecipeResubmitted`).
   - Authors can submit an unsubmitted private recipe via `RecipeSubmissionService.submit({ recipeId, authorId })`, cancel a pending submission via `RecipeSubmissionService.cancel(recipeId)`, or toggle stage back via `RecipeService.markToTry(recipeId)` (`החזרה ל״לנסות״`).
   - Deleting a private recipe via `RecipeSubmissionService.deleteRecipe(recipeId, { authorId })` deletes the recipe + Storage media first, then best-effort withdraws any pending/rejected submission AND calls `RecipeShareService.removeAll(recipeId, authorId)`.
3. **Share with Family (`RecipeShareService` + `ShareFamilyModal` — exact 2-section Web flow):**
   - Only available to `approved`/`manager` authors on their own `visibility === 'private'` recipes.
   - Calls `listFamilyMembers` Cloud Function callable, which returns **`{ members: [{ uid, name, avatarUrl }] }`** (`name`, NOT `fullName`, omitting `role`).
   - **Section 1 — Existing Recipients (`עם גישה · N`, collapsible with avatar stack):** Lists members who already have access with share date (`שותף ב־D.M`) and an individual **`הסרה`** revoke button (`share-family-remove-<uid>`) calling `RecipeShareService.remove(recipeId, uid)`.
   - **Section 2 — Available Family (`בני משפחה · N`):** Lists remaining family members with multi-select checkboxes (`share-family-toggle-<uid>`, plus search input `חיפוש לפי שם` when `>= 8` members) and a batch submit CTA (`share-family-submit-btn`: `שיתוף` / `שיתוף עם N`) writing `recipes/{recipeId}/shares/{recipientUid}` in one batch with exact 4 keys `{ recipientUid, authorId: uid, authorName, sharedAt: serverTimestamp() }` (`authorName` non-empty fallback to `displayName` or email prefix so `firestore.rules` `1..100` check never fails).
   - **Post-Share State:** Modal stays open showing confirmation (`שותף עם <name>`), a **`שליחת קישור`** CTA, and switches Cancel (`ביטול`) to Close (`סגירה`).
   - Recipient sees the recipe under `שותפו איתי` (via `collectionGroup('shares').where('recipientUid', '==', uid)`) with live read-only access (ZERO Edit, Delete, Submit, or Share controls). _(Mobile-only enhancement permitted by `firestore.rules:237`: optional `הסר מהספרייה שלי` `leave-shared-recipe-btn` allowing a recipient to delete their own share record.)_

## 3. Required `testID` Contracts

- `my-recipes-screen`, `library-chip-all`, `library-chip-mine`, `library-chip-saved`, `library-chip-shared`, `library-chip-to-try`, `library-new-recipe-btn`, `library-empty-state`
- `card-badge-private-<id>`, `card-badge-pending-<id>`, `card-badge-rejected-<id>`, `card-badge-shared-<id>`, `card-mark-tested-<id>`
- `rejection-note-banner`, `rejection-reason-text`, `resubmit-recipe-btn`, `submit-for-approval-btn`, `cancel-submission-btn`
- `share-family-modal`, `share-family-access-section`, `share-family-member-<uid>`, `share-family-toggle-<uid>`, `share-family-remove-<uid>`, `share-family-submit-btn`, `share-family-send-link-btn`, `share-family-close-btn`, `leave-shared-recipe-btn`

## 4. Acceptance & Edge Cases

- **P0:** Sharing writes exact 4 fields (`recipientUid`, `authorId`, `authorName`, `sharedAt: serverTimestamp()`), never extra keys (which `firestore.rules` rejects).
- **P0:** Revoking a share immediately removes access; recipient attempting to open `/recipe/<id>` sees access-denied/not-found cleanly.
- **P0:** Resubmission updates ONLY `status` and `resubmittedAt` on `recipe_submissions/{id}`.
- Deleting a private recipe cleans up recipe doc, Storage files, pending/rejected submission doc, AND all share records.
