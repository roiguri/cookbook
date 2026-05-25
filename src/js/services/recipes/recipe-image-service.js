// src/js/services/recipes/recipe-image-service.js

import { StorageService } from '../_firebase/storage-service.js';

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
 *   - replaceFiles(recipeId, image, blob, options)
 *
 * Image proposal/moderation lives in RecipeImageProposalService.
 * Primary-image selection and image-entry patches live on RecipeService.
 */
export class RecipeImageService {
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
