# NLSpec 05 — My Meal (הארוחה שלי) & Offline Kitchen Resilience

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/my-meal-page.js`, `src/app/pages/my-meal-page.html`, `src/js/services/meals/active-meal-service.js`, `packages/cookbook-core/recipe-utils/recipe-ingredients-utils.js`, `packages/cookbook-core/recipe-utils/recipe-text.js`, `firestore.rules`

## 1. User Intent

While planning a Shabbat dinner or cooking multiple dishes simultaneously, signed-in users keep a live multi-recipe workspace (**הארוחה שלי**) synced to `active_meals/{uid}` with full Web↔Mobile real-time schema compatibility. They switch effortlessly between recipe tabs, scale servings and track cooking step progress per dish, open a combined or per-recipe ingredients/shopping list drawer (`רשימת מצרכים`), check/uncheck items individually or in bulk, copy or share the list, and continue cooking even when kitchen Wi-Fi drops (airplane mode), syncing automatically on reconnect.

## 2. Behavioral Contract

1. **Real-Time Subscription & Exact Web-Compatible Schema (`ActiveMealService`):**
   - Subscribes via Firestore `onSnapshot` to `active_meals/{uid}` matching Web `active-meal-service.js` verbatim:
     ```ts
     {
       recipeIds: string[],
       activeRecipeId: string | null,
       recipeStates: Record<
         string,
         {
           servings: number;
           currentStepIndex?: number;
           unselectedIngredients: string[]; // exact keys: `${recipeId}-${sectionIndex}-${itemIndex}`
         }
       >,
       lastUpdated: Timestamp,
     }
     ```
   - **Exact Method Semantics (matching `active-meal-service.js`):**
     - `addToMeal(uid, recipeId)`: appends `recipeId` to `recipeIds` if not present; returns `{ success: false, reason: 'duplicate' }` as a no-op if already present (never duplicates IDs!).
     - `removeFromMeal(uid, recipeId)`: removes from `recipeIds`, updates `activeRecipeId` (falling back to previous tab `index - 1`, then next, else `null`), and deletes `recipeStates.${recipeId}` via `deleteField()`.
     - `switchRecipe(uid, recipeId)`: updates `activeRecipeId` and `lastUpdated`.
     - `updateRecipeState(uid, recipeId, partialState)`: patches via **dot-notation** (`recipeStates.${recipeId}.${key}`) + `lastUpdated` so concurrent edits to different recipes never clobber each other.
     - `clearMeal(uid)`: deletes `active_meals/{uid}` after confirmation (`האם לנקות את כל הארוחה? פעולה זו תסיר את כל המתכונים.`).
   - Empty meal (`!meal || recipeIds.length === 0`) renders Hebrew empty state: heading **`אין ארוחה פעילה`**, subtitle **`התחל להוסיף מתכונים לארוחה שלך כדי לראות אותם כאן`**, CTA **`חפש מתכונים`** (`/categories`).
2. **Multi-Recipe Kitchen Switcher (`app/(tabs)/my-meal.tsx`):**
   - Horizontal RTL pill tabs for every recipe in `recipeIds` (each with recipe name and remove `×` button showing confirmation dialog `האם להסיר את המתכון מהארוחה?`).
   - Switching tabs updates `activeRecipeId` and displays the active recipe's full ingredients (scaled to `recipeStates[id].servings`), instructions (preserving `currentStepIndex`), and Cook Mode toggle right inside My Meal without rebuilding tabs on ingredient checkoffs.
3. **Ingredients / Shopping List Bottom Sheet (`רשימת מצרכים`):**
   - Trigger button (`testID="shopping-list-open-btn"`) opens a modal/bottom sheet with:
     - Two view pills: **`כל המצרכים`** (`all`: combines scaled ingredients across every recipe grouped by recipe + `ingredientSections` subheaders with per-recipe tri-state header checkbox) and **`מתכון נוכחי`** (`current`: scaled ingredients for the active recipe only).
     - Bulk controls: **`בחר הכל`** (`shopping-select-all-btn`) and **`בטל הכל`** (`shopping-deselect-all-btn`).
     - Checking/unchecking an ingredient toggles its exact key **`${recipeId}-${sectionIndex}-${itemIndex}`** (`sectionIndex = 0` for flat `ingredients[]`) in `recipeStates[recipeId].unselectedIngredients` via dot-notation update.
     - **Copy (`העתק ללוח`, `shopping-copy-btn`) & Share (`שתף`, `shopping-share-btn`):** Formats remaining selected scaled ingredients via `@cookbook/core` `ingredientLine` matching Web `my-meal-page.js` (`רשימת מצרכים:\n\n`, recipe header + `---`, section headers, `- <line>` items) and invokes clipboard copy or native `Share.share`.
4. **Offline Kitchen Mode Resilience:**
   - Native `@react-native-firebase/firestore` SQLite persistence serves cached `active_meals/{uid}` and previously viewed `recipes/{id}` immediately when offline (airplane mode).
   - Non-blocking offline indicator banner (`testID="offline-banner"`, `מצב לא מקוון — השינויים יישמרו כשתחזרו לרשת`) appears via `@react-native-community/netinfo` when disconnected.
   - Checking off ingredients and adjusting servings while offline updates UI immediately via local cache and syncs automatically to Firestore upon reconnection with zero crash and zero lost state.

## 3. Required `testID` Contracts

- `my-meal-screen`, `meal-empty-state`, `meal-clear-btn`, `meal-tab-<recipeId>`, `meal-tab-remove-<recipeId>`
- `meal-servings-value`, `meal-servings-inc-btn`, `meal-servings-dec-btn`
- `shopping-list-open-btn`, `shopping-list-sheet`, `shopping-view-all-btn`, `shopping-view-current-btn`, `shopping-select-all-btn`, `shopping-deselect-all-btn`, `shopping-item-<idx>`, `shopping-copy-btn`, `shopping-share-btn`, `shopping-list-close-btn`
- `offline-banner`

## 4. Acceptance & Edge Cases

- **P0:** Only the authenticated owner (`isOwner(uid)`) can read/write `active_meals/{uid}`.
- Adding the same recipe twice is an idempotent duplicate no-op (never duplicates ID in `recipeIds`).
- `active_meals/{uid}` writes `lastUpdated` (NOT `updatedAt`) and exact `${recipeId}-${sectionIndex}-${itemIndex}` keys so Web and Mobile stay 100% live-compatible.
- Airplane mode toggle mid-session: browsing cached recipes, switching My Meal tabs, and checking off shopping items works with zero errors, and reconnecting persists exact `unselectedIngredients` to Firestore.
