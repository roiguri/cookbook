# NLSpec 09 — Manager Dashboard & Administration

- **Wave:** 3 (Parallel Advanced)
- **Depends On:** Slices `03`, `04`, `06`
- **Web Semport Oracles:** `src/app/pages/manager-dashboard-page.js`, `src/lib/recipes/{recipe_preview_modal/*,suggest_edit_modal/*}`, `src/lib/media/ai-image-enhancer/*`, `src/lib/admin/api-tokens/*`, `src/js/services/admin/*`, `src/js/services/recipes/{recipe-submission-service,recipe-edit-suggestion-service,recipe-image-proposal-service}.js`, `functions/index.js`

## 1. User Intent

Family managers administer the entire cookbook from a clean, mobile-friendly **לוח בקרה למנהלים** (`/dashboard`) with collapsible sections and attention count badges: reviewing & approving/rejecting submitted recipes, diff-reviewing & applying edit suggestions (including promoting staged media), moderating proposed photos, enhancing food photos with Gemini AI, managing user roles, cleaning up failed URL extraction logs, issuing/revoking Recipe API tokens, and toggling manager push notifications.

## 2. Behavioral Contract

1. **Strict Manager Gate (`app/(tabs)/dashboard.tsx`):**
   - Accessible ONLY when `role === 'manager'`. Guests, `user`, and `approved` accounts are immediately redirected to `/home`.
   - Displays a master refresh button + collapsible mobile accordion sections, each showing a live count badge (highlighted in caution/red when pending items > 0).
   - Displays the Push Notification opt-in banner (`הפעלת התראות על מתכונים חדשים`) wired to Slice `11`.
2. **Submission Approval Queue (`מתכונים ממתינים לאישור`):**
   - Lists all `recipe_submissions` with `status === 'pending'` alongside recipe metadata and author name.
   - Actions per item: `תצוגה מקדימה`, `עריכה`, `אישור ופרסום` (updates `recipes/{id}.visibility = 'published'` and `recipe_submissions/{id}.status = 'approved'`, `reviewedBy`, `reviewedAt`), and `דחייה`.
   - **Mandatory Rejection Reason (P0):** Tapping `דחייה` opens a modal with a required Hebrew reason input (`סיבת הדחייה`); the confirm button stays disabled / shows validation error while trimmed reason is empty (also enforced by `firestore.rules`). Submitting writes `{ status: 'rejected', rejectionReason, reviewedBy: uid, reviewedAt }`.
3. **Edit Suggestion Diff Review (`הצעות עריכה`):**
   - Lists pending `recipe_edit_suggestions`.
   - Opening an item displays a clear Hebrew field-by-field before/after diff (`@cookbook/core/recipe-utils/recipe-diff-utils`).
   - **Approve:** If `storagePaths.length > 0`, calls `promoteSuggestionFiles({ suggestionId })` Cloud Function FIRST to copy & re-tag staged files into `recipes/{recipeId}/...`, repoints paths in `proposedChanges`, updates `recipes/{recipeId}`, and marks suggestion `approved`.
   - **Reject:** Marks suggestion `rejected` and cleans up staged files if needed.
4. **Pending Photo Proposals (`תמונות ממתינות לאישור`):**
   - Lists recipes with `pendingImages[]` via `RecipeImageProposalService.listPending()`.
   - Manager can approve (moves photo into live `images[]`) or reject (removes from `pendingImages[]` and deletes Storage file).
5. **User Role Management (`ניהול משתמשים`):**
   - Lists all `users` with search input and role selector (`user` / `approved` / `manager`) calling `UserService.update(targetUid, { role })`.
   - Guards against demoting oneself accidentally without confirmation.
6. **AI Food Image Enhancer (`שיפור תמונות ב-AI`):**
   - Allows selecting a recipe image, configuring enhancement parameter axes matching `PARAMETER_TAXONOMY` in `functions/utils/gemini-service.js` + optional custom Hebrew/English instruction (`<= 500` chars), calling `enhanceFoodImage` callable, viewing a side-by-side / toggle before-and-after preview, and saving/replacing the recipe photo (`RecipeService.replaceImage`).
7. **Failed URL Extractions Queue (`ייבואים שנכשלו`):**
   - Lists `failed_url_extractions` docs showing URL, `kind` (`url`/`video`), `count`, error message, and last attempt timestamp; manager can dismiss/delete resolved entries.
8. **Recipe API Token Management (`מפתחות API`):**
   - Calls `listApiTokens` to list active tokens (name, owner, scope `read`/`write`, prefix/createdAt — never full hash/secret).
   - **Create Token:** Manager selects an `approved`/`manager` user, enters token name, picks scope (`read` / `write`), calls `createApiToken`. Opens a dedicated **one-time secret modal** displaying the plaintext token with `העתק מפתח` copy button and warning (`המפתח מוצג פעם אחת בלבד`). Never persists the plaintext secret anywhere on device or in Sentry.
   - **Revoke Token:** Confirmation modal → calls `revokeApiToken({ tokenId })` → removes token immediately.

## 3. Required `testID` Contracts

- `dashboard-screen`, `dashboard-refresh-btn`, `dashboard-push-banner`, `dashboard-push-enable-btn`
- `dashboard-section-submissions`, `dashboard-section-suggestions`, `dashboard-section-photos`, `dashboard-section-users`, `dashboard-section-enhancer`, `dashboard-section-failed-urls`, `dashboard-section-api-tokens`
- `submission-item-<recipeId>`, `submission-approve-<recipeId>`, `submission-reject-<recipeId>`, `reject-reason-input`, `reject-confirm-btn`, `reject-validation-error`
- `suggestion-item-<id>`, `suggestion-review-modal`, `suggestion-approve-btn`, `suggestion-reject-btn`
- `user-row-<uid>`, `user-role-select-<uid>`, `user-role-option-<role>`
- `enhancer-modal`, `enhancer-instruction-input`, `enhancer-run-btn`, `enhancer-before-after`, `enhancer-apply-btn`
- `failed-url-item-<id>`, `failed-url-delete-<id>`
- `api-token-create-btn`, `api-token-name-input`, `api-token-scope-read`, `api-token-scope-write`, `api-token-submit-btn`, `api-token-secret-modal`, `api-token-secret-value`, `api-token-copy-btn`, `api-token-revoke-<id>`

## 4. Acceptance & Edge Cases

- **P0:** Non-managers (`guest`, `user`, `approved`) can never view or mutate any dashboard section.
- **P0:** Rejecting a submission with an empty or whitespace-only reason is blocked in UI and never sends an invalid Firestore write.
- **P0:** Plaintext API token is shown strictly once in `api-token-secret-modal` and never written to Firestore, AsyncStorage, or Sentry.
- Approving `dtu-sub-pending` flips `recipes/dtu-sub-pending.visibility` to `'published'` and `recipe_submissions/dtu-sub-pending.status` to `'approved'`.
