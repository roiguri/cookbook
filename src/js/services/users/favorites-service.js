/**
 * Favorites Service
 * -----------------
 * Shim over CollectionService — see
 * docs/feature-plans/personal-collections.md, Slice 1.2 ("The shim must
 * cover BOTH read paths"). Keeps the pre-existing public API and caching
 * semantics so every existing caller (recipe-card, categories-page,
 * filter_modal, recipe-presentation-grid) keeps working unmodified while
 * favorites live as `users/{uid}/collection` entries underneath.
 *
 * Shim semantics, pinned by the plan: "favorite" = "entry exists in my
 * collection", regardless of lifecycle `state`. Migrated hearts are
 * `rotation`, Stage 2 saves enter at `to-try` — the shim returns all entry
 * IDs so the heart's meaning doesn't drift mid-transition. Temporary
 * scaffolding, removed in Stage 4.
 */
import authService from '../auth/auth-service.js';
import { captureError } from '../logger.js';
import { CollectionService } from './collection-service.js';
import { RecipeService } from '../recipes/recipe-service.js';
import { getPrimaryImage } from '../../utils/recipes/recipe-image-utils.js';

/**
 * Denormalised card map for a newly-favorited recipe, matching the shape
 * `CollectionService` documents: `{ name, category, primaryImage, prepTime }`.
 * `primaryImage` stores the image's Storage path (`full`), the same field
 * the live app resolves to a download URL at render time — mirrors
 * `getPrimaryImage()` from recipe-image-utils.js.
 * @param {Object} recipe
 * @returns {Object}
 */
function buildCard(recipe) {
  const card = {
    name: recipe.name ?? null,
    category: recipe.category ?? null,
    prepTime: recipe.prepTime ?? null,
  };
  const primary = getPrimaryImage(recipe);
  if (primary?.full) {
    card.primaryImage = primary.full;
  }
  return card;
}

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
   * Get user's favorite recipe IDs — every collection entry ID, regardless
   * of lifecycle state.
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
        const entries = await CollectionService.list(user.uid);
        const favoriteRecipeIds = entries.map((entry) => entry.id);

        this.cache = {
          userId: user.uid,
          favorites: favoriteRecipeIds,
          isLoaded: true,
        };

        return favoriteRecipeIds;
      } catch (error) {
        console.error('Error fetching user favorites:', error);
        captureError(error, {
          service: 'favorites',
          op: 'getUserFavorites',
          uid: user.uid,
        });
        return [];
      } finally {
        this._fetchPromise = null;
      }
    })();

    return this._fetchPromise;
  }

  /**
   * Add a recipe to favorites — creates a collection entry at
   * `source: 'saved'`, `state: 'to-try'`. Create-only: a repeat add is a
   * no-op on an existing entry (CollectionService.create), so it never
   * clobbers a migrated `rotation` entry's state.
   * @param {string} recipeId - Recipe ID to add
   * @returns {Promise<void>}
   */
  async addFavorite(recipeId) {
    const user = authService.getCurrentUser();
    if (!user) return;

    try {
      // Optimistic update
      this.updateCache(recipeId, true);

      let card;
      try {
        const recipe = await RecipeService.get(recipeId);
        if (recipe) {
          card = buildCard(recipe);
        }
      } catch (fetchError) {
        // Tolerate a failed recipe fetch — favoriting still succeeds
        // without denormalised card data.
        console.warn('Failed to fetch recipe for favorite card data:', fetchError);
      }

      const entry = { source: 'saved', state: 'to-try' };
      if (card) entry.card = card;

      await CollectionService.create(user.uid, recipeId, entry);
    } catch (error) {
      console.error('Error adding favorite:', error);
      captureError(error, {
        service: 'favorites',
        op: 'addFavorite',
        uid: user.uid,
        recipeId,
      });
      // Revert cache on error
      this.updateCache(recipeId, false);
      throw error;
    }
  }

  /**
   * Remove a recipe from favorites — deletes the collection entry
   * (including any notes/servingsOverride overlay).
   * @param {string} recipeId - Recipe ID to remove
   * @returns {Promise<void>}
   */
  async removeFavorite(recipeId) {
    const user = authService.getCurrentUser();
    if (!user) return;

    try {
      // Optimistic update
      this.updateCache(recipeId, false);

      await CollectionService.delete(user.uid, recipeId);
    } catch (error) {
      console.error('Error removing favorite:', error);
      captureError(error, {
        service: 'favorites',
        op: 'removeFavorite',
        uid: user.uid,
        recipeId,
      });
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
