# NLSpec 09 — Manager Dashboard & Administration

- **Wave:** 3B (Parallel Advanced — after Wave 2 `S10`, Wave 3A `S03`, and `S06`)
- **Depends On:** Slices `03`, `04`, `06`, `10`
- **Web Semport Oracles:** `src/app/pages/manager-dashboard-page.js`, `src/app/pages/manager-dashboard-page.html`, `src/lib/utilities/dashboard-refresh-manager.js`, `src/lib/recipes/recipe_preview_modal/recipe_preview_modal.js`, `src/lib/recipes/recipe_preview_modal/edit_preview_recipe.js`, `src/lib/recipes/rejection-note/rejection-note.js`, `src/lib/recipes/suggest_edit_modal/edit-suggestion-review.js`, `src/lib/recipes/suggest_edit_modal/suggestion-diff-view.js`, `src/lib/media/ai-image-enhancer/ai-image-enhancer.js`, `src/lib/media/ai-image-enhancer/ai-image-enhance-modal.js`, `src/lib/admin/api-tokens/api-token-panel.js`, `src/lib/admin/api-tokens/token-dialogs.js`, `src/js/services/recipes/recipe-service.js`, `src/js/services/recipes/recipe-image-service.js`, `src/js/services/recipes/recipe-submission-service.js`, `src/js/services/recipes/recipe-edit-suggestion-service.js`, `src/js/services/recipes/ai-enhancement-service.js`, `src/js/services/admin/api-token-service.js`, `src/js/services/admin/failed-url-extraction-service.js`, `functions/index.js`, `functions/utils/api-tokens.js`, `functions/utils/gemini/enhancement/food-image.js`

## 1. User Intent

Family managers administer the entire cookbook from a clean, mobile-friendly **ממשק ניהול** (`/dashboard`) with collapsible mobile accordion sections, attention count badges, master & per-section refresh icons, and a manager push opt-in banner: reviewing & approving/rejecting submitted recipes (dual-mode for family vs plain users), diff-reviewing & applying edit suggestions (promoting staged files and superseding duplicates), managing/editing/deleting all published recipes (`כל המתכונים`), enhancing food photos with Gemini AI + filler mini-game, managing user roles & personal Recipe API tokens (`גישת API`), and inspecting/cleaning up failed URL extraction logs.

_(Note: Pending photo proposals via `pendingImages[]` / `RecipeImageProposalService` were retired on Web and are NOT part of v1; photo updates go through Edit Suggestions.)_

## 2. Behavioral Contract

1. **Strict Manager Gate & Shell (`app/(tabs)/dashboard.tsx`):**
   - Accessible ONLY when `role === 'manager'`. Guests, `user`, and `approved` accounts are immediately redirected to `/home`.
   - Displays a master refresh icon (`רענן הכל`, `dashboard-refresh-btn`) plus per-section refresh icons, and collapsible mobile accordion sections showing live count badges (highlighted when pending items > 0).
   - **Push Notification Banner (`dashboard-push-banner`):** Matches Web (`קבל התראה מיידית כשמתכון חדש ממתין לאישור`, CTA `הפעל התראות במכשיר זה` `dashboard-push-enable-btn`, dismiss `סגור`) wired to Slice `11` (`push-permission-status` showing `התראות פעילות` once registered).
2. **Submission Approval Queue (`מתכונים ממתינים לאישור`, `dashboard-section-submissions`):**
   - Calls `RecipeSubmissionService.listPending()` (which self-heals deleted recipes by removing orphan submissions and already-published recipes by marking them `approved`).
   - Displays category, submission date, and status flags **`עוד לא נוסה`** (when `recipe.stage === 'to-try'`) and **`הגשה חוזרת`** (when `resubmittedAt` is present).
   - Actions: `הצג` (preview modal), **`אשר`** (`submission-approve-<recipeId>` → sets `recipes/{id}.visibility = 'published'` and `recipe_submissions/{id}.status = 'approved'`, `reviewedBy`, `reviewedAt`), and **`דחה`** (`submission-reject-<recipeId>`).
   - **Dual-Mode Rejection (Exact Web Parity — P0):**
     - **Author is `approved` or `manager` (`rejectMode = 'note'`):** Opens `askRejectionNote` modal (`מה צריך לתקן?`, button `דחייה ושליחת הערה`) with **mandatory non-empty `rejectionReason`** (confirm button stays disabled / displays validation error while trimmed reason is empty, matching `firestore.rules`). Persists `{ status: 'rejected', rejectionReason, reviewedBy, reviewedAt }` while keeping the private recipe in the author's library.
     - **Author is plain `user` (`rejectMode = 'discard'`):** Plain users have no personal library to see rejection notes; opens confirmation (`לדחות ולמחוק את ״...״?`, CTA `דחייה ומחיקה`) calling `RecipeSubmissionService.discard(recipeId)` which deletes the recipe, Storage media, and submission.
