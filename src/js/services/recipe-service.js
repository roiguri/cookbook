// src/js/services/recipe-service.js

import { FirestoreService } from './firestore-service.js';
import {
  uploadAndBuildImageMetadata,
  deleteImageFiles,
  migrateImageToCategory,
  removeAllRecipeImages,
  setPrimaryImage as setPrimaryImageInternal,
} from '../utils/recipes/recipe-image-utils.js';
import {
  uploadMediaInstructionFile,
  removeAllMediaInstructions,
} from '../utils/recipes/recipe-media-utils.js';

/**
 * RecipeService — Recipe-Aware Service Layer
 *
 * Single entry point for all recipe owner CRUD. Internalizes image
 * upload/delete/migration and media-instruction upload so callers no longer
 * orchestrate Storage + Firestore manually.
 *
 * Public API:
 *   - get(recipeId)
 *   - list(queryParams)
 *   - generateId()
 *   - create({ recipeData, imagesToUpload, mediaItemsOrdered, uploadedBy })
 *   - update(recipeId, { changes, images, imagesToDelete, mediaItemsOrdered, uploadedBy, approved })
 *   - delete(recipeId)
 *
 * Image proposal/moderation (the pending-images workflow) lives in
 * RecipeImageProposalService.
 */

const RECIPES_COLLECTION = 'recipes';

async function uploadImagesAtomic(recipeId, category, imagesToUpload, uploadedBy) {
  // allSettled (not all) so we can clean up resolutions when any sibling
  // rejects — Promise.all leaves us blind to which uploads actually landed.
  const settled = await Promise.allSettled(
    imagesToUpload.map(({ file, isPrimary }) =>
      uploadAndBuildImageMetadata({
        recipeId,
        category,
        file,
        isPrimary: !!isPrimary,
        uploadedBy: uploadedBy || 'anonymous',
      }),
    ),
  );
  const uploaded = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  const firstRejection = settled.find((s) => s.status === 'rejected');
  if (firstRejection) {
    await Promise.all(
      uploaded.map((img) =>
        deleteImageFiles(img).catch((e) =>
          console.warn('Failed to cleanup partially-uploaded image:', e),
        ),
      ),
    );
    throw firstRejection.reason;
  }
  return uploaded;
}

async function uploadMediaItems(recipeId, mediaItemsOrdered, uploadedBy) {
  const safeOrdered = Array.isArray(mediaItemsOrdered) ? mediaItemsOrdered : [];
  const pendingItems = safeOrdered
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => !!item.file);

  const uploaded = [];
  const failed = [];

  for (const { item, position } of pendingItems) {
    try {
      const metadata = await uploadMediaInstructionFile(
        item.file,
        recipeId,
        uploadedBy || 'anonymous',
      );
      metadata.caption = item.caption || '';
      uploaded.push({ position, metadata });
    } catch (error) {
      failed.push({ position, error: error.message || String(error), originalItem: item });
    }
  }

  const uploadedByPos = new Map(uploaded.map(({ position, metadata }) => [position, metadata]));
  const finalArray = [];
  let order = 0;
  for (let i = 0; i < safeOrdered.length; i++) {
    const item = safeOrdered[i];
    if (item.file) {
      const meta = uploadedByPos.get(i);
      if (meta) {
        finalArray.push({ ...meta, order });
        order++;
      }
      // Failed uploads are simply omitted from the saved array.
    } else {
      const { position: _p, ...rest } = item;
      finalArray.push({ ...rest, order });
      order++;
    }
  }

  return {
    finalArray,
    results: {
      uploaded,
      failed,
      totalPending: pendingItems.length,
      successCount: uploaded.length,
      failedCount: failed.length,
    },
  };
}

function stripUndefined(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      out[k] = v.filter((item) => item !== undefined);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function withFirestoreWriteTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
  ]);
}

export class RecipeService {
  /**
   * Generate a new recipe document ID without writing.
   * @returns {string}
   */
  static generateId() {
    return FirestoreService.generateId(RECIPES_COLLECTION);
  }

  /**
   * Fetch a single recipe by ID (raw document).
   * @param {string} recipeId
   * @returns {Promise<Object|null>}
   */
  static async get(recipeId) {
    return await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
  }

