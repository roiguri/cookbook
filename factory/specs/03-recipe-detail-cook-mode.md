# NLSpec 03 — Recipe Detail, Scaling, Media Viewer, Cook Mode & Sharing

- **Wave:** 3A (Core Detail — after Wave 2 services merge)
- **Depends On:** Slices `02`, `04`, `05`
- **Web Semport Oracles:** `src/app/pages/recipe-detail-page.js`, `src/app/pages/recipe-detail-page.html`, `src/lib/recipes/recipe_component/recipe_component.js`, `src/lib/recipes/recipe_component/parts/cook-mode-toggle.js`, `src/lib/recipes/recipe_component/parts/cook-mode-container.js`, `src/lib/recipes/status-badge/status-badge.js`, `src/lib/recipes/suggest_edit_modal/suggest-edit-modal.js`, `src/lib/media/image-carousel/image-carousel.js`, `src/lib/media/fullscreen-media-viewer/fullscreen-media-viewer.js`, `src/lib/media/media-scroller/media-scroller.js`, `src/js/utils/share.js`, `packages/cookbook-core/recipe-utils/recipe-ingredients-utils.js`, `packages/cookbook-core/recipe-utils/recipe-text.js`, `packages/cookbook-core/recipe-utils/recipe-status.js`, `packages/cookbook-core/recipe-utils/recipe-data-utils.js`

## 1. User Intent

Opening any recipe (`/recipe/[id]`) presents a clean, kitchen-friendly Hebrew reading & cooking experience: full photo carousel, fullscreen image & step video viewer, interactive servings scaling with exact fraction formatting, checkable flat or sectioned ingredients, flat or staged preparation instructions, family notes (`הערות:`), Cook Mode keeping the screen awake, related recipes, dedicated Share menu (link + WhatsApp text + Share with Family), and role-aware owner actions.

## 2. Behavioral Contract

1. **Recipe Loading & Access Handling (`app/recipe/[id].tsx`):**
   - Loads raw doc via `RecipeService.get(id)` and normalizes via `@cookbook/core` `formatRecipeData` for display.
   - Missing or inaccessible recipe displays a clear Hebrew not-found card (`מתכון לא נמצא` / `המתכון הזה לא זמין` — if signed out, includes a `התחבר` CTA that retries loading after login). Signing out while viewing a private recipe redirects cleanly to `/home`.
2. **Hero Media Carousel & Fullscreen Viewer:**
   - Filters images by role via `getRecipeImages(recipe, userRole)` (primary first, preferring `_1080x1080.webp` with fallback to original) rendered with `expo-image` and swipe pagination dots.
   - _(Mobile-native enhancement beyond Web)_ Tapping any hero photo opens fullscreen modal (`recipe-fullscreen-viewer`) with pinch-to-zoom & pan.
   - Displays `mediaInstructions[]` carousel titled **`טיפים מצולמים:`** with captions; tapping a video launches fullscreen playback via `expo-video` with play/pause/scrub controls; tapping an image opens fullscreen zoom.
3. **Metadata, Notes, Status Badges & Servings Scaling:**
   - Shows title, 2-line clamped description with `הצג עוד` / `הצג פחות` toggle, attribution (`מקור: ...`, auto-linking URLs), category pill, difficulty, prep time, wait time (`formatCookingTime`), family notes section **`הערות:`** (`recipe.comments[]`), and status/attribution badges matching `@cookbook/core/recipe-utils/recipe-status` (`פרטי`, `לנסות`, `ממתין`, `נדחה`, `פורסם`, and `שותף איתך ע״י <fullName>` on shared detail).
   - **Servings Stepper:** `-` and `+` buttons (`min: 1`, editable numeric value) scale all flat `ingredients[]` or `ingredientSections[].items` via `@cookbook/core` `scaleIngredients` and format amounts via `formatIngredientAmount` (exact ASCII bidi-safe fractions: `0.5` → `1/2`, `1.5` → `1 1/2`, `0.75` → `3/4`, near-integer snap `1/3 * 3` → `1`, `null` amounts omitted).
   - Every ingredient row has an interactive checkbox toggling local checked strikethrough state while cooking.
4. **Instructions & Native Cook Mode (`מצב בישול`):**
   - Renders both flat `instructions[]` and multi-stage `stages[{ title, instructions[] }]` with numbered click-to-highlight steps.
   - Toggling **Cook Mode** (`testID="cook-mode-toggle"`):
     - Activates `expo-keep-awake` (`activateKeepAwakeAsync('cook-mode')`) so the screen stays on while cooking, releasing cleanly on exit/unmount.
     - Exposes `cook-mode-wake-lock-badge` (`המסך יישאר דלוק`).
     - _(Mobile-native enhancement)_ Enlarges step typography and provides next/previous step focus buttons (`cook-mode-next-btn` / `cook-mode-prev-btn`) plus quick ingredients peek.
