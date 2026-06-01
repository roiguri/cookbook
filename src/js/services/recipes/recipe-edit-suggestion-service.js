// src/js/services/recipes/recipe-edit-suggestion-service.js

import { Timestamp } from 'firebase/firestore';
import { FirestoreService } from '../_firebase/firestore-service.js';
import { RecipeImageService } from './recipe-image-service.js';
import { MediaInstructionService } from './media-instruction-service.js';
import { captureError } from '../logger.js';

const COLLECTION = 'recipe_edit_suggestions';
const RECIPES_COLLECTION = 'recipes';

/**
 * Recursively drop `undefined` values — Firestore (no
 * ignoreUndefinedProperties) rejects them. Plain objects and arrays are
 * walked; everything else (Timestamp, Date, primitives) passes through.
 */
function stripUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined).map(stripUndefinedDeep);
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * RecipeEditSuggestionService — Edit Suggestion & Moderation
 *
 * Distinct workflow from owner CRUD: any signed-in user can suggest an edit to
 * an existing recipe; managers review and approve/reject from the dashboard.
 * The live recipe is never touched until a manager applies the change through
 * `RecipeService.update`. Suggestions live in their own `recipe_edit_suggestions`
 * collection (one document per suggestion) so the publicly-read recipe document
 * stays lean and a full audit trail is kept.
 *
 * New image/media files referenced by a suggestion are uploaded to the recipe's
 * Storage area at suggestion time (mirroring RecipeImageProposalService) and
 * recorded in `storagePaths[]` for orphan cleanup on rejection.
 *
 * Public API (Milestone 1, Slice 1):
 *   - create({ recipeId, suggestedBy, proposedChanges, mediaItemsOrdered, note })
 * Review methods (listPending / approve / reject) are added in Slice 2.
 */
export class RecipeEditSuggestionService {
  /**
   * Create a pending edit suggestion. Uploads any new image/media files in
   * `proposedChanges` / `mediaItemsOrdered` to the recipe's Storage area and
   * rewrites them to persisted path references, then writes the suggestion
   * document with `status: 'pending'`.
   *
   * @param {Object} params
   * @param {string} params.recipeId - Target recipe.
   * @param {string} params.suggestedBy - UID of the suggester.
   * @param {Object} params.proposedChanges - Form-collected payload from
   *        `recipe-form-component` (same shape edit_recipe_component destructures):
   *        base fields + `images` (form shape) [+ `toDelete`/`mediaToDelete`, ignored].
   * @param {Array<Object>} [params.mediaItemsOrdered] - Ordered media items from
   *        the editor (each has either `file` for a new upload or existing metadata).
   * @param {string} [params.note] - Optional free-text note to the manager.
   * @returns {Promise<{ suggestionId: string }>}
   */
  static async create({ recipeId, suggestedBy, proposedChanges, mediaItemsOrdered, note } = {}) {
    if (!recipeId) throw new Error('RecipeEditSuggestionService.create: recipeId is required');
    if (!proposedChanges || typeof proposedChanges !== 'object') {
      throw new Error('RecipeEditSuggestionService.create: proposedChanges is required');
    }

    const uploadedBy = suggestedBy || 'anonymous';
    const recipe = await FirestoreService.getDocument(RECIPES_COLLECTION, recipeId);
    if (!recipe) {
      throw new Error(`RecipeEditSuggestionService.create: recipe ${recipeId} not found`);
    }
    const category = proposedChanges.category ?? recipe.category;

    // Separate the image/media payload from the plain recipe fields. toDelete /
    // mediaToDelete are intentionally dropped: deletions are reconstructed at
    // approval time by comparing the suggested set against the live recipe, so
    // the suggestion never mutates the live recipe's Storage files.
    const {
      images: formImages = [],
      mediaInstructions: _ignoredMedia,
      toDelete: _ignoredToDelete,
      mediaToDelete: _ignoredMediaToDelete,
      ...baseFields
    } = proposedChanges;

    const storagePaths = [];
    const uploadedThisCall = [];
    try {
      // Images: upload new files, keep existing metadata. Result is a plain
      // RecipeImage[] the edit form can re-render directly on approval.
      const processedImages = [];
      for (const img of formImages) {
        if (img && img.source === 'new' && img.file) {
          const meta = await RecipeImageService.uploadFile(recipeId, category, img.file, {
            isPrimary: !!img.isPrimary,
            uploadedBy,
          });
          uploadedThisCall.push(meta);
          if (meta.full) storagePaths.push({ type: 'image', path: meta.full });
          processedImages.push(meta);
        } else if (img) {
          const { source: _s, file: _f, preview: _p, ...rest } = img;
          processedImages.push(
            Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
          );
        }
      }

      // Media instructions: upload pending files, preserve existing entries and
      // their order. Mirrors RecipeService's media handling.
      const safeOrdered = Array.isArray(mediaItemsOrdered) ? mediaItemsOrdered : [];
      const processedMedia = [];
      let order = 0;
      for (const item of safeOrdered) {
        if (item && item.file) {
          const meta = await MediaInstructionService.upload(item.file, recipeId, uploadedBy);
          meta.caption = item.caption || '';
          uploadedThisCall.push({ mediaPath: meta.path });
          if (meta.path) storagePaths.push({ type: 'media', path: meta.path });
          processedMedia.push({ ...meta, order });
          order++;
        } else if (item) {
          const { file: _f, position: _pos, ...rest } = item;
          processedMedia.push({ ...rest, order });
          order++;
        }
      }

      const storedChanges = { ...baseFields, images: processedImages };
      if (processedMedia.length > 0) storedChanges.mediaInstructions = processedMedia;

      const suggestionId = FirestoreService.generateId(COLLECTION);
      const docPayload = stripUndefinedDeep({
        recipeId,
        recipeName: recipe.name || '',
        suggestedBy: uploadedBy,
        status: 'pending',
        proposedChanges: storedChanges,
        storagePaths,
        note: note || null,
        rejectionReason: null,
        reviewedBy: null,
        createdAt: Timestamp.now(),
        reviewedAt: null,
      });

      await FirestoreService.setDocument(COLLECTION, suggestionId, docPayload);
      return { suggestionId };
    } catch (error) {
      // Best-effort cleanup of anything uploaded before the failure.
      await Promise.all(
        uploadedThisCall.map((entry) =>
          entry.mediaPath
            ? MediaInstructionService.delete(entry.mediaPath).catch(() => {})
            : RecipeImageService.deleteFiles(entry).catch(() => {}),
        ),
      );
      captureError(error, {
        service: 'recipe-edit-suggestion',
        op: 'create',
        recipeId,
        uid: uploadedBy,
      });
      throw error;
    }
  }
}

export const recipeEditSuggestionService = RecipeEditSuggestionService;
