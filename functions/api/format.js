/**
 * Recipe API — the shapes callers see (docs/feature-plans/recipe-api.md §3).
 *
 * A full recipe nests its content under `recipe`, in exactly the shape POST /recipes
 * accepts (the shared model's RECIPE_CONTENT_FIELDS), so a caller can read, edit and
 * write back. Model fields sit outside it. The author's uid, legacy fields
 * (userId / approved) and bookkeeping (createdVia) are never returned.
 */

/** ISO string for a Firestore Timestamp (either SDK), Date or millis; else null. */
function iso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const isVisibility = (v) => (v === 'published' ? 'published' : 'private');
const isStage = (v) => (v === 'to-try' ? 'to-try' : 'tested');

/** The fields of a recipe outside its content. */
function modelFields(id, data, uid) {
  return {
    id,
    path: `/recipe/${id}`,
    visibility: isVisibility(data.visibility),
    stage: isStage(data.stage),
    isMine: data.authorId === uid,
    createdAt: iso(data.creationTime),
    updatedAt: iso(data.updatedAt),
    testedAt: iso(data.testedAt),
  };
}

/**
 * A list entry.
 * @param {string} id
 * @param {Object} data - The recipe document.
 * @param {string} uid - The caller.
 */
function toSummary(id, data, uid) {
  const { path, visibility, stage, isMine, createdAt } = modelFields(id, data, uid);
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    category: data.category || null,
    stage,
    visibility,
    isMine,
    createdAt,
    path,
  };
}

/**
 * A full recipe.
 * @param {string} id
 * @param {Object} data - The recipe document.
 * @param {string} uid - The caller.
 * @param {readonly string[]} contentFields - RECIPE_CONTENT_FIELDS (shared model).
 * @param {{ images: Array<Object>, mediaInstructions: Array<Object> }} files - Resolved.
 */
function toFullRecipe(id, data, uid, contentFields, files) {
  const recipe = {};
  for (const field of contentFields) {
    if (data[field] !== undefined && data[field] !== null) recipe[field] = data[field];
  }
  return { ...modelFields(id, data, uid), recipe, ...files };
}

/** Newest first by creation time. */
function byNewest(a, b) {
  return (b.createdAt || '').localeCompare(a.createdAt || '');
}

module.exports = { iso, toSummary, toFullRecipe, byNewest };
