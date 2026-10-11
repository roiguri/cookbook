// src/js/services/recipes/recipe-service.js

import { Timestamp } from 'firebase/firestore';
import { FirestoreService } from '../_firebase/firestore-service.js';
import { RecipeImageService } from './recipe-image-service.js';
import { MediaInstructionService } from './media-instruction-service.js';
import { captureError } from '../logger.js';

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
 *   - listPublished(queryParams)
 *   - generateId()
 *   - create({ recipeData, imagesToUpload, mediaItemsOrdered, uploadedBy })
 *   - update(recipeId, { changes, images, imagesToDelete, mediaItemsOrdered, uploadedBy, publish })
 *   - delete(recipeId)
 *   - setPrimaryImage(recipeId, imageId)
 *   - replaceImage(recipeId, imageId, blob, options)
 *
 * Image changes from other family members go through edit suggestions
 * (RecipeEditSuggestionService); the family-book approval queue lives in
 * RecipeSubmissionService.
 *
 * Visibility: `visibility` ('private' | 'published') says whether a recipe is
 * public, and `authorId` who wrote it. The legacy `approved` / `userId` fields
 * are no longer written or read (older recipes still carry them until the data
 * cleanup, #390 C1).
 */

const RECIPES_COLLECTION = 'recipes';

export const VISIBILITY = Object.freeze({ PRIVATE: 'private', PUBLISHED: 'published' });
export const STAGE = Object.freeze({ TO_TRY: 'to-try', TESTED: 'tested' });

/**
 * The model fields of a recipe being created: `authorId`, `visibility`
 * (private unless said otherwise) and `stage` ('tested' by default). The legacy
 * `userId` / `approved` are accepted as input but never written.
 */
function withModelFields(data) {
  const { userId, approved, ...out } = data;
  out.authorId = out.authorId ?? userId ?? null;
  const published =
    out.visibility !== undefined ? out.visibility === VISIBILITY.PUBLISHED : approved === true;
  out.visibility = published ? VISIBILITY.PUBLISHED : VISIBILITY.PRIVATE;
  if (out.stage === undefined) out.stage = STAGE.TESTED;
  return out;
}

async function uploadImagesAtomic(recipeId, imagesToUpload, uploadedBy) {
  // allSettled (not all) so we can clean up resolutions when any sibling
  // rejects — Promise.all leaves us blind to which uploads actually landed.
  const settled = await Promise.allSettled(
    imagesToUpload.map(({ file, isPrimary }) =>
      RecipeImageService.uploadFile(recipeId, file, {
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
        RecipeImageService.deleteFiles(img).catch((e) =>
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
      const metadata = await MediaInstructionService.upload(
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
   * Query published recipes only. The visibility filter is required for anyone
   * who isn't a manager: Firestore rejects a query that could return a recipe
   * the caller may not read.
   * @param {Object} [queryParams] - Extra `where` clauses, `orderBy`, `limit`.
   * @returns {Promise<Array<Object>>}
   */
  static async listPublished(queryParams = {}) {
    return await FirestoreService.queryDocuments(RECIPES_COLLECTION, {
      ...queryParams,
      where: [['visibility', '==', VISIBILITY.PUBLISHED], ...(queryParams.where || [])],
    });
  }

  /**
   * A user's own recipes (My recipes) — private and published (publishing is in
   * place, so a published recipe stays in its author's library) — newest first.
   * Equality filters only — no composite index needed; sorting happens here.
   * @param {string} authorId - The signed-in user's uid.
   * @param {Object} [options]
   * @param {string} [options.stage] - STAGE.TO_TRY or STAGE.TESTED; omit for both.
   * @param {Array<Array>} [options.where] - Extra `where` clauses (e.g. category).
   * @returns {Promise<Array<Object>>}
   */
  static async listMine(authorId, { stage, where = [] } = {}) {
    if (!authorId) return [];
    const recipes = await FirestoreService.queryDocuments(RECIPES_COLLECTION, {
      where: [['authorId', '==', authorId], ...(stage ? [['stage', '==', stage]] : []), ...where],
    });
    const time = (r) => r.creationTime?.toMillis?.() ?? new Date(r.creationTime ?? 0).getTime();
    return recipes.sort((a, b) => time(b) - time(a));
  }

  /**
   * Create a new recipe. Generates an ID, uploads images and media
   * instructions, then writes the document. On error any successfully
   * uploaded image files are cleaned up (best-effort).
   *
   * @param {Object} params
   * @param {Object} params.recipeData - Base recipe fields (no images/mediaInstructions/toDelete).
   *                                     Caller sets authorId and visibility;
   *                                     the other of each pair and a default stage are filled in. creationTime is service-stamped.
   * @param {Array<{file: File, isPrimary: boolean}>} [params.imagesToUpload]
   * @param {Array<Object>} [params.mediaItemsOrdered] - Ordered media items
   *        from the editor; each entry has either `file` (pending) or
   *        existing metadata.
   * @param {string} params.uploadedBy - User UID for uploads.
   * @param {(recipeId: string) => Array<Object>} [params.alsoWrite] - Extra
   *        `FirestoreService.batchWrite` operations committed atomically with the
   *        recipe (e.g. its submission — `RecipeSubmissionService.submissionWrite`).
   * @returns {Promise<{ recipeId: string, mediaUploadResults: Object }>}
   */
  static async create({
    recipeData,
    imagesToUpload,
    mediaItemsOrdered,
    uploadedBy,
    alsoWrite,
  } = {}) {
    if (!recipeData || typeof recipeData !== 'object') {
      throw new Error('RecipeService.create: recipeData is required');
    }
    const recipeId = RecipeService.generateId();
    const cleanedData = withModelFields(stripUndefined(recipeData));
    let uploadedImages = [];

    try {
      if (Array.isArray(imagesToUpload) && imagesToUpload.length > 0) {
        uploadedImages = await uploadImagesAtomic(recipeId, imagesToUpload, uploadedBy);
      }

      const { finalArray: mediaInstructions, results: mediaUploadResults } = await uploadMediaItems(
        recipeId,
        mediaItemsOrdered,
        uploadedBy,
      );

      const docPayload = { ...cleanedData };
      docPayload.creationTime = Timestamp.now();
      if (uploadedImages.length > 0) {
        docPayload.images = uploadedImages;
      }
      if (mediaInstructions.length > 0) {
        docPayload.mediaInstructions = mediaInstructions;
      }

      // Firestore buffers writes while offline rather than rejecting, so race
      // it against a timeout so the caller's UI doesn't hang indefinitely.
      const extraWrites = alsoWrite ? alsoWrite(recipeId) : [];
      const write = extraWrites.length
        ? FirestoreService.batchWrite([
            { type: 'set', collection: RECIPES_COLLECTION, id: recipeId, data: docPayload },
            ...extraWrites,
          ])
        : FirestoreService.setDocument(RECIPES_COLLECTION, recipeId, docPayload);
      await withFirestoreWriteTimeout(
        write,
        15000,
        'אין חיבור לאינטרנט. אנא בדוק את החיבור ונסה שוב.',
      );

      return { recipeId, mediaUploadResults };
    } catch (error) {
      await Promise.all(
        uploadedImages.map((img) =>
          RecipeImageService.deleteFiles(img).catch((e) =>
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
   * @param {Array<string>} [params.mediaToDelete] - Storage paths of media files
   *        removed in the editor, deleted on save (deferred-delete contract).
   * @param {string} [params.uploadedBy] - User UID for new uploads.
   * @param {boolean} [params.publish] - `true` publishes (sets `visibility`
   *        'published', e.g. a manager's edit), `false` makes it private. Omit to
   *        leave visibility untouched.
   * @returns {Promise<{ mediaUploadResults: Object }>}
   */
  static async update(
    recipeId,
    {
      changes = {},
      images,
      imagesToDelete,
      mediaItemsOrdered,
      mediaToDelete,
      uploadedBy,
      publish,
    } = {},
  ) {
    if (!recipeId) {
      throw new Error('RecipeService.update: recipeId is required');
    }

    const originalRecipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!originalRecipe) {
      throw new Error(`RecipeService.update: recipe ${recipeId} not found`);
    }

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
          await RecipeImageService.deleteFiles(img).catch((e) =>
            console.warn(`Failed to delete removed image ${img.id}:`, e),
          );
        }
      }
    }

    // 1b. Delete removed media files (best-effort, deferred from the editor).
    if (Array.isArray(mediaToDelete) && mediaToDelete.length > 0) {
      await MediaInstructionService.deleteMany(mediaToDelete).catch((e) =>
        console.warn('Failed to delete removed media:', e),
      );
    }

    // 2. Process images only when explicitly provided.
    let newImages;
    if (Array.isArray(images)) {
      newImages = [];
      const uploadedThisCall = [];
      try {
        for (const img of images) {
          if (img.source === 'new' && img.file) {
            const meta = await RecipeImageService.uploadFile(recipeId, img.file, {
              isPrimary: !!img.isPrimary,
              uploadedBy: img.uploadedBy || uploadedBy || 'anonymous',
            });
            uploadedThisCall.push(meta);
            newImages.push(meta);
          } else if (img.source === 'existing') {
            // Drop transient form-internal fields; filter undefined to keep
            // Firestore (no ignoreUndefinedProperties) happy.
            // Files stay where they are: the category isn't part of the Storage path.
            const { source: _s, file: _f, preview: _p, ...rest } = img;
            newImages.push(
              Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
            );
          }
        }
      } catch (error) {
        await Promise.all(
          uploadedThisCall.map((img) =>
            RecipeImageService.deleteFiles(img).catch((e) =>
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
    if (publish !== undefined) {
      docPayload.visibility = publish ? VISIBILITY.PUBLISHED : VISIBILITY.PRIVATE;
    }

    await FirestoreService.updateDocument(RECIPES_COLLECTION, recipeId, docPayload);

    return { mediaUploadResults };
  }

  /**
   * Mark the author's "to try" recipe as tested (it moves to their library).
   * The only path that changes stage to tested after creation — used by the
   * recipe page menu and the My recipes card button alike.
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async markTested(recipeId) {
    if (!recipeId) throw new Error('RecipeService.markTested: recipeId is required');
    await FirestoreService.updateDocument(RECIPES_COLLECTION, recipeId, {
      stage: STAGE.TESTED,
      testedAt: Timestamp.now(),
    });
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

    const imageDeletes = [];
    if (Array.isArray(recipe.images)) {
      for (const image of recipe.images) {
        if (image && image.full) {
          imageDeletes.push(
            RecipeImageService.deleteFiles(image).catch((err) =>
              console.warn(`Failed to delete files for image ${image.id}:`, err),
            ),
          );
        }
      }
    }
    await Promise.all(imageDeletes);

    if (Array.isArray(recipe.mediaInstructions) && recipe.mediaInstructions.length > 0) {
      await MediaInstructionService.removeAll(recipe.mediaInstructions);
    }

    await FirestoreService.deleteDocument(RECIPES_COLLECTION, recipeId);
  }

  /**
   * Mark a single image on a recipe as primary; clears `isPrimary` on
   * the rest. Throws if the recipe has no images.
   *
   * @param {string} recipeId
   * @param {string} imageId
   * @returns {Promise<void>}
   */
  static async setPrimaryImage(recipeId, imageId) {
    if (!recipeId) throw new Error('RecipeService.setPrimaryImage: recipeId is required');
    if (!imageId) throw new Error('RecipeService.setPrimaryImage: imageId is required');

    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!recipe || !Array.isArray(recipe.images)) {
      throw new Error('RecipeService.setPrimaryImage: no images to update');
    }
    const images = recipe.images.map((img) => ({ ...img, isPrimary: img.id === imageId }));
    await FirestoreService.updateDocument(RECIPES_COLLECTION, recipeId, { images });
  }

  /**
   * Replace the bytes of an existing image on a recipe. Delegates Storage
   * work (backup + overwrite + variant cleanup) to
   * `RecipeImageService.replaceFiles`. Optionally patches the matching image
   * entry inside `recipes/{id}.images[]` with caller-supplied fields
   * (best-effort: the patch failure does NOT roll back the Storage write,
   * since the bytes have already changed).
   *
   * @param {string} recipeId
   * @param {string} imageId
   * @param {Blob} blob - New image bytes.
   * @param {Object} [options]
   * @param {boolean} [options.keepOriginalBackup=true]
   * @param {Object} [options.fieldUpdates] - Patch merged into the matching image entry.
   * @returns {Promise<{ backupPath: string, backupCreated: boolean }>}
   */
  static async replaceImage(recipeId, imageId, blob, options = {}) {
    if (!recipeId) throw new Error('RecipeService.replaceImage: recipeId is required');
    if (!imageId) throw new Error('RecipeService.replaceImage: imageId is required');
    if (!blob) throw new Error('RecipeService.replaceImage: blob is required');

    const { keepOriginalBackup = true, fieldUpdates } = options;

    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!recipe) {
      throw new Error(`RecipeService.replaceImage: recipe ${recipeId} not found`);
    }
    const images = Array.isArray(recipe.images) ? recipe.images : [];
    const image = images.find((img) => img.id === imageId);
    if (!image) {
      throw new Error(
        `RecipeService.replaceImage: image ${imageId} not found on recipe ${recipeId}`,
      );
    }

    const result = await RecipeImageService.replaceFiles(recipeId, image, blob, {
      keepOriginalBackup,
    });

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
        console.error(
          `RecipeService.replaceImage: fieldUpdates patch failed for image ${imageId}:`,
          err,
        );
        captureError(err, {
          service: 'recipe',
          op: 'replaceImage:fieldUpdatesPatch',
          recipeId,
          imageId,
        });
      }
    }

    return result;
  }
}

export const recipeService = RecipeService;
