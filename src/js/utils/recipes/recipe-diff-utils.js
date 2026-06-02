/*
 * Recipe Diff Utilities
 * ---------------------
 * Pure helpers for comparing a live recipe against a proposed edit (the
 * `proposedChanges` of a recipe edit suggestion) and for turning a suggestion
 * into an apply payload. No I/O, no service/SDK imports.
 *
 * Exported:
 *   - buildRecipeDiffModel(current, proposed): structured model for the review UI.
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

function primaryId(recipe) {
  if (!Array.isArray(recipe?.images)) return null;
  const primary = recipe.images.find((img) => img.isPrimary);
  return primary?.id || recipe.images[0]?.id || null;
}

/**
 * Metadata fields for the full diff model:
 *   - `unit`     appended to the value (e.g. minutes)
 *   - `unitFrom` pulls the unit from another field (servings + servingsUnit)
 *   - `join`     renders an array field as a comma-joined string (tags)
 * Category stays a raw key (the view maps it to a label).
 */
const META_FIELDS = [
  { field: 'name', label: 'שם' },
  { field: 'description', label: 'תיאור' },
  { field: 'category', label: 'קטגוריה' },
  { field: 'difficulty', label: 'דרגת קושי' },
  { field: 'mainIngredient', label: 'מרכיב עיקרי' },
  { field: 'prepTime', label: 'זמן הכנה', unit: 'דק׳' },
  { field: 'waitTime', label: 'זמן המתנה', unit: 'דק׳' },
  { field: 'servings', label: 'כמות', unitFrom: 'servingsUnit' },
  { field: 'tags', label: 'תגיות', join: true },
  { field: 'attribution', label: 'קרדיט' },
];