  /**
   * Query recipes with the same shape as FirestoreService.queryDocuments.
   * @param {Object} queryParams
   * @returns {Promise<Array<Object>>}
   */
  static async list(queryParams = {}) {
    return await FirestoreService.queryDocuments(RECIPES_COLLECTION, queryParams);
  }

  /**
   * Create a new recipe. Generates an ID, uploads images and media
   * instructions, then writes the document. On error any successfully
   * uploaded image files are cleaned up (best-effort).
   *
   * @param {Object} params
   * @param {Object} params.recipeData - Base recipe fields (no images/mediaInstructions/toDelete).
   *                                     Caller is responsible for timestamps, userId, approved.
   * @param {Array<{file: File, isPrimary: boolean}>} [params.imagesToUpload]
   * @param {Array<Object>} [params.mediaItemsOrdered] - Ordered media items
   *        from the editor; each entry has either `file` (pending) or
   *        existing metadata.
   * @param {string} params.uploadedBy - User UID for uploads.
   * @returns {Promise<{ recipeId: string, mediaUploadResults: Object }>}
   */
  static async create({ recipeData, imagesToUpload, mediaItemsOrdered, uploadedBy } = {}) {
    if (!recipeData || typeof recipeData !== 'object') {
      throw new Error('RecipeService.create: recipeData is required');
    }
    const recipeId = RecipeService.generateId();
    const cleanedData = stripUndefined(recipeData);
    let uploadedImages = [];

    try {
      if (Array.isArray(imagesToUpload) && imagesToUpload.length > 0) {
        uploadedImages = await uploadImagesAtomic(
          recipeId,
          cleanedData.category,
          imagesToUpload,
          uploadedBy,
        );
      }

      const { finalArray: mediaInstructions, results: mediaUploadResults } = await uploadMediaItems(
        recipeId,
        mediaItemsOrdered,
        uploadedBy,
      );

      const docPayload = { ...cleanedData };
      if (uploadedImages.length > 0) {
        docPayload.images = uploadedImages;
        docPayload.allowImageSuggestions = true;
      }
      if (mediaInstructions.length > 0) {
        docPayload.mediaInstructions = mediaInstructions;
      }

      // Firestore buffers writes while offline rather than rejecting, so race
      // it against a timeout so the caller's UI doesn't hang indefinitely.
      await withFirestoreWriteTimeout(
        FirestoreService.setDocument(RECIPES_COLLECTION, recipeId, docPayload),
        15000,
        'אין חיבור לאינטרנט. אנא בדוק את החיבור ונסה שוב.',
      );

      return { recipeId, mediaUploadResults };
    } catch (error) {
      await Promise.all(
        uploadedImages.map((img) =>
          deleteImageFiles(img).catch((e) =>
            console.warn('Failed to cleanup uploaded image on error:', e),
          ),
        ),
      );
      throw error;
    }
  }

  /**
   * Patch-update an existing recipe. Only fields that are explicitly passed
   * are touched — omit `images` and the recipe's existing images are left
   * alone; omit `mediaItemsOrdered` and existing media is preserved.
   *
   * @param {string} recipeId
   * @param {Object} params
   * @param {Object} [params.changes] - Field changes (no images / media / toDelete).
   * @param {Array<Object>} [params.images] - Form-shaped image entries:
   *        `{source:'new', file, isPrimary, uploadedBy}` or
   *        `{source:'existing', ...metadata}`. Omit to leave images unchanged.
   * @param {Array<Object>} [params.imagesToDelete] - Storage cleanup for
   *        removed images. Independent of `images` so callers can delete
   *        without re-writing the array.
   * @param {Array<Object>} [params.mediaItemsOrdered] - Ordered media items.
   *        Omit to leave media unchanged.
   * @param {string} [params.uploadedBy] - User UID for new uploads.
   * @param {boolean} [params.approved] - Pass `true` to auto-approve (e.g.
   *        manager edits). Omit to leave the approval flag untouched.
   * @returns {Promise<{ mediaUploadResults: Object, migrationWarnings: Array }>}
   */
  static async update(
    recipeId,
    { changes = {}, images, imagesToDelete, mediaItemsOrdered, uploadedBy, approved } = {},
  ) {
    if (!recipeId) {
      throw new Error('RecipeService.update: recipeId is required');
    }

    const originalRecipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!originalRecipe) {
      throw new Error(`RecipeService.update: recipe ${recipeId} not found`);
    }