5. **Dedicated Share Menu & Role-Aware Actions (`⋮`) Menu:**
   - **Share Menu (`recipe-share-btn`):** Adapts by recipe visibility & ownership (matching `recipe-detail-page.js`):
     - Published recipe: `שליחת קישור` (canonical link) | `שליחת המתכון כטקסט` (`recipe-share-text-btn`, via `recipeShareText(recipe, { servings, url })`).
     - Author's private recipe (`isApproved()`): `שיתוף עם בני משפחה` (`recipe-share-family-btn`, opens `ShareFamilyModal` from Slice `04`) | `שליחת המתכון כטקסט` (NO public URL!).
     - Shared private recipe (recipient): direct text share (NO public URL, NO family-share option).
   - **Add to My Meal (`recipe-add-to-meal-btn`):** Calls `ActiveMealService.addToMeal(uid, id)` (signed-in users; shows `'המתכון כבר נמצא בארוחה שלך'` toast if already added).
   - **Favorites Heart (`recipe-fav-btn`, mobile convenience):** Syncs with `FavoritesService` (signed-in users).
   - **Owner `⋮` Actions Menu (`recipe-actions-menu-btn` — visible to `approved`/`manager` authors on their own recipes):**
     - Top owner status block displays `<StatusBadge>`, status date, pending info, and when `submission.status === 'rejected'` shows **`הערה ממנהלי הספר`** (`rejection-note-banner`) with exact `rejectionReason` text (`rejection-reason-text`).
     - Private recipe actions: `עריכה` (hidden while rejected — replaced by **`עריכה ושליחה מחדש`** `resubmit-recipe-btn` which opens editor & calls `RecipeSubmissionService.resubmit(id)` on save, OR allows quick resubmit), **`שיתוף עם בני משפחה`** (`recipe-share-family-btn`), **`שליחה לפרסום`** (`submit-for-approval-btn`, warns if `stage === 'to-try'`), **`ביטול השליחה`** (`cancel-submission-btn`, when pending), **`סימון כנבדק`** (`recipe-mark-tested-btn`, when `to-try`) / **`החזרה ל״לנסות״`** (`recipe-mark-to-try-btn`, when `tested`), and **`מחיקת המתכון`** (`recipe-delete-btn` calling `RecipeSubmissionService.deleteRecipe(id, { authorId })` and redirecting to `/my-recipes`).
     - Own published recipe actions: `סימון כנבדק` (`stage === 'to-try'`) or `החזרה ל״לנסות״` (`stage === 'tested'`), updating `stage` & `testedAt` ONLY.
   - **Signed-in Published Recipe Action:** **`הצע עריכה`** (`recipe-suggest-edit-btn`, opens Edit Suggestion modal with optional `הערה למנהל (אופציונלי)` wired via Slice `06` — includes photo proposals; retired `הצע תמונה` is NOT present, and manager direct edit/delete/enhancer live strictly in `/dashboard`!).
   - **Related Recipes Strip (`related-recipes-section`):** Filters strictly to `visibility === 'published'` valid IDs and renders clickable cards (`מתכונים קשורים`).

## 3. Required `testID` Contracts

- `recipe-detail-screen`, `recipe-title`, `recipe-description`, `recipe-image-carousel`, `recipe-fullscreen-viewer`, `recipe-step-media-list`, `recipe-step-media-item-<idx>`, `recipe-comments-section`
- `servings-value`, `servings-dec-btn`, `servings-inc-btn`, `ingredient-row-<idx>`, `ingredient-amount-<idx>`, `ingredient-section-<idx>`
- `stage-header-<idx>`, `instruction-step-<idx>`, `cook-mode-toggle`, `cook-mode-banner`, `cook-mode-wake-lock-badge`, `cook-mode-next-btn`, `cook-mode-prev-btn`
- `recipe-fav-btn`, `recipe-add-to-meal-btn`, `recipe-share-btn`, `recipe-share-link-btn`, `recipe-share-text-btn`, `recipe-actions-menu-btn`, `recipe-share-family-btn`, `recipe-suggest-edit-btn`, `recipe-mark-tested-btn`, `recipe-mark-to-try-btn`, `recipe-delete-btn`, `related-recipes-section`

## 4. Acceptance & Edge Cases

- **P0:** Scaling math MUST use `@cookbook/core` `scaleIngredients` & `formatIngredientAmount` verbatim.
- **P0:** Published recipe share text includes canonical URL; private recipe share text NEVER includes a public URL.
- **P0:** Cook Mode MUST release wake lock in `useEffect` cleanup on screen unmount/background.
- Works seamlessly for both flat recipes (`dtu-pub-main-courses`) and sectioned/staged recipes (`dtu-pub-desserts`, `dtu-pub-breads-pastries`).
