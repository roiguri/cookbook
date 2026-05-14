// src/js/services/recipe-image-proposal-service.js

import {
  addPendingImages,
  approvePendingImageById,
  rejectPendingImageById,
  getPendingImages,
} from '../utils/recipes/recipe-image-utils.js';

/**
 * RecipeImageProposalService — Image Proposal & Moderation
 *
 * Distinct workflow from owner CRUD: end-users propose images on existing
 * recipes; managers approve/reject. Kept separate from RecipeService so the
 * owner surface stays focused.
 *
 * Public API:
 *   - propose(recipeId, files, category, uploadedBy)
 *   - approve(recipeId, pendingImageId)
 *   - reject(recipeId, pendingImageId)
 *   - listPending(recipeId)
 */
export class RecipeImageProposalService {
  /**
   * Upload one or more images as proposals against an existing recipe.
   * @param {string} recipeId
   * @param {File[]} files
   * @param {string} category
   * @param {string} uploadedBy
   * @returns {Promise<Array>} pending image metadata
   */
  static async propose(recipeId, files, category, uploadedBy) {
    return await addPendingImages(recipeId, files, category, uploadedBy);
  }

  /**
   * Approve a pending image, moving it into the approved images array.
   * @param {string} recipeId
   * @param {string} pendingImageId
   * @returns {Promise<string>} new image ID
   */
  static async approve(recipeId, pendingImageId) {
    return await approvePendingImageById(recipeId, pendingImageId);
  }

  /**
   * Reject a pending image, deleting its files and removing it from the
   * pending array.
   * @param {string} recipeId
   * @param {string} pendingImageId
   * @returns {Promise<void>}
   */
  static async reject(recipeId, pendingImageId) {
    return await rejectPendingImageById(recipeId, pendingImageId);
  }

  /**
   * List all pending images for a recipe.
   * @param {string} recipeId
   * @returns {Promise<Array>}
   */
  static async listPending(recipeId) {
    return await getPendingImages(recipeId);
  }
}

export const recipeImageProposalService = RecipeImageProposalService;
