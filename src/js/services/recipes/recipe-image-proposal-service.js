// src/js/services/recipes/recipe-image-proposal-service.js

import { FirestoreService } from '../_firebase/firestore-service.js';
import { StorageService } from '../_firebase/storage-service.js';
import { RecipeImageService } from './recipe-image-service.js';
import { generateImageId, getImageStoragePath } from '../../utils/recipes/recipe-image-utils.js';

const RECIPES_COLLECTION = 'recipes';

/**
 * RecipeImageProposalService — Image Proposal & Moderation
 *
 * Distinct workflow from owner CRUD: end-users propose images on existing
 * recipes; managers approve/reject. Kept separate from RecipeService so the
 * owner surface stays focused. Bounded writes to
 * `recipes/{id}.{pendingImages, images}` live here.
 *
 * Public API:
 *   - propose(recipeId, files, category, uploadedBy)
 *   - approve(recipeId, pendingImageId)
 *   - reject(recipeId, pendingImageId)
 *   - listPending(recipeId)
 */
export class RecipeImageProposalService {
  /**
   * Upload one or more files as pending images on an existing recipe.
   * Each file lands at its category Storage path and an entry is appended
   * to `recipes/{id}.pendingImages[]`. Returns the new entries (without
   * the previously-existing pending entries).
   *
   * @param {string} recipeId
   * @param {File[]} files
   * @param {string} category
   * @param {string} uploadedBy
   * @returns {Promise<Array>} the new pending image entries
   */
  static async propose(recipeId, files, category, uploadedBy) {
    if (!Array.isArray(files) || files.length === 0) return [];
    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    const pendingImages = Array.isArray(recipe.pendingImages) ? [...recipe.pendingImages] : [];

    const newPendingImages = await Promise.all(
      files.map(async (file) => {
        const fileExtension = file.name.split('.').pop();
        const id = generateImageId();
        const fileName = `${id}.${fileExtension}`;
        const fullPath = getImageStoragePath(recipeId, category, fileName, 'full');
        await StorageService.uploadFile(file, fullPath);
        return {
          id,
          full: fullPath,
          fileExtension,
          timestamp: new Date(),
          uploadedBy,
        };
      }),
    );

    pendingImages.push(...newPendingImages);
    await FirestoreService.updateDocument(RECIPES_COLLECTION, recipeId, { pendingImages });
    return newPendingImages;
  }

  /**
   * Approve a single pending image: move it from `pendingImages[]` into
   * the approved `images[]` array as a typed RecipeImage. Marks the new
   * entry as primary if no approved images exist yet on the recipe.
   *
   * @param {string} recipeId
   * @param {string} pendingImageId
   * @returns {Promise<string>} the new image id assigned to the approved entry
   */
  static async approve(recipeId, pendingImageId) {
    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!recipe || !Array.isArray(recipe.pendingImages)) {
      throw new Error('No pending images to approve');
    }
    const pendingImage = recipe.pendingImages.find((img) => img.id === pendingImageId);
    if (!pendingImage) throw new Error('Pending image not found');

    const newImageId = generateImageId();
    const newImage = {
      id: newImageId,
      full: pendingImage.full,
      isPrimary: !recipe.images || recipe.images.length === 0,
      access: 'public',
      uploadedBy: pendingImage.uploadedBy,
      fileName: `${pendingImageId}.${pendingImage.fileExtension}`,
      uploadTimestamp: new Date(),
    };
    const images = Array.isArray(recipe.images) ? [...recipe.images, newImage] : [newImage];
    const pendingImages = recipe.pendingImages.filter((img) => img.id !== pendingImageId);
    await FirestoreService.updateDocument(RECIPES_COLLECTION, recipeId, { images, pendingImages });
    return newImageId;
  }

  /**
   * Reject a single pending image: delete its Storage files (via
   * RecipeImageService.deleteFiles) and remove it from `pendingImages[]`.
   *
   * @param {string} recipeId
   * @param {string} pendingImageId
   * @returns {Promise<void>}
   */
  static async reject(recipeId, pendingImageId) {
    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!recipe || !Array.isArray(recipe.pendingImages)) {
      throw new Error('No pending images to reject');
    }
    const pendingImage = recipe.pendingImages.find((img) => img.id === pendingImageId);
    if (!pendingImage) throw new Error('Pending image not found');

    await RecipeImageService.deleteFiles(pendingImage);
    const pendingImages = recipe.pendingImages.filter((img) => img.id !== pendingImageId);
    await FirestoreService.updateDocument(RECIPES_COLLECTION, recipeId, { pendingImages });
  }

  /**
   * List all pending images for a recipe (empty array if none).
   *
   * @param {string} recipeId
   * @returns {Promise<Array>}
   */
  static async listPending(recipeId) {
    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    return Array.isArray(recipe?.pendingImages) ? recipe.pendingImages : [];
  }
}

export const recipeImageProposalService = RecipeImageProposalService;
