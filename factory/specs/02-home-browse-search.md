# NLSpec 02 — Home, Browse Categories, Unified Search, Filters & Favorites

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/home-page.js`, `src/app/pages/categories-page.js`, `src/js/services/recipes/{recipe-service.js,recipe-search-service.js}`, `src/js/services/users/favorites-service.js`, `src/lib/collections/*`, `src/lib/modals/filter_modal/filter_modal.js`, `packages/cookbook-core/{recipe-model.js,filter-utils.js}`

## 1. User Intent

Users land on a warm, welcoming Hebrew Home screen featuring quick category tiles, newest published recipes, and (for approved family & managers) a personal "הבא בתור במטבח" (Next in the kitchen — to-try recipes) strip. From Categories/Browse, users explore all 10 categories, run unified live search (including their own private recipes if approved/manager), combine multi-facet filters, paginate smoothly, and favorite/unfavorite recipes.

## 2. Behavioral Contract

1. **Home Screen (`app/(tabs)/home.tsx`):**
   - Hero section with Hebrew welcome copy and prominent search entry tapping into `/categories` focused on search.
   - **Horizontal RTL Category Strip:** All 10 categories from `CATEGORY_IDS` / `CATEGORY_MAP` (`מנות ראשונות`, `מנות עיקריות`, `תוספות`, `מרקים ותבשילים`, `סלטים`, `קינוחים`, `ארוחות בוקר`, `לחמים ומאפים`, `חטיפים`, `משקאות`). Tapping a category navigates to `/categories?category=<id>`.
   - **Featured / Newest Published Strip (`מתכונים חדשים`):** Queries `RecipeService.listPublished({ orderBy: ['creationTime', 'desc'], limit: 6 })`. Tapping any card opens `/recipe/[id]`.
   - **Personal "Next in the Kitchen" Strip (`הבא בתור במטבח`):** Hidden for guests and plain `user` accounts. For `approved` & `manager`, loads `RecipeService.listMine(uid, { stage: 'to-try' })` newest first; displays cards + an `הוסף מתכון` tile when fewer than 4 items exist, and a `הכל` link to `/my-recipes?view=to-try`.
   - Pull-to-refresh reloads strips smoothly.
2. **Browse & Unified Search Screen (`app/(tabs)/categories.tsx`):**
   - **Category Filter Chips:** `הכל` (`all`) + all 10 `CATEGORY_IDS` horizontally scrollable in RTL.
   - **Search Input:** Debounced live search using `@cookbook/core/filter-utils` (`filterRecipes`).
     - Guests & plain `user`: searches **published** recipes ONLY.
     - `approved` & `manager`: unified search merges published recipes + caller's own private recipes (marking private cards clearly with a `פרטי` badge so privacy is unmistakable).
   - **Multi-Facet Filter Bottom Sheet:** Filter by `difficulty` (`קלה` / `בינונית` / `קשה`), max total time (`prepTime + waitTime`), `tags`, `mainIngredient`, and `מועדפים בלבד` (favorites only, signed-in). Displays active filter count badge and `נקה סינון` reset action.
   - **Race-Condition Safety:** Rapidly switching categories, search text, or filters uses a monotonic request counter/abort token so stale responses never overwrite newer results or cause UI flicker.
   - **Pagination & Performance:** Renders cards with `@shopify/flash-list` (or virtualized `FlatList`) with page size 12 and load-more footer / infinite scroll; displays thumbnail `_400x400.webp` via `RecipeImageService.getOptimizedUrl` with graceful fallback to original URL.
3. **Favorites (`FavoritesService`):**
   - Heart icon button on every recipe card (`testID="fav-btn-<recipeId>"`) toggles membership in `users/{uid}.favorites` via `UserService` with optimistic UI + rollback on error.
   - Guests tapping heart see a friendly Hebrew login prompt modal (`התחברו כדי לשמור מתכונים מועדפים`).
   - Broadcasts favorite change event so Home, Categories, Recipe Detail, and My Recipes stay synchronized immediately.

## 3. Required `testID` Contracts

- `home-screen`, `home-hero`, `home-category-tile-<catId>`, `home-featured-strip`, `home-next-section`, `home-next-add-tile`
- `categories-screen`, `categories-search-input`, `categories-search-clear`, `category-chip-all`, `category-chip-<catId>`, `filter-open-btn`, `filter-sheet`, `filter-difficulty-<diff>`, `filter-favorites-toggle`, `filter-apply-btn`, `filter-clear-btn`, `recipe-list`, `recipe-card-<recipeId>`, `fav-btn-<recipeId>`, `categories-empty-state`

## 4. Acceptance & Edge Cases

- **P0:** Guest search NEVER returns private recipes (`dtu-priv-totry`, `dtu-priv-shared`).
- Approved user search for `'טחינה'` surfaces their own private `'עוגיות טחינה סודיות'` alongside any matching published recipes.
- All 10 categories render with exact Hebrew labels from `@cookbook/core/recipe-model` `CATEGORY_MAP`.
- Empty search results show clean Hebrew empty state (`לא נמצאו מתכונים התואמים לחיפוש`) with `נקה סינון` button.
