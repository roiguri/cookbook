// src/js/services/recipes/recipe-image-service.js

import { StorageService } from '../_firebase/storage-service.js';
import {
  getImageStoragePath,
  generateImageId,
  getPrimaryImage,
} from '../../utils/recipes/recipe-image-utils.js';
import { captureError } from '../logger.js';

function makeBackupPath(fullPath) {
  return fullPath.replace(/(\.[^.]+)$/, '_original$1');
}

async function fileExists(path) {
  try {
    await StorageService.getMetadata(path);
    return true;
  } catch {
    // silent: existence probe — false is the expected return when file is absent
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
 *   - uploadFile(recipeId, file, options)
 *   - replaceFiles(recipeId, image, blob, options)
 *   - deleteFiles(image)
 *   - getOptimizedUrl(image, size)
 *   - getPrimaryUrl(recipe, size)
 *   - getFullUrl(image)
 *
 * Image proposal/moderation lives in RecipeImageProposalService.
 * Primary-image selection and image-entry patches live on RecipeService.
 */
export class RecipeImageService {
  /**
   * Upload a single image file to Storage under the recipe's images folder (or
   * `options.folder`, e.g. an edit suggestion's folder) and return its metadata entry (id, full path, fileName, isPrimary,
   * uploadedBy, access, uploadTimestamp). Storage only — does NOT touch
   * `recipes/{id}.images[]`; caller is responsible for persisting the
   * returned entry on the recipe document. The Storage Resize extension
   * regenerates WebP variants asynchronously.
   *
   * @param {string} recipeId
   * @param {File} file
   * @param {Object} [options]
   * @param {boolean} [options.isPrimary=false]
   * @param {string} [options.uploadedBy]
   * @param {string} [options.folder] - Target folder; defaults to the recipe's images folder.
   * @returns {Promise<Object>} image metadata entry
   */
  static async uploadFile(recipeId, file, options = {}) {
    const { isPrimary = false, uploadedBy, folder } = options;
    const fileExtension = file.name.split('.').pop();
    // Every upload gets its own name, so an upload never overwrites an existing
    // file (Storage rules only let managers overwrite). Which image is primary is
    // the `isPrimary` flag on the recipe's images[], not the file name.
    const id = generateImageId();
    const fileName = `${id}.${fileExtension}`;
    const fullPath = folder ? `${folder}/${fileName}` : getImageStoragePath(recipeId, fileName);
    await StorageService.uploadFile(file, fullPath);

    return {
      id,
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
      StorageService.deleteFile(originalPath.replace(/\.[^.]+$/, '_400x400.webp')).catch(() => {}), // silent: best-effort WebP variant cleanup
      StorageService.deleteFile(originalPath.replace(/\.[^.]+$/, '_1080x1080.webp')).catch(
        () => {}, // silent: best-effort WebP variant cleanup
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
      StorageService.deleteFile(optimized400).catch(() => {}), // silent: best-effort WebP variant cleanup
      StorageService.deleteFile(optimized1080).catch(() => {}), // silent: best-effort WebP variant cleanup
      StorageService.deleteFile(originalBackup).catch(() => {}), // silent: best-effort backup cleanup; may not exist
      StorageService.deleteFile(originalOpt400).catch(() => {}), // silent: best-effort backup variant cleanup
      StorageService.deleteFile(originalOpt1080).catch(() => {}), // silent: best-effort backup variant cleanup
    ]);
  }

  /**
   * Resolve the download URL for an optimized variant of a single image,
   * with graceful fallbacks. Order:
   *   1. `image.preview` (local form-preview blob URL) if present.
   *   2. The `_<size>.webp` variant generated by the Storage Resize extension.
   *   3. The full-size original (legacy / latency-tolerant).
   *   4. `null` (caller renders a placeholder).
   *
   * @param {{ full?: string, preview?: string } | null | undefined} image
   * @param {string} [size='400x400']
   * @returns {Promise<string|null>}
   */
  static async getOptimizedUrl(image, size = '400x400') {
    if (!image) return null;
    if (image.preview) return image.preview;
    if (!image.full) return null;

    const optimizedPath = image.full.replace(/\.[^.]+$/, `_${size}.webp`);
    try {
      return await StorageService.getFileUrl(optimizedPath);
    } catch {
      // silent: WebP variant not yet generated; falling back to full-size original
      try {
        return await StorageService.getFileUrl(image.full);
      } catch {
        // silent: full-size original also unavailable; caller renders placeholder
        return null;
      }
    }
  }

  /**
   * Resolve the download URL for a recipe's primary image (optimized
   * variant), or `null` if the recipe has no usable images. Honors the
   * `isPrimary` flag; falls back to the first image when none is marked.
   *
   * @param {Object} recipe
   * @param {string} [size='400x400']
   * @returns {Promise<string|null>}
   */
  static async getPrimaryUrl(recipe, size = '400x400') {
    const primary = getPrimaryImage(recipe);
    if (!primary) return null;
    return RecipeImageService.getOptimizedUrl(primary, size);
  }

  /**
   * Resolve the download URL for an image's full-size original file.
   * Takes a typed image (must have `.full`) rather than a raw Storage path
   * so the service surface stays scoped to recipe-image objects (no
   * generic storage-URL resolver leaks into call sites).
   *
   * @param {{ full: string }} image
   * @returns {Promise<string>}
   */
  static async getFullUrl(image) {
    if (!image || !image.full) {
      throw new Error('RecipeImageService.getFullUrl: image.full is required');
    }
    return StorageService.getFileUrl(image.full);
  }
}

export const recipeImageService = RecipeImageService;
