# NLSpec 04 — My Recipes (הספרייה שלי), Submissions Lifecycle & Family Sharing

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/my-recipes-page.js`, `src/js/services/recipes/{recipe-submission-service.js,recipe-share-service.js}`, `src/lib/recipes/{share-family-modal/share-family-modal.js,rejection-note/rejection-note.js,status-badge/status-badge.js}`, `packages/cookbook-core/recipe-utils/{library-views.js,recipe-status.js}`, `firestore.rules` (`shares`, `recipe_submissions`), `functions/index.js` (`listFamilyMembers`)

## 1. User Intent

Signed-in users manage all personal recipes in **הספרייה שלי** across 5 scope views (`הכל`, `שלי`, `שמורים`, `שותפו איתי`, `לנסות`). Approved family members and managers can share private recipes live with other approved family members (and revoke access anytime), view manager rejection feedback and resubmit edited recipes, mark to-try recipes as tested, and delete private drafts.

## 2. Behavioral Contract

1. **Library Views (`app/(tabs)/my-recipes.tsx`):**
   - Uses `@cookbook/core` `buildLibraryViews(mine, saved, shared)` verbatim to compute all 5 lists and chip counts:
     - `all` (`הכל`), `mine` (`שלי`), `saved` (`שמורים`), `shared` (`שותפו איתי` — shown when count > 0 or active), `to-try` (`לנסות`).
   - Plain `user` accounts have no personal private library and see only their `saved` recipes (scope chips and `+ מתכון חדש` CTA hidden, matching web `my-recipes-page.js`).
   - Supports category & text filtering inside the current view, plus per-view Hebrew lede and empty states matching `src/app/pages/my-recipes-page.js`.
   - In `to-try` view, cards display a quick `סמן כנבדק` action (`RecipeService.markTested(id)`).
2. **Status Badges & Rejection Notes:**
   - Displays status badges derived from `@cookbook/core/recipe-utils/recipe-status`: `פרטי`, `לנסות`, `ממתין לאישור`, `נדחה`, `פורסם`, and `שותף על ידי <authorName>` for shared recipes.
   - Rejected submissions (`recipe_submissions/{id}.status === 'rejected'`) show the manager's `rejectionReason` prominently in a red/caution banner on the recipe detail screen and allow the author to edit the recipe and tap `שליחה מחדש לאישור` (updating ONLY `['status', 'resubmittedAt']` to `'pending'` + `serverTimestamp()` per `firestore.rules`, triggering `onRecipeResubmitted`).
   - Authors can also submit an unsubmitted private recipe to the family book (`RecipeSubmissionService.submit(recipeId, uid)` writing `submissionRecord`), or cancel a pending submission (deleting `recipe_submissions/{id}`).
3. **Share with Family (`RecipeShareService` + `ShareFamilyModal`):**
   - Only available to `approved`/`manager` authors on their own `visibility === 'private'` recipes.
   - Calls `listFamilyMembers` Cloud Function callable to populate eligible approved/manager family recipients (with their name & avatar).
   - Toggling a member ON writes `recipes/{recipeId}/shares/{recipientUid}` with exact keys `{ recipientUid, authorId: uid, authorName, sharedAt: serverTimestamp() }`.
   - Toggling a member OFF deletes `recipes/{recipeId}/shares/{recipientUid}`.
   - Recipient sees the recipe under `שותפו איתי` (via collection-group query `collectionGroup('shares').where('recipientUid', '==', uid)`) with live read-only access (including private recipe photos under `users/{authorUid}/recipes/{recipeId}/...`), and may tap `הסר מהספרייה שלי` to delete their own share record.
   - Recipients NEVER see Edit, Delete, Submit, or Share buttons on a recipe shared with them.

## 3. Required `testID` Contracts

- `my-recipes-screen`, `library-chip-all`, `library-chip-mine`, `library-chip-saved`, `library-chip-shared`, `library-chip-to-try`, `library-new-recipe-btn`, `library-empty-state`
- `card-badge-private-<id>`, `card-badge-pending-<id>`, `card-badge-rejected-<id>`, `card-badge-shared-<id>`, `card-mark-tested-<id>`
- `rejection-note-banner`, `rejection-reason-text`, `resubmit-recipe-btn`, `submit-for-approval-btn`, `cancel-submission-btn`
- `share-family-modal`, `share-family-member-<uid>`, `share-family-toggle-<uid>`, `share-family-close-btn`, `leave-shared-recipe-btn`

## 4. Acceptance & Edge Cases

- **P0:** Sharing writes exact 4 fields (`recipientUid`, `authorId`, `authorName`, `sharedAt: serverTimestamp()`), never extra keys (which `firestore.rules` rejects).
- **P0:** Revoking a share immediately removes access; recipient attempting to open `/recipe/<id>` sees access-denied/not-found cleanly.
- **P0:** Resubmission updates ONLY `status` and `resubmittedAt` on `recipe_submissions/{id}`.
- Deleting a private recipe with a pending/rejected submission cleans up the submission doc + Storage files.