/** Resolve a meta field to its display string for a recipe. */
function metaValue(recipe, spec) {
  const raw = recipe?.[spec.field];
  if (spec.join) return Array.isArray(raw) ? raw.join(', ') : raw ? `${raw}` : '';
  if (raw === undefined || raw === null || raw === '') return '';
  if (spec.unitFrom) {
    const unit = recipe?.[spec.unitFrom];
    return [raw, unit]
      .map((v) => `${v ?? ''}`.trim())
      .filter(Boolean)
      .join(' ');
  }
  if (spec.unit) return `${raw} ${spec.unit}`;
  return `${raw}`;
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

// ---------------------------------------------------------------------------
// Full diff model — drives the recipe-display-style contextual diff view.
// ---------------------------------------------------------------------------

/** LCS line diff over keyed items. Returns ops carrying the source item. */
function lcsDiff(before = [], after = [], keyOf) {
  const n = before.length;
  const m = after.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        keyOf(before[i]) === keyOf(after[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (keyOf(before[i]) === keyOf(after[j])) {
      ops.push({ type: 'context', item: after[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', item: before[i] });
      i++;
    } else {
      ops.push({ type: 'add', item: after[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'remove', item: before[i++] });
  while (j < m) ops.push({ type: 'add', item: after[j++] });
  return ops;
}

/** Flatten ingredients to renderable rows: section headers + items (display-shaped). */
function ingredientRenderables(recipe) {
  const out = [];
  if (Array.isArray(recipe?.ingredientSections) && recipe.ingredientSections.length > 0) {
    for (const section of recipe.ingredientSections) {
      const title = section?.title || '';
      if (title) out.push({ kind: 'section', title, key: `§${title}` });
      for (const it of section?.items || []) {
        const text = ingredientToText(it);
        out.push({ kind: 'item', ingredient: it, text, key: `${title}|${text}` });
      }
    }
    return out;
  }
  for (const it of Array.isArray(recipe?.ingredients) ? recipe.ingredients : []) {
    const text = ingredientToText(it);
    const ingredient = it && typeof it === 'object' ? it : { amount: null, unit: '', item: text };
    out.push({ kind: 'item', ingredient, text, key: `|${text}` });
  }
  return out;
}

/** Flatten instructions to renderable rows: stage headers + steps. */
function instructionRenderables(recipe) {
  const out = [];
  if (Array.isArray(recipe?.stages) && recipe.stages.length > 0) {
    for (const stage of recipe.stages) {
      const title = stage?.title || '';
      if (title) out.push({ kind: 'stage', title, key: `§${title}` });
      for (const ins of stage?.instructions || []) {
        const text = instructionToText(ins);
        out.push({ kind: 'step', text, key: `${title}|${text}` });
      }
    }
    return out;
  }
  for (const ins of Array.isArray(recipe?.instructions) ? recipe.instructions : []) {
    const text = instructionToText(ins);
    out.push({ kind: 'step', text, key: `|${text}` });
  }
  return out;
}

/** Added / removed / kept split of two arrays keyed by a field. */
function splitByKey(before = [], after = [], keyOf) {
  const beforeKeys = new Set(before.map(keyOf));
  const afterKeys = new Set(after.map(keyOf));
  return {
    kept: after.filter((x) => beforeKeys.has(keyOf(x))),
    added: after.filter((x) => !beforeKeys.has(keyOf(x))),
    removed: before.filter((x) => !afterKeys.has(keyOf(x))),
  };
}

/**
 * Build the structured model that drives the full-recipe contextual diff view.
 * Pure — the component resolves image URLs and related-recipe cards from it.
 *
 * @param {Object} current - The live recipe (raw Firestore shape).
 * @param {Object} proposed - The suggestion's proposedChanges.
 * @returns {{
 *   meta: Array<{field,label,before,after,changed}>,
 *   ingredients: Array<{type,item}>,
 *   instructions: Array<{type,item}>,
 *   comments: Array<{type,item}>,
 *   images: {kept,added,removed,primaryChanged},
 *   media: {kept,added,removed},
 *   related: {kept,added,removed},
 *   hasChange: boolean,
 * }}
 */
export function buildRecipeDiffModel(current = {}, proposed = {}) {
  const meta = META_FIELDS.map((spec) => {
    const before = metaValue(current, spec);
    // proposedChanges is a full form snapshot, but fall back to `before` if a
    // field is genuinely absent so an untouched field reads as unchanged.
    const carried = spec.field in proposed || (spec.unitFrom && spec.unitFrom in proposed);
    const after = carried ? metaValue(proposed, spec) : before;
    return { field: spec.field, label: spec.label, before, after, changed: before !== after };
  }).filter((m) => !(m.before === '' && m.after === ''));

  const ingredients = lcsDiff(
    ingredientRenderables(current),
    ingredientRenderables(proposed),
    (r) => r.key,
  );
  const instructions = lcsDiff(
    instructionRenderables(current),
    instructionRenderables(proposed),
    (r) => r.key,
  );

  const commentItems = (recipe) =>
    (Array.isArray(recipe?.comments) ? recipe.comments : []).map((c) => ({
      text: String(c),
      key: String(c),
    }));
  const comments =
    'comments' in proposed
      ? lcsDiff(commentItems(current), commentItems(proposed), (r) => r.key)
      : [];

  const imageArr = (r) => (Array.isArray(r?.images) ? r.images : []);
  const images = {
    ...splitByKey(imageArr(current), imageArr(proposed), (i) => i.id),
    primaryChanged: primaryId(current) !== primaryId(proposed),
  };

  const mediaArr = (r) => (Array.isArray(r?.mediaInstructions) ? r.mediaInstructions : []);
  const carriesMedia = 'mediaInstructions' in proposed;
  const beforeMedia = mediaArr(current);
  const afterMedia = mediaArr(proposed);
  const mediaSplit = carriesMedia
    ? splitByKey(beforeMedia, afterMedia, (m) => m.path)
    : { kept: beforeMedia, added: [], removed: [] };
  // Caption-only edits keep the same path (file identity) — detect them among
  // the matched items so a relabel isn't read as remove+add.
  let captionChanged = [];
  if (carriesMedia) {
    const beforeByPath = new Map(beforeMedia.map((m) => [m.path, m]));
    captionChanged = afterMedia
      .filter((m) => beforeByPath.has(m.path))
      .map((m) => ({
        path: m.path,
        type: m.type,
        before: beforeByPath.get(m.path).caption || '',
        after: m.caption || '',
        item: m,
      }))
      .filter((c) => c.before !== c.after);
  }
  const media = { ...mediaSplit, captionChanged };

  const relArr = (r) => (Array.isArray(r?.relatedRecipes) ? r.relatedRecipes : []);
  const related =
    'relatedRecipes' in proposed
      ? splitByKey(relArr(current), relArr(proposed), (id) => id)
      : { kept: relArr(current), added: [], removed: [] };

  const hasChange =
    meta.some((m) => m.changed) ||
    ingredients.some((o) => o.type !== 'context') ||
    instructions.some((o) => o.type !== 'context') ||
    comments.some((o) => o.type !== 'context') ||
    images.added.length > 0 ||
    images.removed.length > 0 ||
    images.primaryChanged ||
    media.added.length > 0 ||
    media.removed.length > 0 ||
    media.captionChanged.length > 0 ||
    related.added.length > 0 ||
    related.removed.length > 0;

  return { meta, ingredients, instructions, comments, images, media, related, hasChange };
}