    const newCategory = changes.category ?? originalRecipe.category;
    const categoryChanged = originalRecipe.category !== newCategory;
    const migrationWarnings = [];
    let mediaUploadResults = {
      uploaded: [],
      failed: [],
      totalPending: 0,
      successCount: 0,
      failedCount: 0,
    };

    // 1. Delete removed images (best-effort).
    if (Array.isArray(imagesToDelete)) {
      for (const img of imagesToDelete) {
        if (img && img.full) {
          await deleteImageFiles(img).catch((e) =>
            console.warn(`Failed to delete removed image ${img.id}:`, e),
          );
        }
      }
    }

    // 2. Process images only when explicitly provided.
    let newImages;
    if (Array.isArray(images)) {
      newImages = [];
      const uploadedThisCall = [];
      try {
        for (const img of images) {
          if (img.source === 'new' && img.file) {
            const meta = await uploadAndBuildImageMetadata({
              recipeId,
              category: newCategory,
              file: img.file,
              isPrimary: !!img.isPrimary,
              uploadedBy: img.uploadedBy || uploadedBy || 'anonymous',
            });
            uploadedThisCall.push(meta);
            newImages.push(meta);
          } else if (img.source === 'existing') {
            // Drop transient form-internal fields; filter undefined to keep
            // Firestore (no ignoreUndefinedProperties) happy.
            const { source: _s, file: _f, preview: _p, ...rest } = img;
            let existingImage = Object.fromEntries(
              Object.entries(rest).filter(([, v]) => v !== undefined),
            );
            if (categoryChanged) {
              try {
                existingImage = await migrateImageToCategory(
                  existingImage,
                  recipeId,
                  originalRecipe.category,
                  newCategory,
                );
              } catch (error) {
                migrationWarnings.push({ imageId: img.id, error: error.message });
              }
            }
            newImages.push(existingImage);
          }
        }
      } catch (error) {
        await Promise.all(
          uploadedThisCall.map((img) =>
            deleteImageFiles(img).catch((e) =>
              console.warn('Failed to cleanup uploaded image on update error:', e),
            ),
          ),
        );
        throw error;
      }
    }

    // 3. Process media only when explicitly provided.
    let mediaInstructions;
    if (Array.isArray(mediaItemsOrdered)) {
      const result = await uploadMediaItems(recipeId, mediaItemsOrdered, uploadedBy);
      mediaInstructions = result.finalArray;
      mediaUploadResults = result.results;
    }

    // 4. Build write payload — only include fields the caller asked us to touch.
    const docPayload = { ...stripUndefined(changes) };
    if (newImages !== undefined) docPayload.images = newImages;
    if (mediaInstructions !== undefined) docPayload.mediaInstructions = mediaInstructions;
    if (approved !== undefined) docPayload.approved = approved;

    await FirestoreService.updateDocument(RECIPES_COLLECTION, recipeId, docPayload);

    return { mediaUploadResults, migrationWarnings };
  }

  /**
   * Mark a single image on a recipe as the primary one. Clears `isPrimary`
   * on the rest. Throws if the recipe has no images.
   * @param {string} recipeId
   * @param {string} imageId
   * @returns {Promise<void>}
   */
  static async setPrimaryImage(recipeId, imageId) {
    return await setPrimaryImageInternal(recipeId, imageId);
  }

  /**
   * Completely delete a recipe and all associated media from Storage.
   * Idempotent if the recipe document does not exist.
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async delete(recipeId) {
    if (!recipeId) {
      throw new Error('RecipeService.delete: recipeId is required');
    }
    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!recipe) {
      console.warn('Recipe not found for deletion:', recipeId);
      return;
    }

    await removeAllRecipeImages(recipeId);

    if (Array.isArray(recipe.mediaInstructions) && recipe.mediaInstructions.length > 0) {
      await removeAllMediaInstructions(recipe.mediaInstructions);
    }

    await FirestoreService.deleteDocument(RECIPES_COLLECTION, recipeId);
  }
}

export const recipeService = RecipeService;
