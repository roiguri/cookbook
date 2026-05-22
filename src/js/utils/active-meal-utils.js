import { FirestoreService } from '../services/_firebase/firestore-service.js';
import { arrayUnion, arrayRemove, serverTimestamp, deleteField } from 'firebase/firestore';

/**
 * Utility for managing active meal operations
 */
export const ActiveMealUtils = {
  /**
   * Add a recipe to the user's active meal
   * @param {string} userId - The user's ID
   * @param {string} recipeId - The recipe ID to add
   * @returns {Promise<{success: boolean, reason?: string}>}
   */
  async addToMeal(userId, recipeId) {
    if (!userId || !recipeId) {
      console.error('UserId and RecipeId are required');
      return { success: false, reason: 'invalid_input' };
    }

    try {
      // 1. Get current active meal
      const mealDoc = await FirestoreService.getDocument('active_meals', userId);

      // 2. Check for duplicates
      if (mealDoc && mealDoc.recipeIds && mealDoc.recipeIds.includes(recipeId)) {
        return { success: false, reason: 'duplicate' };
      }

      // 3. Add to meal (create or update)
      // We use batchWrite directly or just updateDocument if we knew it existed,
      // but set with merge is safer for "create if not exists"

      // Since FirestoreService doesn't expose setDoc with merge directly in a simple way
      // without looking at implementation, let's use batchWrite which is exposed and flexible
      // or check if updateDocument handles creation.
      // Looking at firestore-service.js (implied from context), usually update is for existing.
      // Let's use the pattern seen in recipe-detail-page.js: batchWrite with type 'set'

      await FirestoreService.batchWrite([
        {
          type: 'set',
          collection: 'active_meals',
          id: userId,
          data: {
            recipeIds: arrayUnion(recipeId),
            lastUpdated: serverTimestamp(),
          },
          options: { merge: true },
        },
      ]);

      return { success: true };
    } catch (error) {
      console.error('Error adding recipe to meal:', error);
      return { success: false, reason: 'error', error };
    }
  },

  /**
   * Remove a recipe from the user's active meal
   * @param {string} userId
   * @param {string} recipeId
   * @returns {Promise<{success: boolean, error?: any}>}
   */
  async removeFromMeal(userId, recipeId) {
    if (!userId || !recipeId) return { success: false, error: 'invalid_inputs' };

    try {
      // We also want to remove the specific state for this recipe to clean up the document
      const updates = {
        recipeIds: arrayRemove(recipeId),
        lastUpdated: serverTimestamp(),
        [`recipeStates.${recipeId}`]: deleteField(),
        // Check if this was the active recipe and clear it if so (handled in page logic generally, but safe to do validation)
        // However, we can't condition updates on current values easily in one update call without transaction.
        // Let's just remove the recipe. The page will handle switching active tab if needed.
      };

      await FirestoreService.updateDocument('active_meals', userId, updates);
      return { success: true };
    } catch (error) {
      console.error('Error removing recipe from meal:', error);
      return { success: false, error };
    }
  },

  /**
   * Clear user's active meal entirely
   * @param {string} userId
   * @returns {Promise<{success: boolean, error?: any}>}
   */
  async clearMeal(userId) {
    if (!userId) return { success: false, error: 'invalid_user' };

    try {
      await FirestoreService.deleteDocument('active_meals', userId);
      return { success: true };
    } catch (error) {
      console.error('Error clearing meal:', error);
      return { success: false, error };
    }
  },

  /**
   * Switch the active recipe in the meal
   * @param {string} userId
   * @param {string} recipeId
   */
  async switchRecipe(userId, recipeId) {
    try {
      await FirestoreService.updateDocument('active_meals', userId, {
        activeRecipeId: recipeId,
        lastUpdated: serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      console.error('Error switching recipe:', error);
      return { success: false, error };
    }
  },

  /**
   * Update the state of a specific recipe in the meal
   * @param {string} userId
   * @param {string} recipeId
   * @param {Object} updates - The updates to apply (e.g., { servings: 4 })
   * @param {Object} currentStates - The current recipeStates object from the meal doc (optional, but good for merging if not using dot notation)
   * However, Firestore allows dot notation for nested fields update.
   * "recipeStates.RECIPE_ID.FIELD": VALUE
   */
  async updateRecipeState(userId, recipeId, updates) {
    try {
      // Construct dot notation updates to avoid fetching/overwriting the whole map race conditions
      // keys in updates should be mapped to `recipeStates.${recipeId}.${key}`
      const flattenUpdates = {};
      Object.entries(updates).forEach(([key, value]) => {
        flattenUpdates[`recipeStates.${recipeId}.${key}`] = value;
      });
      flattenUpdates.lastUpdated = serverTimestamp();

      await FirestoreService.updateDocument('active_meals', userId, flattenUpdates);
      return { success: true };
    } catch (error) {
      console.error('Error updating recipe state:', error);
      return { success: false, error };
    }
  },
};
