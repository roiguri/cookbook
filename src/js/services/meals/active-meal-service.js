// src/js/services/meals/active-meal-service.js

import {
  onSnapshot,
  doc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import { FirestoreService } from '../_firebase/firestore-service.js';
import { getFirestoreInstance } from '../_firebase/firebase-service.js';
import { captureError } from '../logger.js';

const ACTIVE_MEALS_COLLECTION = 'active_meals';

/**
 * ActiveMealService — The Single Owner of `active_meals/{uid}`
 *
 * Owns all data access for the active-meal document — both CRUD
 * operations and the real-time subscription that the /my-meal page
 * relies on for live updates across tabs and devices.
 *
 * Public API:
 *
 *   CRUD (preserves return shape from the legacy ActiveMealUtils for
 *   minimal caller churn — `{ success, reason?, error? }`):
 *     - addToMeal(uid, recipeId)
 *     - removeFromMeal(uid, recipeId)
 *     - clearMeal(uid)
 *     - switchRecipe(uid, recipeId)
 *     - updateRecipeState(uid, recipeId, updates)
 *
 *   Real-time subscription:
 *     - subscribe(uid, callback) → unsubscribe
 *       Callback fires once immediately with the current meal data (or
 *       null if the doc doesn't exist), then again on every write to
 *       `active_meals/{uid}` from any source (this tab, another tab,
 *       another device, a Cloud Function, etc.). Caller MUST hold the
 *       returned unsubscribe and call it on cleanup to avoid leaking
 *       the underlying WebSocket subscription.
 */
export class ActiveMealService {
  /**
   * Add a recipe to the user's active meal. Idempotent — adding the
   * same recipe twice is a no-op (returns `duplicate` on the second
   * attempt before any write).
   *
   * @param {string} uid
   * @param {string} recipeId
   * @returns {Promise<{ success: boolean, reason?: string, error?: any }>}
   */
  static async addToMeal(uid, recipeId) {
    if (!uid || !recipeId) {
      console.error('ActiveMealService.addToMeal: uid and recipeId are required');
      return { success: false, reason: 'invalid_input' };
    }

    try {
      // 1. Check for duplicates against the current doc state.
      const existing = await FirestoreService.getDocument(ACTIVE_MEALS_COLLECTION, uid);
      if (existing && Array.isArray(existing.recipeIds) && existing.recipeIds.includes(recipeId)) {
        return { success: false, reason: 'duplicate' };
      }

      // 2. Create-or-update. setDoc with merge handles both cases atomically.
      await FirestoreService.batchWrite([
        {
          type: 'set',
          collection: ACTIVE_MEALS_COLLECTION,
          id: uid,
          data: {
            recipeIds: arrayUnion(recipeId),
            lastUpdated: serverTimestamp(),
          },
          options: { merge: true },
        },
      ]);

      return { success: true };
    } catch (error) {
      console.error('ActiveMealService.addToMeal failed:', error);
      captureError(error, { service: 'active-meal', op: 'addToMeal', uid, recipeId });
      return { success: false, reason: 'error', error };
    }
  }

  /**
   * Remove a recipe from the meal and clean up its per-recipe state.
   *
   * @param {string} uid
   * @param {string} recipeId
   * @returns {Promise<{ success: boolean, error?: any }>}
   */
  static async removeFromMeal(uid, recipeId) {
    if (!uid || !recipeId) return { success: false, error: 'invalid_inputs' };

    try {
      await FirestoreService.updateDocument(ACTIVE_MEALS_COLLECTION, uid, {
        recipeIds: arrayRemove(recipeId),
        lastUpdated: serverTimestamp(),
        [`recipeStates.${recipeId}`]: deleteField(),
      });
      return { success: true };
    } catch (error) {
      console.error('ActiveMealService.removeFromMeal failed:', error);
      captureError(error, { service: 'active-meal', op: 'removeFromMeal', uid, recipeId });
      return { success: false, error };
    }
  }

  /**
   * Delete the entire active-meal doc for this user.
   *
   * @param {string} uid
   * @returns {Promise<{ success: boolean, error?: any }>}
   */
  static async clearMeal(uid) {
    if (!uid) return { success: false, error: 'invalid_user' };

    try {
      await FirestoreService.deleteDocument(ACTIVE_MEALS_COLLECTION, uid);
      return { success: true };
    } catch (error) {
      console.error('ActiveMealService.clearMeal failed:', error);
      captureError(error, { service: 'active-meal', op: 'clearMeal', uid });
      return { success: false, error };
    }
  }

  /**
   * Switch the active recipe tab in the meal.
   *
   * @param {string} uid
   * @param {string} recipeId
   * @returns {Promise<{ success: boolean, error?: any }>}
   */
  static async switchRecipe(uid, recipeId) {
    try {
      await FirestoreService.updateDocument(ACTIVE_MEALS_COLLECTION, uid, {
        activeRecipeId: recipeId,
        lastUpdated: serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      console.error('ActiveMealService.switchRecipe failed:', error);
      captureError(error, { service: 'active-meal', op: 'switchRecipe', uid, recipeId });
      return { success: false, error };
    }
  }

  /**
   * Patch fields on a specific recipe's state inside the meal doc.
   * Uses Firestore dot-notation so concurrent writes to OTHER recipes
   * don't clobber each other.
   *
   * @param {string} uid
   * @param {string} recipeId
   * @param {Object} updates - e.g. `{ servings: 4, currentStep: 2 }`
   * @returns {Promise<{ success: boolean, error?: any }>}
   */
  static async updateRecipeState(uid, recipeId, updates) {
    try {
      const flat = {};
      Object.entries(updates).forEach(([key, value]) => {
        flat[`recipeStates.${recipeId}.${key}`] = value;
      });
      flat.lastUpdated = serverTimestamp();

      await FirestoreService.updateDocument(ACTIVE_MEALS_COLLECTION, uid, flat);
      return { success: true };
    } catch (error) {
      console.error('ActiveMealService.updateRecipeState failed:', error);
      captureError(error, { service: 'active-meal', op: 'updateRecipeState', uid, recipeId });
      return { success: false, error };
    }
  }

  /**
   * Subscribe to real-time updates on the user's active-meal doc.
   *
   * The callback fires once immediately with the doc's current state,
   * then again on every write to `active_meals/{uid}`. When the doc
   * doesn't exist, the callback is invoked with `null`.
   *
   * Synchronously returns an unsubscribe function. Callers MUST call
   * the unsubscribe on cleanup (e.g., page unmount) to release the
   * underlying Firestore listener. Forgetting to unsubscribe leaks
   * the WebSocket subscription.
   *
   * @param {string} uid
   * @param {(mealData: Object|null) => void} callback
   * @returns {() => void} unsubscribe
   */
  static subscribe(uid, callback) {
    if (!uid) throw new Error('ActiveMealService.subscribe: uid is required');
    if (typeof callback !== 'function') {
      throw new Error('ActiveMealService.subscribe: callback must be a function');
    }
    const db = getFirestoreInstance();
    const docRef = doc(db, ACTIVE_MEALS_COLLECTION, uid);
    return onSnapshot(docRef, (docSnap) => {
      callback(docSnap.exists() ? docSnap.data() : null);
    });
  }
}

export const activeMealService = ActiveMealService;
