// src/js/services/recipes/recipe-image-service.js

import { StorageService } from '../_firebase/storage-service.js';
import { getImageStoragePath, generateImageId } from '../../utils/recipes/recipe-image-utils.js';

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
 * RecipeImageService — Image Storage Operations
 *
 * Owns the Storage-layer file operations for a recipe's images. Does NOT
 * touch Firestore — recipe-document orchestration (image-entry lookups,
 * patches, etc.) lives in RecipeService.
 *
 * Public API:
 *   - uploadFile(recipeId, category, file, options)
 *   - replaceFiles(recipeId, image, blob, options)
 *
 * Image proposal/moderation lives in RecipeImageProposalService.
 * Primary-image selection and image-entry patches live on RecipeService.
 */
export class RecipeImageService {
  /**
   * Upload a single image file to Storage under the recipe's category path
   * and return its metadata entry (id, full path, fileName, isPrimary,
   * uploadedBy, access, uploadTimestamp). Storage only — does NOT touch
   * `recipes/{id}.images[]`; caller is responsible for persisting the
   * returned entry on the recipe document. The Storage Resize extension
   * regenerates WebP variants asynchronously.
   *
   * @param {string} recipeId
   * @param {string} category
   * @param {File} file
   * @param {Object} [options]
   * @param {boolean} [options.isPrimary=false]
   * @param {string} [options.uploadedBy]
   * @returns {Promise<Object>} image metadata entry
   */
  static async uploadFile(recipeId, category, file, options = {}) {
    const { isPrimary = false, uploadedBy } = options;
    const fileExtension = file.name.split('.').pop();
    const fileName = isPrimary ? 'primary.jpg' : `${Date.now()}.${fileExtension}`;
    const fullPath = getImageStoragePath(recipeId, category, fileName, 'full');
    await StorageService.uploadFile(file, fullPath);

    return {
      id: generateImageId(),
      full: fullPath,
      fileName,
      isPrimary,
      uploadedBy,
      access: 'public',
      uploadTimestamp: new Date(),
    };
  }

  /**
   * Replace an image's Storage file with new bytes. Optionally preserves
   * the current file as a backup at `<path>_original.<ext>` (idempotent —
   * only written if the backup doesn't already exist). Also best-effort
   * deletes the stale 400/1080 WebP variants so consumers refresh promptly.
   *
   * @param {string} recipeId - Unused inside; kept in the signature for
   * @param {{ full: string }} image - The image entry to replace (must have `.full`).
   * @param {Blob} blob - New image bytes.
   * @param {Object} [options]
   * @param {boolean} [options.keepOriginalBackup=true]
   * @returns {Promise<{ backupPath: string, backupCreated: boolean }>}
   */
  static async replaceFiles(recipeId, image, blob, options = {}) {
    if (!image || !image.full) {
      throw new Error('RecipeImageService.replaceFiles: image.full is required');
    }
    if (!blob) throw new Error('RecipeImageService.replaceFiles: blob is required');

    const { keepOriginalBackup = true } = options;

    const originalPath = image.full;
    const backupPath = makeBackupPath(originalPath);

    let backupCreated = false;
    if (keepOriginalBackup) {
      if (!(await fileExists(backupPath))) {
        const url = await StorageService.getFileUrl(originalPath);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `RecipeImageService.replaceFiles: failed to fetch original (${response.status})`,
          );
        }
        await StorageService.uploadFile(await response.blob(), backupPath);
        backupCreated = true;
      }
    }

    await StorageService.uploadFile(blob, originalPath);

    await Promise.all([
      StorageService.deleteFile(originalPath.replace(/\.[^.]+$/, '_400x400.webp')).catch(() => {}),
      StorageService.deleteFile(originalPath.replace(/\.[^.]+$/, '_1080x1080.webp')).catch(
        () => {},
      ),
    ]);

    return { backupPath, backupCreated };
  }
}

export const recipeImageService = RecipeImageService;
