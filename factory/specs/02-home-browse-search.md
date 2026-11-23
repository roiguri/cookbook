# NLSpec 02 — Home, Browse Categories, Unified Search, Filters & Favorites

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/home-page.js`, `src/app/pages/home-page.html`, `src/app/pages/categories-page.js`, `src/app/pages/categories-page.html`, `src/js/services/recipes/recipe-service.js`, `src/js/services/recipes/recipe-image-service.js`, `src/js/services/recipes/recipe-search-service.js`, `src/js/services/users/favorites-service.js`, `src/lib/search/header-search-bar/header-search-bar.js`, `src/lib/recipes/recipe-card/recipe-card.js`, `src/lib/recipes/recipe_strip/recipe_strip.js`, `src/lib/collections/unified-recipe-filter/unified-recipe-filter.js`, `src/lib/collections/recipe-list/recipe-list-controller.js`, `src/lib/modals/filter_modal/filter_modal.js`, `packages/cookbook-core/recipe-model.js`, `packages/cookbook-core/filter-utils.js`

## 1. User Intent

Users land on a warm, welcoming Hebrew Home screen featuring quick category tiles, newest published recipes, and (for approved family & managers) a personal "הבא בתור במטבח" (to-try recipes) strip. From Categories/Browse, users explore all 10 categories, run unified live search (merging their own private recipes first when approved/manager), combine multi-facet filters, paginate smoothly, add recipes to My Meal (`+`), and favorite/unfavorite recipes.

## 2. Behavioral Contract

1. **Home Screen (`app/(tabs)/home.tsx`):**
   - Hero section with warm Hebrew welcome copy and prominent search entry tapping into `/categories` focused on search.
   - **Horizontal RTL Category Strip:** All 10 categories from `CATEGORY_IDS` / `CATEGORY_MAP` (`מנות ראשונות`, `מנות עיקריות`, `תוספות`, `מרקים ותבשילים`, `סלטים`, `קינוחים`, `ארוחות בוקר`, `לחמים ומאפים`, `חטיפים`, `משקאות`). Tapping a category navigates to `/categories?category=<id>`.
   - **Featured / Newest Published Strip (`מתכונים חדשים`):** Queries `RecipeService.listPublished({ orderBy: ['creationTime', 'desc'], limit: 4 })` with a `כל המתכונים` link to `/categories`. Tapping any card opens `/recipe/[id]`.
   - **Personal "Next in the Kitchen" Strip (`הבא בתור במטבח`):** Hidden for guests and plain `user` accounts. For `approved` & `manager`, loads `RecipeService.listMine(uid, { stage: 'to-try' })` newest first (hiding redundant `לנסות` badge, switching to compact no-image cards when none have images); displays up to 4 cards + a `מתכון חדש` add tile when fewer than 4 items exist (full-width alone when empty), and a `הכל` link to `/my-recipes?view=to-try` when > 2 items exist.
   - Pull-to-refresh reloads strips smoothly.
2. **Browse & Unified Search Screen (`app/(tabs)/categories.tsx`):**
   - Supports URL/route params `?category=<id>&q=<query>&favorites=true` (resetting `favorites` automatically on sign-out).
   - **Category Filter Chips:** `כל הקטגוריות` (`all`) + all 10 `CATEGORY_IDS` horizontally scrollable in RTL.
   - **Unified Search Input (`FilterUtils` from `@cookbook/core/filter-utils`):**
     - Uses `FilterUtils.searchRecipes(recipes, query)` (AND-matching space-separated tokens against `name`, `category`, and `tags`) and `FilterUtils.applyFilters(recipes, filters, favoriteIds)` verbatim.
     - Guests & plain `user`: searches **published** recipes ONLY.
     - `approved` & `manager`: when search query is non-empty, merges caller's own private recipes **FIRST** (with full status badges from `RecipeSubmissionService.listMineWithStatus`: `לנסות`/`פרטי`/`ממתין`/`נדחה`) ahead of published matches.
     - Header search bar single-match shortcut: when header search yields exactly 1 recipe, navigates directly to `/recipe/[id]` with toast `נמצא מתכון אחד: "<name>" - מעבר ישיר למתכון`.
   - **Multi-Facet Filter Bottom Sheet (`סינון מתכונים`, opened via `עוד מסננים`):**
     - Uses `FilterUtils.extractFilterOptions` for dynamic `mainIngredient` and `tags` options (multi-tag filter uses AND semantics).
     - `difficulty` (`קלה` / `בינונית` / `קשה`), `cookingTime` exact 3 buckets (`'0-30'` `0-30 דקות`, `'31-60'` `31-60 דקות`, `'61'` `מעל שעה`), `רק מתכונים ששמרתי` (favorites-only toggle, signed-in only).
     - Shows live debounced match count (`{count} מתכונים תואמים`), `אפס הכל` clear button, and `הצג תוצאות` apply button.
   - **Race-Condition Safety:** Rapidly switching categories, search text, or filters uses a monotonic request counter so stale responses never overwrite newer results or cause UI flicker.
   - **Pagination & Card Rendering:** Virtualized list (`@shopify/flash-list` or `FlatList`, page size 12 on mobile with smooth load-more / Prev-Next indicator) displaying `_400x400.webp` thumbnails via `RecipeImageService.getOptimizedUrl` with graceful fallback to original URL. Signed-in cards also expose a quick `+` Add-to-Meal button (`card-add-meal-<recipeId>`).
3. **Favorites (`FavoritesService`):**
   - Heart icon button on recipe cards (`testID="fav-btn-<recipeId>"`) toggles membership in `users/{uid}.favorites` via `UserService` with optimistic UI + rollback on error.
   - Mobile enhancement for guests: tapping heart prompts a friendly Hebrew login modal (`התחברו כדי לשמור מתכונים מועדפים`).
   - Broadcasts favorite change event so Home, Categories, and My Recipes stay synchronized immediately.

## 3. Required `testID` Contracts

- `home-screen`, `home-hero`, `home-category-tile-<catId>`, `home-featured-strip`, `home-next-section`, `home-next-add-tile`
- `categories-screen`, `categories-search-input`, `categories-search-clear`, `category-chip-all`, `category-chip-<catId>`, `filter-open-btn`, `filter-sheet`, `filter-difficulty-<diff>`, `filter-time-<bucket>`, `filter-favorites-toggle`, `filter-apply-btn`, `filter-clear-btn`, `recipe-list`, `recipe-card-<recipeId>`, `fav-btn-<recipeId>`, `card-add-meal-<recipeId>`, `categories-empty-state`

## 4. Acceptance & Edge Cases

- **P0:** Guest search NEVER returns private recipes (`dtu-priv-totry`, `dtu-priv-shared`).
- Approved user search for `'טחינה'` surfaces their own private `'עוגיות טחינה סודיות'` first with status badge alongside matching published recipes.
- All 10 categories render with exact Hebrew labels from `@cookbook/core/recipe-model` `CATEGORY_MAP`.
- Empty search results show clean Hebrew empty state (`לא נמצאו מתכונים` + `נסה לשנות את הקריטריונים או החיפוש`) with `אפס הכל` button.
