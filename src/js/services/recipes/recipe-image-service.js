// src/js/services/recipes/recipe-image-service.js

import { FirestoreService } from '../_firebase/firestore-service.js';
import { StorageService } from '../_firebase/storage-service.js';

const RECIPES_COLLECTION = 'recipes';

function makeBackupPath(fullPath) {
  return fullPath.replace(/(\.[^.]+)$/, '_original$1');
}

async function fileExists(path) {
  try {
    await StorageService.getMetadata(path);
    return true;
  } catch {
    return false;
  }
}

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
 *   - replaceImage(recipeId, imageId, blob, options)
 *
 * Image proposal/moderation lives in RecipeImageProposalService.
 * Primary-image selection now lives on RecipeService.
 */
export class RecipeImageService {
  /**
   * Replace an existing image's storage file with new bytes. Optionally
   * preserves the current image as a backup at `<path>_original.<ext>`
   * (idempotent — only written if the backup doesn't already exist).
   * Optionally patches the matching image entry inside
   * `recipes/{id}.images[]` with caller-supplied fields.
   *
   * Steps:
   *   1. Look up the image entry on the recipe doc. Throws if recipe
   *      or image not found.
   *   2. If keepOriginalBackup (default true) and no backup exists:
   *      fetch the current image bytes and write them at the backup path.
   *   3. Upload `blob` to the original path (overwrites). The Storage
   *      Resize extension regenerates WebP variants asynchronously.
   *   4. Best-effort: delete the stale _400x400.webp / _1080x1080.webp
   *      variants at the original path so consumers refresh promptly.
   *   5. If `fieldUpdates` is provided: best-effort merge it into the
   *      matching image entry. A failure here logs but does NOT throw —
   *      the image bytes already changed; the flag is cosmetic.
   *
   * @param {string} recipeId
   * @param {string} imageId
   * @param {Blob} blob - New image bytes (must be uploadable; e.g. from a fetch or canvas).
   * @param {Object} [options]
   * @param {boolean} [options.keepOriginalBackup=true]
   * @param {Object} [options.fieldUpdates] - Patch merged into the matching image entry.
   * @returns {Promise<{ backupPath: string, backupCreated: boolean }>}
   */
  static async replaceImage(recipeId, imageId, blob, options = {}) {
    if (!recipeId) throw new Error('RecipeImageService.replaceImage: recipeId is required');
    if (!imageId) throw new Error('RecipeImageService.replaceImage: imageId is required');
    if (!blob) throw new Error('RecipeImageService.replaceImage: blob is required');

    const { keepOriginalBackup = true, fieldUpdates } = options;

    // 1. Look up the image entry.
    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!recipe) {
      throw new Error(`RecipeImageService.replaceImage: recipe ${recipeId} not found`);
    }
    const images = Array.isArray(recipe.images) ? recipe.images : [];
    const image = images.find((img) => img.id === imageId);
    if (!image) {
      throw new Error(
        `RecipeImageService.replaceImage: image ${imageId} not found on recipe ${recipeId}`,
      );
    }

    const originalPath = image.full;
    const backupPath = makeBackupPath(originalPath);

    // 2. Backup (idempotent).
    let backupCreated = false;
    if (keepOriginalBackup) {
      if (!(await fileExists(backupPath))) {
        const url = await StorageService.getFileUrl(originalPath);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `RecipeImageService.replaceImage: failed to fetch original (${response.status})`,
          );
        }
        await StorageService.uploadFile(await response.blob(), backupPath);
        backupCreated = true;
      }
    }

    // 3. Overwrite the original.
    await StorageService.uploadFile(blob, originalPath);

    // 4. Best-effort stale WebP variant cleanup so consumers refresh promptly.
    await Promise.all([
      StorageService.deleteFile(originalPath.replace(/\.[^.]+$/, '_400x400.webp')).catch(() => {}),
      StorageService.deleteFile(originalPath.replace(/\.[^.]+$/, '_1080x1080.webp')).catch(
        () => {},
      ),
    ]);

    // 5. Best-effort image-entry patch.
    if (fieldUpdates && Object.keys(fieldUpdates).length > 0) {
      try {
        const fresh = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
        if (fresh && Array.isArray(fresh.images)) {
          const updatedImages = fresh.images.map((img) =>
            img.id === imageId ? { ...img, ...fieldUpdates } : img,
          );
          await FirestoreService.updateDocument(RECIPES_COLLECTION, recipeId, {
            images: updatedImages,
          });
        }
      } catch (err) {
        // The image bytes have already changed; failing the whole op
        // because a metadata patch didn't land would be misleading.
        console.error(
          `RecipeImageService.replaceImage: fieldUpdates patch failed for image ${imageId}:`,
          err,
        );
      }
    }

    return { backupPath, backupCreated };
  }
}

export const recipeImageService = RecipeImageService;
