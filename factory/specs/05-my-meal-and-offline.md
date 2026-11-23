# NLSpec 05 — My Meal (הארוחה שלי) & Offline Kitchen Resilience

- **Wave:** 2 (Parallel Core)
- **Depends On:** Slice `01`
- **Web Semport Oracles:** `src/app/pages/my-meal-page.js`, `src/js/services/meals/active-meal-service.js`, `packages/cookbook-core/recipe-utils/{recipe-ingredients-utils.js,recipe-text.js}`, `firestore.rules` (`match /active_meals/{userId}`)

## 1. User Intent

While planning a Shabbat dinner or cooking multiple dishes simultaneously, signed-in users keep a live multi-recipe workspace (**הארוחה שלי**) synced to `active_meals/{uid}`. They switch effortlessly between recipe tabs, scale servings per dish, open a combined or per-recipe shopping list bottom sheet, check off ingredients they already have, share the shopping list to WhatsApp, and continue reading recipes and checking off ingredients even when kitchen Wi-Fi drops (airplane mode), syncing automatically when back online.

## 2. Behavioral Contract

1. **Real-Time Subscription (`ActiveMealService`):**
   - Subscribes via Firestore `onSnapshot` to `active_meals/{uid}` with shape:
     ```ts
     {
       recipeIds: string[],
       activeRecipeId: string | null,
       recipeStates: Record<string, { servings: number; unselectedIngredients: string[] }>,
       updatedAt: Timestamp,
     }
     ```
   - Supports `addRecipe(uid, recipeId, servings)`, `removeRecipe(uid, recipeId)`, `setActiveRecipe(uid, recipeId)`, `updateServings(uid, recipeId, servings)`, `toggleIngredient(uid, recipeId, ingredientKey)`, and `clearMeal(uid)` (with confirmation dialog).
   - Empty meal renders welcoming Hebrew empty state (`עדיין לא הוספתם מתכונים לארוחה`) with CTA to browse `/categories`.
2. **Multi-Recipe Kitchen Switcher (`app/(tabs)/my-meal.tsx`):**
   - Horizontal RTL pill tabs for every recipe in `recipeIds` (each with recipe name and remove `×` button).
   - Switching tabs updates `activeRecipeId` and displays the active recipe's full ingredients (scaled to `recipeStates[id].servings`), instructions, and Cook Mode toggle right inside My Meal without rebuilding unrelated UI state.
   - Removing the active recipe gracefully activates the next remaining recipe (or shows empty state if last).
3. **Shopping List Bottom Sheet (`רשימת קניות`):**
   - Floating/header button (`testID="shopping-list-open-btn"`) opens a modal/bottom sheet with two view pills:
     - `כל הארוחה` (`all`): combines scaled ingredients across every recipe in `recipeIds` grouped clearly by recipe.
     - `מתכון נוכחי` (`current`): shows scaled ingredients for the active recipe only.
   - Checking/unchecking an ingredient persists its key in `recipeStates[recipeId].unselectedIngredients` (Firestore write queued locally if offline).
   - **Share Shopping List (`שתף רשימת קניות`):** Formats remaining (selected) scaled ingredients via `@cookbook/core` `ingredientLine` with WhatsApp bullets and launches native `Share.share`.
4. **Offline Kitchen Mode Resilience:**
   - Native `@react-native-firebase/firestore` SQLite persistence serves cached `active_meals/{uid}` and previously viewed `recipes/{id}` immediately when offline (airplane mode).
   - Subtle non-blocking offline indicator banner (`מצב לא מקוון — השינויים יישמרו כשתחזרו לרשת`) appears via `@react-native-community/netinfo` when disconnected.
   - Checking off ingredients and adjusting servings while offline updates UI immediately via Firestore local cache and syncs automatically to Firestore upon reconnection with zero crash and zero lost state.

## 3. Required `testID` Contracts

- `my-meal-screen`, `meal-empty-state`, `meal-clear-btn`, `meal-tab-<recipeId>`, `meal-tab-remove-<recipeId>`
- `meal-servings-value`, `meal-servings-inc-btn`, `meal-servings-dec-btn`
- `shopping-list-open-btn`, `shopping-list-sheet`, `shopping-view-all-btn`, `shopping-view-current-btn`, `shopping-item-<idx>`, `shopping-share-btn`, `shopping-list-close-btn`
- `offline-banner`

## 4. Acceptance & Edge Cases

- **P0:** Only the authenticated owner (`isOwner(uid)`) can read/write `active_meals/{uid}`.
- Adding the same recipe twice is idempotent (updates active tab/servings without duplicating ID in `recipeIds`).
- Airplane mode toggle mid-session: browsing cached recipes, switching My Meal tabs, and checking off shopping items works with zero errors, and reconnecting persists exact `unselectedIngredients` to Firestore.
