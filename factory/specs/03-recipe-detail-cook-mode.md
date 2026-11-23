# NLSpec 03 — Recipe Detail, Scaling, Media Viewer, Cook Mode & Sharing

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/recipe-detail-page.js`, `src/lib/recipes/recipe_component/recipe_component.js`, `src/lib/media/{image-carousel,fullscreen-media-viewer,media-scroller}.js`, `src/js/utils/share.js`, `packages/cookbook-core/recipe-utils/{recipe-ingredients-utils.js,recipe-text.js,recipe-status.js,recipe-data-utils.js}`

## 1. User Intent

Opening any recipe (`/recipe/[id]`) presents a clean, kitchen-friendly Hebrew reading & cooking experience: full photo carousel, pinch-zoom fullscreen image & step video viewer, interactive servings scaling with exact fraction formatting, checkable flat or sectioned ingredients, flat or staged preparation instructions, a dedicated **Cook Mode** keeping the screen awake, related recipes, native Share (link + WhatsApp-formatted text), and role-aware recipe actions.

## 2. Behavioral Contract

1. **Recipe Loading & Access Handling (`app/recipe/[id].tsx`):**
   - Loads raw doc via `RecipeService.get(id)` and normalizes via `@cookbook/core` `formatRecipeData` for display.
   - Missing or inaccessible recipe displays a clear Hebrew not-found card (`המתכון לא נמצא או שאין לך הרשאה לצפות בו`) with back-to-book button — never crashes.
2. **Hero Media Carousel & Fullscreen Viewer:**
   - Displays all `images[]` (primary first, preferring `_1080x1080.webp` with fallback to original) using `expo-image` with swipe pagination dots.
   - Tapping any photo opens fullscreen modal with pinch-to-zoom & pan.
   - Displays `mediaInstructions[]` carousel (`סרטוני ותמונות שלבי הכנה`) with captions; tapping a video launches fullscreen playback via `expo-video` with play/pause/scrub controls; tapping an image opens fullscreen zoom.
3. **Metadata, Status Badges & Servings Scaling:**
   - Shows title, description, attribution (`מקור: ...`), category pill, difficulty, prep time, wait time (`formatCookingTime`), tags, and status/attribution badges (`פרטי`, `לנסות`, `ממתין לאישור`, `נדחה`, `שותף על ידי <name>`).
   - **Servings Stepper:** `-` and `+` buttons (`min: 1`, `max: 100`) scale all flat `ingredients[]` or `ingredientSections[].items` via `@cookbook/core` `scaleIngredients` and format amounts via `formatIngredientAmount` (exact ASCII bidi-safe fractions: `0.5` → `1/2`, `1.5` → `1 1/2`, `0.75` → `3/4`, near-integer snap `1/3 * 3` → `1`, `null` amounts omitted).
   - Every ingredient row has an interactive checkbox toggling visual strikethrough/checked state (and syncs with My Meal when opened in meal context).
4. **Instructions & Native Cook Mode (`מצב בישול`):**
   - Renders both flat `instructions[]` and multi-stage `stages[{ title, instructions[] }]` with numbered steps.
   - Toggling **Cook Mode** (`testID="cook-mode-toggle"`):
     - Activates `expo-keep-awake` (`activateKeepAwakeAsync('cook-mode')`) so the device screen stays on while cooking, deactivating cleanly on exit/unmount.
     - Enlarges step typography, highlights the active step with next/previous step navigation buttons (`שלב הבא` / `שלב קודם`), and provides a quick toggleable ingredients drawer/peek without losing step position.
     - Exposes an accessible `cook-mode-wake-lock-badge` (`המסך נשאר דולק`) when active.
5. **Sharing & Action Menu:**
   - **Share as Text (`שתף כטקסט`):** Generates exact WhatsApp-formatted Hebrew text via `@cookbook/core` `recipeShareText(recipe, { servings: currentServings, url })` (includes URL ONLY when `visibility === 'published'`), invoking native `Share.share({ message })` (plus copy-to-clipboard option).
   - **Add to My Meal (`הוסף לארוחה שלי`):** Adds recipe with current scaled servings to `active_meals/{uid}` via `ActiveMealService` (signed-in users).
   - **Favorites Heart:** Toggles favorite via `FavoritesService`.
   - **Role-Aware Actions Menu:**
     - Author on private recipe: `עריכה`, `שיתוף עם המשפחה` (approved/manager, opens Share modal from Slice 04), `שליחה לספר המשפחתי` / `שליחה מחדש` (if rejected), `סמן כנבדק` (if `to-try`), `מחיקה`.
     - Author on own published recipe with `stage === 'to-try'`: `סמן כנבדק` (updates `stage` & `testedAt` ONLY).
     - Any signed-in user on published recipe: `הצע עריכה` (opens Edit Suggestion modal), `הצע תמונה` (opens Photo Proposal flow).
     - Manager on any recipe: `עריכה` (direct), `מחיקה`, `שיפור תמונה ב-AI` (routes to enhancer).
   - **Related Recipes Strip:** Renders clickable cards for valid `relatedRecipes[]` IDs (`מתכונים קשורים`).

## 3. Required `testID` Contracts

- `recipe-detail-screen`, `recipe-title`, `recipe-description`, `recipe-image-carousel`, `recipe-fullscreen-viewer`, `recipe-step-media-list`, `recipe-step-media-item-<idx>`
- `servings-value`, `servings-dec-btn`, `servings-inc-btn`, `ingredient-row-<idx>`, `ingredient-amount-<idx>`, `ingredient-section-<idx>`
- `stage-header-<idx>`, `instruction-step-<idx>`, `cook-mode-toggle`, `cook-mode-banner`, `cook-mode-wake-lock-badge`, `cook-mode-next-btn`, `cook-mode-prev-btn`
- `recipe-fav-btn`, `recipe-add-to-meal-btn`, `recipe-share-btn`, `recipe-share-text-btn`, `recipe-actions-menu-btn`, `recipe-share-family-btn`, `recipe-suggest-edit-btn`, `recipe-mark-tested-btn`, `recipe-delete-btn`, `related-recipes-section`

## 4. Acceptance & Edge Cases

- **P0:** Scaling math MUST use `@cookbook/core` `scaleIngredients` & `formatIngredientAmount` — never ad-hoc floating-point rounding (`toFixed(1)` bugs like `0.5` → `0.5` instead of `1/2` or `0.9999` instead of `1` are forbidden).
- **P0:** Published recipe share text includes canonical URL; private recipe share text NEVER includes a public URL.
- **P0:** Cook Mode MUST release wake lock in `useEffect` cleanup on screen unmount/background.
- Works seamlessly for both flat recipes (`dtu-pub-main-courses`) and sectioned/staged recipes (`dtu-pub-desserts`, `dtu-pub-breads-pastries`).
