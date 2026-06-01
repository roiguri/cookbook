/*
 * Recipe Diff Utilities
 * ---------------------
 * Pure helpers for comparing a live recipe against a proposed edit (the
 * `proposedChanges` of a recipe edit suggestion) and for turning a suggestion
 * into an apply payload. No I/O, no service/SDK imports.
 *
 * Exported:
 *   - diffRecipe(current, proposed): changed-field descriptors (for the review UI).
 *   - buildApplyPayload(current, proposed): RecipeService.update args to apply a suggestion.
 *
 * Used by the manager dashboard to review and apply an edit suggestion.
 */

import { formatIngredientAmount } from './recipe-ingredients-utils.js';

/**
 * Normalize a single ingredient to the readable string the recipe view renders
 * (`<amount> <unit> <item>`). Ingredients are stored as `{ amount, unit, item }`
 * objects; comparing the raw objects by reference would report a change on every
 * round-trip and render as "[object Object]".
 */
function ingredientToText(ing) {
  if (typeof ing === 'string') return ing.trim();
  if (!ing || typeof ing !== 'object') return String(ing ?? '').trim();
  const parts = [formatIngredientAmount(ing.amount), ing.unit, ing.item]
    .map((s) => (s ?? '').toString().trim())
    .filter(Boolean);
  return parts.join(' ');
}

/** Normalize an instruction (string, or `{ text }` object) to a string. */
function instructionToText(ins) {
  if (typeof ins === 'string') return ins.trim();
  if (ins && typeof ins === 'object') return (ins.text ?? '').toString().trim();
  return String(ins ?? '').trim();
}

/** Flatten ingredients (flat array or `ingredientSections`) to readable string[]. */
function flattenIngredients(recipe) {
  if (Array.isArray(recipe?.ingredientSections) && recipe.ingredientSections.length > 0) {
    const out = [];
    for (const section of recipe.ingredientSections) {
      if (section?.title) out.push(`— ${section.title} —`);
      for (const item of section?.items || []) out.push(ingredientToText(item));
    }
    return out;
  }
  return Array.isArray(recipe?.ingredients) ? recipe.ingredients.map(ingredientToText) : [];
}

/** Flatten instructions (flat array or staged `stages`) to readable string[]. */
function flattenInstructions(recipe) {
  if (Array.isArray(recipe?.stages) && recipe.stages.length > 0) {
    const out = [];
    for (const stage of recipe.stages) {
      if (stage?.title) out.push(`— ${stage.title} —`);
      for (const ins of stage?.instructions || []) out.push(instructionToText(ins));
    }
    return out;
  }
  return Array.isArray(recipe?.instructions) ? recipe.instructions.map(instructionToText) : [];
}

function listsEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function imageIds(recipe) {
  return Array.isArray(recipe?.images) ? recipe.images.map((img) => img.id).filter(Boolean) : [];
}

function primaryId(recipe) {
  if (!Array.isArray(recipe?.images)) return null;
  const primary = recipe.images.find((img) => img.isPrimary);
  return primary?.id || recipe.images[0]?.id || null;
}

const SCALAR_FIELDS = [
  { field: 'name', label: 'שם' },
  { field: 'description', label: 'תיאור' },
  { field: 'category', label: 'קטגוריה' },
  { field: 'prepTime', label: 'זמן הכנה' },
  { field: 'waitTime', label: 'זמן המתנה' },
  { field: 'servings', label: 'מנות' },
  { field: 'attribution', label: 'קרדיט' },
];

/**
 * Compare a live recipe against a proposed edit and return only the fields that
 * changed. Each descriptor is one of:
 *   - { field, label, type: 'scalar', before, after }
 *   - { field, label, type: 'list', before: string[], after: string[] }
 *   - { field: 'images', label, type: 'images', before, after, primaryChanged }
 *
 * @param {Object} current - The live recipe (raw Firestore shape).
 * @param {Object} proposed - The suggested recipe state (proposedChanges).
 * @returns {Array<Object>} changed-field descriptors (empty if nothing changed).
 */