3. **Edit Suggestion Diff Review (`הצעות עריכה ממתינות`, `dashboard-section-suggestions`):**
   - Lists pending `recipe_edit_suggestions`, displaying optional `suggestion.note` (`הערה: ...`) and flagging recipes with multiple pending suggestions (`N הצעות`).
   - Opening an item displays `סקירת הצעת עריכה` with field-by-field before/after diff (`@cookbook/core/recipe-utils/recipe-diff-utils`), plus `דחה` and `אשר והחל` CTAs.
   - **Approve Pipeline (Exact Web Order):**
     1. If `storagePaths.length > 0`, calls `promoteSuggestionFiles({ suggestionId })` to copy & re-tag staged files into `recipes/{recipeId}/...`.
     2. Builds update payload via `buildApplyPayload(currentRecipe, proposedChanges)` and updates via `RecipeService.update(recipeId, { ...payload, uploadedBy: managerUid, publish: true })`.
     3. Marks suggestion `approved`, deletes original staged files under `suggestions/{suggestionId}/`, and calls **`supersedePending(recipeId, { exceptId: suggestionId, reviewedBy: managerUid })`** to mark remaining pending suggestions for that recipe as `status: 'superseded'` and delete their staged files.
   - **Reject:** Marks suggestion `rejected` (`rejectionReason: null`) and cleans up staged files.
4. **All Recipes Management (`כל המתכונים`, `dashboard-section-all-recipes`):**
   - Loads `RecipeService.listPublished()` with debounced search (`חיפוש מתכונים...`), category dropdown (`סינון לפי קטגוריה`), category + total-time chips, and two actions per row:
     - **`ערוך`** (`all-recipes-edit-<recipeId>`): opens recipe editor in direct-publish mode (`publish: true`) with `תצוגה מקדימה` toggle.
     - **`מחק`** (`all-recipes-delete-<recipeId>`): confirmation modal (`מחיקת מתכון`) calling `RecipeSubmissionService.deleteRecipe(recipeId, { authorId })` (deletes recipe, Storage files, submission, and shares).
5. **User Role Management (`ניהול משתמשים`, `dashboard-section-users`):**
   - Lists all `users` with Hebrew role options (`משתמש` = `user`, `מאושר` = `approved`, `מנהל` = `manager`), explicit save confirmation (`שמור`) calling `UserService.update(targetUid, { role })`, and optional self-demotion confirmation guard.
   - Expands/integrates personal **Recipe API Token Management (`גישת API`, `dashboard-section-api-tokens`)** per eligible (`approved`/`manager`) user (and accessible via the dashboard API tokens panel):
     - Calls `listApiTokens` (`maxPerUser = 3`); displays token name, owner, scope label (`קריאה` / `קריאה וכתיבה`), `createdBy`, `lastUsedAt` (`לא נעשה שימוש` if unused), and `לא פעיל (תפקיד)` badge if owner was demoted. Hides create button at limit (`לכל משתמש עד 3 טוקנים.`).
     - **Create Token (`createApiToken`):** Valid scopes are strictly **`'read'`** (`קריאה`, `api-token-scope-read`) and **`'read+write'`** (`קריאה וכתיבה`, `api-token-scope-read-write`, default) — NEVER `'write'`! Token name max 60 chars. Opens **one-time secret modal** (`api-token-secret-modal`) displaying plaintext `cbk_*` (`api-token-secret-value`), `העתק` (`הועתק ✓`), `סיימתי`, warning `הטוקן יוצג פעם אחת בלבד — העתיקו אותו עכשיו ושמרו אותו במקום בטוח`, AND a **close-guard** blocking the first close attempt if not yet copied (`עוד לא העתקתם את הטוקן...`). Never persists plaintext token anywhere on device or in Sentry.
     - **Revoke Token (`revokeApiToken`):** Confirmation modal → deletes token immediately.
