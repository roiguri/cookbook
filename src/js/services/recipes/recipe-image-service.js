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
 *   - deleteFiles(image)
 *   - migrateFilesToCategory(recipeId, image, newCategory)
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

  /**
   * Delete all Storage files associated with an image: the full original,
   * its `_400x400.webp` and `_1080x1080.webp` variants, the `_original`
   * backup (if present), and the backup's own WebP variants. The full-size
   * deletion propagates errors; variant/backup deletions are best-effort.
   *
   * @param {{ full: string }} image - The image entry (must have `.full`).
   * @returns {Promise<void>}
   */
  static async deleteFiles(image) {
    if (!image || !image.full) {
      throw new Error('RecipeImageService.deleteFiles: image.full is required');
    }
    const { full } = image;
    const optimized400 = full.replace(/\.[^.]+$/, '_400x400.webp');
    const optimized1080 = full.replace(/\.[^.]+$/, '_1080x1080.webp');
    const originalBackup = full.replace(/(\.[^.]+)$/, '_original$1');
    // The Storage Resize extension also generates WebP variants for the
    // `_original` backup file itself, so those need explicit cleanup too.
    const originalOpt400 = originalBackup.replace(/\.[^.]+$/, '_400x400.webp');
    const originalOpt1080 = originalBackup.replace(/\.[^.]+$/, '_1080x1080.webp');
    await StorageService.deleteFile(full);
    await Promise.all([
      StorageService.deleteFile(optimized400).catch(() => {}),
      StorageService.deleteFile(optimized1080).catch(() => {}),
      StorageService.deleteFile(originalBackup).catch(() => {}),
      StorageService.deleteFile(originalOpt400).catch(() => {}),
      StorageService.deleteFile(originalOpt1080).catch(() => {}),
    ]);
  }

  /**
   * Move an image's Storage files from its current category path to a new
   * category path. Copies the full original bytes to the new path and
   * deletes the old, then best-effort cleans up the old WebP variants
   * (the Resize extension regenerates them at the new path). If an
   * `_original` AI-backup file exists at the old path, it is copied to
   * the matching new path (and its variants at the old path cleaned up
   * best-effort). Returns a new image object with `full` updated.
   *
   * @param {string} recipeId
   * @param {{ id: string, full: string }} image
   * @param {string} newCategory
   * @returns {Promise<Object>} New image object with updated `full` path.
   */
  static async migrateFilesToCategory(recipeId, image, newCategory) {
    if (!image || !image.full) {
      throw new Error('RecipeImageService.migrateFilesToCategory: image.full is required');
    }

    try {
      const fileName = image.full.split('/').pop();
      const newFullPath = getImageStoragePath(recipeId, newCategory, fileName, 'full');

      const fullUrl = await StorageService.getFileUrl(image.full);
      const fullResponse = await fetch(fullUrl);

      if (!fullResponse.ok) {
        throw new Error(`Failed to fetch images: full=${fullResponse.status}`);
      }

      const fullBlob = await fullResponse.blob();
      await StorageService.uploadFile(fullBlob, newFullPath);
      await StorageService.deleteFile(image.full);

      // The new full upload triggers the Storage Resize extension to regenerate
      // WebP variants at the new path, so the old variants just need to be
      // deleted. We don't conditionally check existence — deleteFile is best
      // effort and harmless if the file is missing.
      const oldOpt400 = image.full.replace(/\.[^.]+$/, '_400x400.webp');
      const oldOpt1080 = image.full.replace(/\.[^.]+$/, '_1080x1080.webp');
      await Promise.all([
        StorageService.deleteFile(oldOpt400).catch(() => {}),
        StorageService.deleteFile(oldOpt1080).catch(() => {}),
      ]);

      // The AI-enhancement `_original` backup is NOT auto-generated, so it must
      // be actively copied to the new path (best effort — most images won't have
      // one). Its WebP variants ARE auto-generated by the extension, so the old
      // ones at the source path need explicit cleanup just like the full's.
      const oldOriginal = image.full.replace(/(\.[^.]+)$/, '_original$1');
      const newOriginal = newFullPath.replace(/(\.[^.]+)$/, '_original$1');
      const oldOriginalOpt400 = oldOriginal.replace(/\.[^.]+$/, '_400x400.webp');
      const oldOriginalOpt1080 = oldOriginal.replace(/\.[^.]+$/, '_1080x1080.webp');
      try {
        const url = await StorageService.getFileUrl(oldOriginal);
        const response = await fetch(url);
        if (response.ok) {
          const blob = await response.blob();
          await StorageService.uploadFile(blob, newOriginal);
          await StorageService.deleteFile(oldOriginal).catch(() => {});
        }
      } catch {
        // No `_original` backup at the old path — nothing to migrate.
      }
      await Promise.all([
        StorageService.deleteFile(oldOriginalOpt400).catch(() => {}),
        StorageService.deleteFile(oldOriginalOpt1080).catch(() => {}),
      ]);

      return {
        ...image,
        full: newFullPath,
      };
    } catch (error) {
      console.error(`Failed to migrate image ${image.id} to ${newCategory}:`, error);
      throw new Error(`Failed to migrate image ${image.id}: ${error.message}`);
    }
  }
}

export const recipeImageService = RecipeImageService;
