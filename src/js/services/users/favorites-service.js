/**
 * Favorites Service
 * -----------------
 * Centralized service for managing user favorites with caching
 */

import { arrayUnion, arrayRemove } from 'firebase/firestore';
import authService from '../auth/auth-service.js';
import { FirestoreService } from '../_firebase/firestore-service.js';

class FavoritesService {
  constructor() {
    this.cache = {
      userId: null,
      favorites: [],
      isLoaded: false,
    };
    this._fetchPromise = null;
  }

  /**
   * Get user's favorite recipe IDs
   * @returns {Promise<Array<string>>} Array of favorite recipe IDs
   */
  async getUserFavorites() {
    const user = authService.getCurrentUser();
    if (!user) {
      return [];
    }

    if (this.cache.userId === user.uid && this.cache.isLoaded) {
      return this.cache.favorites;
    }

    // Return existing promise if one is in flight to deduplicate requests
    if (this._fetchPromise) {
      return this._fetchPromise;
    }

    this._fetchPromise = (async () => {
      try {
        const userDoc = await FirestoreService.getDocument('users', user.uid);
        const favoriteRecipeIds = userDoc?.favorites || [];

        this.cache = {
          userId: user.uid,
          favorites: favoriteRecipeIds,
          isLoaded: true,
        };

        return favoriteRecipeIds;
      } catch (error) {
        console.error('Error fetching user favorites:', error);
        return [];
      } finally {
        this._fetchPromise = null;
      }
    })();

    return this._fetchPromise;
  }

  /**
   * Add a recipe to favorites
   * @param {string} recipeId - Recipe ID to add
   * @returns {Promise<void>}
   */
  async addFavorite(recipeId) {
    const user = authService.getCurrentUser();
    if (!user) return;

    try {
      // Optimistic update
      this.updateCache(recipeId, true);

      await FirestoreService.updateDocument('users', user.uid, {
        favorites: arrayUnion(recipeId),
      });
    } catch (error) {
      console.error('Error adding favorite:', error);
      // Revert cache on error
      this.updateCache(recipeId, false);
      throw error;
    }
  }

  /**
   * Remove a recipe from favorites
   * @param {string} recipeId - Recipe ID to remove
   * @returns {Promise<void>}
   */
  async removeFavorite(recipeId) {
    const user = authService.getCurrentUser();
    if (!user) return;

    try {
      // Optimistic update
      this.updateCache(recipeId, false);

      await FirestoreService.updateDocument('users', user.uid, {
        favorites: arrayRemove(recipeId),
      });
    } catch (error) {
      console.error('Error removing favorite:', error);
      // Revert cache on error
      this.updateCache(recipeId, true);
      throw error;
    }
  }

  /**
   * Clear the favorites cache
   */
  clearCache() {
    this.cache = {
      userId: null,
      favorites: [],
      isLoaded: false,
    };
    this._fetchPromise = null;
  }

  /**
   * Update the local cache when favorites change
   * @param {string} recipeId - Recipe ID to update
   * @param {boolean} isAdding - Whether adding or removing from favorites
   */
  updateCache(recipeId, isAdding) {
    const user = authService.getCurrentUser();

    // Skip cache update if no user or user doesn't match cached user
    if (!user || (this.cache.userId && this.cache.userId !== user.uid)) {
      return;
    }

    // Initialize cache if empty but user matches (or just set user id)
    if (!this.cache.userId) {
      this.cache.userId = user.uid;
    }

    // Ensure favorites array exists
    if (!this.cache.favorites) {
      this.cache.favorites = [];
    }

    if (isAdding) {
      if (!this.cache.favorites.includes(recipeId)) {
        this.cache.favorites.push(recipeId);
      }
    } else {
      this.cache.favorites = this.cache.favorites.filter((id) => id !== recipeId);
    }

    // Mark as loaded if we have data now?
    // No, strictly speaking we only know about THIS favorite, not the full list.
    // But for isFavorite check it might be tricky.
    // Let's keep isLoaded false until full fetch, unless it was already true.
  }

  /**
   * Check if a recipe is in user's favorites
   * @param {string} recipeId - Recipe ID to check
   * @returns {Promise<boolean>} Whether the recipe is favorited
   */
  async isFavorite(recipeId) {
    if (!recipeId || (typeof recipeId !== 'string' && typeof recipeId !== 'number')) {
      console.warn('isFavorite: Invalid recipeId provided:', recipeId);
      return false;
    }

    const favorites = await this.getUserFavorites();
    return favorites.includes(recipeId);
  }

  /**
   * Get the cache status for debugging
   * @returns {Object} Current cache state
   */
  getCacheStatus() {
    return { ...this.cache };
  }
}

// Export singleton instance
export default new FavoritesService();
