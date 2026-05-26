// src/js/services/recipes/media-instruction-service.js

import { StorageService } from '../_firebase/storage-service.js';
import {
  validateMediaFile,
  generateMediaInstructionId,
} from '../../utils/recipes/recipe-media-utils.js';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

function getMediaType(file) {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return 'image';
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) return 'video';
  return null;
}

/**
 * MediaInstructionService — Media-Instruction Storage Ops
 *
 * Media instructions are step-level cooking videos/images attached to a
 * recipe. Their storage paths are the domain identifier (no richer object
 * to type against, unlike RecipeImage), so URL/delete methods take string
 * paths by design.
 *
 * Public API:
 *   - upload(file, recipeId, userId, onProgress)
 *   - delete(filePath)
 *   - deleteMany(filePaths)
 *   - removeAll(mediaInstructions)
 *   - getUrl(storagePath)
 *
 * The recipe document's `mediaInstructions[]` array is owned by
 * RecipeService — this service does not touch Firestore.
 */
export class MediaInstructionService {
  /**
   * Validate, upload, and build metadata for one media-instruction file.
   * Storage path follows `recipes/{recipeId}/media-instructions/{id}_{sanitizedName}`.
   *
   * @param {File} file
   * @param {string} recipeId
   * @param {string} userId
   * @param {Function} [onProgress] - Optional (percent: number) => void.
   * @returns {Promise<Object>} metadata entry
   */
  static async upload(file, recipeId, userId, onProgress) {
    const validation = validateMediaFile(file);
    if (!validation.isValid) {
      throw new Error(`בדיקת הקובץ נכשלה: ${validation.errors.join(', ')}`);
    }
    if (!recipeId || typeof recipeId !== 'string') {
      throw new Error('Invalid recipeId');
    }
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId');
    }

    try {
      const mediaId = generateMediaInstructionId();
      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `recipes/${recipeId}/media-instructions/${mediaId}_${sanitizedFileName}`;

      const mediaType = getMediaType(file);
      if (!mediaType) {
        throw new Error('Unable to determine media type');
      }

      // TODO: Implement progress tracking with Firebase Storage 'state_changed' listener
      // For now, onProgress is accepted but not used (can be implemented later).
      if (typeof onProgress === 'function') onProgress(0);

      await StorageService.uploadFile(file, storagePath);

      if (typeof onProgress === 'function') onProgress(100);

      return {
        id: mediaId,
        path: storagePath,
        caption: '',
        type: mediaType,
        order: 0,
        uploadedBy: userId,
        uploadedAt: new Date(),
      };
    } catch (error) {
      console.error('Error uploading media instruction file:', error);
      throw new Error(`העלאת הקובץ נכשלה: ${error.message}`);
    }
  }

  /**
   * Delete a single media-instruction file from Storage. Treats
   * `storage/object-not-found` as success (already gone).
   *
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  static async delete(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid filePath');
    }
    try {
      await StorageService.deleteFile(filePath);
    } catch (error) {
      if (error.code === 'storage/object-not-found') {
        console.warn(`Media instruction file not found (may already be deleted): ${filePath}`);
        return;
      }
      console.error('Error deleting media instruction file:', error);
      throw new Error(`מחיקת הקובץ נכשלה: ${error.message}`);
    }
  }

  /**
   * Delete many media-instruction files in parallel. Per-file errors are
   * collected; the call always resolves with a per-path summary.
   *
   * @param {string[]} filePaths
   * @returns {Promise<{ success: number, failed: number, errors: Array }>}
   */
  static async deleteMany(filePaths) {
    if (!Array.isArray(filePaths)) {
      throw new Error('filePaths must be an array');
    }
    const results = { success: 0, failed: 0, errors: [] };
    await Promise.all(
      filePaths.map(async (path) => {
        try {
          await MediaInstructionService.delete(path);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({ path, error: error.message });
        }
      }),
    );
    return results;
  }

  /**
   * Convenience: deleteMany over a recipe's `mediaInstructions[]` array
   * (mapping each entry's `.path`). Returns the empty-success summary for
   * a missing/empty input.
   *
   * @param {Array<{ path: string }>} mediaInstructions
   * @returns {Promise<{ success: number, failed: number, errors: Array }>}
   */
  static async removeAll(mediaInstructions) {
    if (!Array.isArray(mediaInstructions) || mediaInstructions.length === 0) {
      return { success: 0, failed: 0, errors: [] };
    }
    const filePaths = mediaInstructions.map((media) => media.path);
    return MediaInstructionService.deleteMany(filePaths);
  }

  /**
   * Resolve the download URL for a media-instruction storage path.
   * Passes through `blob:` / `data:` URLs unchanged.
   *
   * @param {string} storagePath
   * @returns {Promise<string>}
   */
  static async getUrl(storagePath) {
    if (!storagePath) return '';
    if (storagePath.startsWith('blob:') || storagePath.startsWith('data:')) {
      return storagePath;
    }
    try {
      return await StorageService.getFileUrl(storagePath);
    } catch (error) {
      console.error('Error getting media instruction URL:', error);
      throw new Error(`קבלת כתובת המדיה נכשלה: ${error.message}`);
    }
  }
}

export const mediaInstructionService = MediaInstructionService;