6. **AI Food Image Enhancer (`שיפור תמונות (AI)`, `dashboard-section-enhancer`):**
   - Lists **published recipes with `images.length > 0`** sorted alphabetically in Hebrew with search (`חיפוש מתכון...`).
   - Resizes chosen source photo client-side to max `1536px` JPEG (`0.92`), lets manager set the 4 parameter axes from `functions/utils/gemini/enhancement/food-image.js` (`lighting`, `angle`, `surface`, `styling`, default `אוטומטי`) + optional instruction (`<= 500` chars), and calls `enhanceFoodImage`.
   - **Filler Mini-Game During Enhancement:** Mounts `GameHostModal` (Slice `10`, `memory`/`burger`) during the AI wait (`התמונה המשופרת מוכנה!` → `צפה בתוצאה`).
   - Writes returned `selectedParameters` back into the dropdowns, shows interactive Before (`לפני`) / After (`אחרי`) preview (tap either for fullscreen viewer), and `שמור והחלף` (`enhancer-apply-btn`) calls `RecipeService.replaceImage` preserving idempotent `<path>_original.<ext>` backup, deleting stale `_400x400.webp`/`_1080x1080.webp` variants, and setting `aiEnhanced: true`.
7. **Failed URL Extractions Queue (`כתובות שנכשלו`, `dashboard-section-failed-urls`):**
   - Lists `failed_url_extractions` ordered by `lastAttempt desc`; each row supports **`פרטים נוספים`** (full JSON error modal with `העתק שגיאה`), **`העתק`** (clipboard copy), and **`מחק`** (with confirmation modal).

## 3. Required `testID` Contracts

- `dashboard-screen`, `dashboard-refresh-btn`, `dashboard-push-banner`, `dashboard-push-enable-btn`, `push-permission-status`
- `dashboard-section-submissions`, `dashboard-section-suggestions`, `dashboard-section-all-recipes`, `dashboard-section-users`, `dashboard-section-enhancer`, `dashboard-section-failed-urls`, `dashboard-section-api-tokens`
- `submission-item-<recipeId>`, `submission-approve-<recipeId>`, `submission-reject-<recipeId>`, `reject-reason-input`, `reject-confirm-btn`, `reject-validation-error`, `discard-confirm-btn`
- `suggestion-item-<id>`, `suggestion-review-modal`, `suggestion-approve-btn`, `suggestion-reject-btn`
- `all-recipes-search-input`, `all-recipes-item-<recipeId>`, `all-recipes-edit-<recipeId>`, `all-recipes-delete-<recipeId>`
- `user-row-<uid>`, `user-role-select-<uid>`, `user-role-option-<role>`, `user-role-save-<uid>`
- `enhancer-modal`, `enhancer-instruction-input`, `enhancer-run-btn`, `enhancer-before-after`, `enhancer-apply-btn`
- `failed-url-item-<id>`, `failed-url-details-<id>`, `failed-url-delete-<id>`
- `api-token-create-btn`, `api-token-name-input`, `api-token-scope-read`, `api-token-scope-read-write`, `api-token-submit-btn`, `api-token-secret-modal`, `api-token-secret-value`, `api-token-copy-btn`, `api-token-close-btn`, `api-token-revoke-<id>`

## 4. Acceptance & Edge Cases

- **P0:** Non-managers (`guest`, `user`, `approved`) can never view or mutate any dashboard section.
- **P0:** Rejecting an approved/manager submission with empty/whitespace reason is blocked in UI and never sends an invalid Firestore write; rejecting a plain `user` submission uses the discard flow.
- **P0:** `createApiToken` sends scope `'read'` or `'read+write'` (NEVER `'write'`), reveals plaintext secret strictly once with close guard, and never persists or logs it.
- Approving `dtu-sub-pending` flips `recipes/dtu-sub-pending.visibility` to `'published'` and `recipe_submissions/dtu-sub-pending.status` to `'approved'`.
