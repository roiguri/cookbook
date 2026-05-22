// src/js/services/recipes/recipe-image-service.js

import { setPrimaryImage as setPrimaryImageInternal } from '../../utils/recipes/recipe-image-utils.js';

/**
 * RecipeImageService — Image Lifecycle for Recipes
 *
 * Owns operations on the image files and image-entry metadata for a
 * recipe. Separated from RecipeService (which owns recipe doc CRUD) so
 * each service has a single responsibility: RecipeService manages the
 * recipe document; RecipeImageService manages what lives at the
 * Storage layer for a recipe's images plus the per-image entries
 * inside `recipes/{id}.images[]`.
 *
 * Public API:
 *   - setPrimaryImage(recipeId, imageId)
 *
 * Image proposal/moderation lives in RecipeImageProposalService.
 */
export class RecipeImageService {
  /**
   * Mark a single image on a recipe as the primary one. Clears `isPrimary`
   * on the rest. Throws if the recipe has no images.
   *
   * Previously lived on RecipeService; moved here as part of the
   * service-layer refactor (umbrella issue #211).
   *
   * @param {string} recipeId
   * @param {string} imageId
   * @returns {Promise<void>}
   */
  static async setPrimaryImage(recipeId, imageId) {
    return await setPrimaryImageInternal(recipeId, imageId);
  }
}

export const recipeImageService = RecipeImageService;
