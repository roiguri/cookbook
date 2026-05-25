// src/js/services/recipes/recipe-image-service.js

import { StorageService } from '../_firebase/storage-service.js';

function getImageStoragePath(recipeId, category, fileName, type = 'full') {
  return `img/recipes/${type}/${category}/${recipeId}/${fileName}`;
}

function generateImageId() {
  return 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

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
 * RecipeImageService — Storage-Only Image Operations for Recipes
 *
 * Owns the Storage layer for a recipe's images: upload, delete,
 * migrate, replace. Performs zero Firestore reads or writes — the
 * recipe document (and its `images[]` entries) belong to RecipeService.
 * Compose the two when a single operation needs both: RecipeService
 * loads/writes the doc; RecipeImageService handles the bytes.
 *
 * Public API:
 *   - uploadFiles(recipeId, category, file, uploadedBy, isPrimary)
 *   - deleteFiles(image)
 *   - migrateFilesToCategory(recipeId, image, newCategory)
 *   - replaceFiles(recipeId, image, blob, options)
 *
 * Image proposal/moderation lives in RecipeImageProposalService.
 */
export class RecipeImageService {
  /**
   * Upload a single recipe image file and return its image-entry metadata.
   * The caller persists the returned object on `recipes/{id}.images[]`.
   *
   * @param {string} recipeId
   * @param {string} category
   * @param {File} file
   * @param {string} uploadedBy
   * @param {boolean} [isPrimary=false]
   * @returns {Promise<Object>} image metadata (id, full, fileName, isPrimary, uploadedBy, access, uploadTimestamp)
   */
  static async uploadFiles(recipeId, category, file, uploadedBy, isPrimary = false) {
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
   * Delete all Storage files associated with a recipe image: the full
   * original, both WebP variants, the `_original` backup (if any) and
   * its WebP variants. The full-size deletion propagates errors;
   * everything else is best-effort.
   *
   * @param {{ full: string }} image
   * @returns {Promise<void>}
   */
  static async deleteFiles({ full }) {
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
   * Move an image's Storage files from its current category path to a
   * new one. Returns an updated image object with the new `full` path.
   * The caller is responsible for persisting the returned object back
   * onto the recipe document.
   *
   * @param {string} recipeId
   * @param {Object} image - Image object with current paths.
   * @param {string} newCategory
   * @returns {Promise<Object>} Updated image with new `full` path.
   */
  // TODO: Consider migrating images to be category agnostic.
  static async migrateFilesToCategory(recipeId, image, newCategory) {
    if (!image || !image.full) {
      throw new Error(
        'RecipeImageService.migrateFilesToCategory: image with `full` path is required',
      );
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

  /**
   * Overwrite an image's Storage bytes with new content. Optionally
   * preserves the current image as a backup at `<path>_original.<ext>`
   * (idempotent — only written if the backup doesn't already exist).
   * Best-effort: deletes the stale _400x400.webp / _1080x1080.webp
   * variants so consumers refresh promptly.
   *
   * This is the pure-Storage half of replacement. For composed
   * doc-aware replacement (lookup image by id, patch image-entry fields
   * after replace) use `RecipeService.replaceImage`.
   *
   * @param {string} recipeId - Reserved for future path-aware logic; not currently used in the body.
   * @param {Object} image - Image entry with `full` path.
   * @param {Blob} blob - New bytes (e.g. from a fetch or canvas).
   * @param {Object} [options]
   * @param {boolean} [options.keepOriginalBackup=true]
   * @returns {Promise<{ backupPath: string, backupCreated: boolean }>}
   */
  static async replaceFiles(recipeId, image, blob, options = {}) {
    if (!image || !image.full) {
      throw new Error('RecipeImageService.replaceFiles: image with `full` path is required');
    }
    if (!blob) throw new Error('RecipeImageService.replaceFiles: blob is required');

    const { keepOriginalBackup = true } = options;
    const originalPath = image.full;
    const backupPath = makeBackupPath(originalPath);

    // Backup (idempotent).
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

    // Overwrite the original.
    await StorageService.uploadFile(blob, originalPath);

    // Best-effort stale WebP variant cleanup so consumers refresh promptly.
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