export function diffRecipe(current = {}, proposed = {}) {
  const changes = [];

  for (const { field, label } of SCALAR_FIELDS) {
    if (!(field in proposed)) continue; // only compare fields the suggestion carries
    const before = current[field] ?? '';
    const after = proposed[field] ?? '';
    if (before !== after) changes.push({ field, label, type: 'scalar', before, after });
  }

  const beforeIng = flattenIngredients(current);
  const afterIng = flattenIngredients(proposed);
  if (!listsEqual(beforeIng, afterIng)) {
    changes.push({
      field: 'ingredients',
      label: 'מצרכים',
      type: 'list',
      before: beforeIng,
      after: afterIng,
    });
  }

  const beforeIns = flattenInstructions(current);
  const afterIns = flattenInstructions(proposed);
  if (!listsEqual(beforeIns, afterIns)) {
    changes.push({
      field: 'instructions',
      label: 'הוראות הכנה',
      type: 'list',
      before: beforeIns,
      after: afterIns,
    });
  }

  if ('comments' in proposed) {
    const b = Array.isArray(current.comments) ? current.comments : [];
    const a = Array.isArray(proposed.comments) ? proposed.comments : [];
    if (!listsEqual(b, a)) {
      changes.push({ field: 'comments', label: 'הערות', type: 'list', before: b, after: a });
    }
  }

  if ('relatedRecipes' in proposed) {
    const b = Array.isArray(current.relatedRecipes) ? current.relatedRecipes : [];
    const a = Array.isArray(proposed.relatedRecipes) ? proposed.relatedRecipes : [];
    if (!listsEqual(b, a)) {
      changes.push({
        field: 'relatedRecipes',
        label: 'מתכונים קשורים',
        type: 'list',
        before: b,
        after: a,
      });
    }
  }

  if ('images' in proposed) {
    const beforeIds = imageIds(current);
    const afterIds = imageIds(proposed);
    const primaryChanged = primaryId(current) !== primaryId(proposed);
    if (!listsEqual(beforeIds, afterIds) || primaryChanged) {
      changes.push({
        field: 'images',
        label: 'תמונות',
        type: 'images',
        before: beforeIds.length,
        after: afterIds.length,
        primaryChanged,
      });
    }
  }

  if ('mediaInstructions' in proposed) {
    const bPaths = (Array.isArray(current.mediaInstructions) ? current.mediaInstructions : []).map(
      (m) => m.path,
    );
    const aPaths = (
      Array.isArray(proposed.mediaInstructions) ? proposed.mediaInstructions : []
    ).map((m) => m.path);
    if (!listsEqual(bPaths, aPaths)) {
      changes.push({
        field: 'media',
        label: 'מדיה (הוראות מצולמות)',
        type: 'media',
        before: bPaths.length,
        after: aPaths.length,
      });
    }
  }

  return changes;
}

/**
 * Build the `RecipeService.update` payload that applies a suggestion to the live
 * recipe. The suggestion's new images/media were already uploaded at suggestion
 * time, so kept images are tagged `source: 'existing'` (no re-upload); files
 * present on the live recipe but absent from the suggestion are scheduled for
 * deletion.
 *
 * @param {Object} current - The live recipe (raw Firestore shape).
 * @param {Object} proposed - The suggestion's proposedChanges.
 * @returns {{changes: Object, images: Array, imagesToDelete: Array, mediaItemsOrdered: (Array|undefined), mediaToDelete: (Array|undefined)}}
 */
export function buildApplyPayload(current = {}, proposed = {}) {
  const {
    images: proposedImages = [],
    mediaInstructions: proposedMedia,
    toDelete: _toDelete,
    mediaToDelete: _mediaToDelete,
    ...changes
  } = proposed;

  // Kept images are already in Storage — tag existing so update doesn't re-upload.
  const images = proposedImages.map((img) => ({ ...img, source: 'existing' }));

  // Live images no longer present in the suggestion → delete their Storage files.
  const keptImageIds = new Set(proposedImages.map((i) => i.id));
  const currentImages = Array.isArray(current.images) ? current.images : [];
  const imagesToDelete = currentImages.filter((img) => img.full && !keptImageIds.has(img.id));

  let mediaItemsOrdered;
  let mediaToDelete;
  if (Array.isArray(proposedMedia)) {
    mediaItemsOrdered = proposedMedia;
    const keptPaths = new Set(proposedMedia.map((m) => m.path));
    const currentMedia = Array.isArray(current.mediaInstructions) ? current.mediaInstructions : [];
    mediaToDelete = currentMedia.filter((m) => m.path && !keptPaths.has(m.path)).map((m) => m.path);
  }

  return { changes, images, imagesToDelete, mediaItemsOrdered, mediaToDelete };
}
