/*
 * Recipe Model (shared with Cloud Functions)
 * ------------------------------------------
 * The one definition of a recipe document's shape, used by the app and by the
 * recipe API (docs/feature-plans/recipe-api.md). Anything both write paths must
 * agree on lives here: model fields, categories, difficulties, the Storage
 * layout, image / media-instruction entries, amount parsing, and the
 * normalization of recipe content sent by an API caller.
 *
 * Rules for this file:
 *   - Pure ESM, no imports, no I/O — it is copied as-is into functions/.
 *   - No SDK types. Times are plain `Date`s (both Firestore SDKs store a Date
 *     as a Timestamp); each caller converts at its own edge.
 *   - functions/shared/recipe-model.mjs is a GENERATED copy: edit this file,
 *     then run `npm run sync:shared` (a unit test fails while the copy is stale).
 *
 * Exports:
 *   - VISIBILITY, STAGE, withModelFields(data)
 *   - CATEGORY_MAP, CATEGORY_IDS, DIFFICULTIES
 *   - recipeImagesFolder, recipeMediaFolder, suggestionImagesFolder, suggestionMediaFolder
 *   - MEDIA_IMAGE_TYPES, MEDIA_VIDEO_TYPES, MEDIA_TYPES, MEDIA_MAX_BYTES, mediaTypeOf(mime)
 *   - generateImageId(), generateMediaInstructionId()
 *   - imageFileName(id, originalName), mediaFileName(id, originalName)
 *   - buildImageEntry(...), buildMediaEntry(...)
 *   - COMMON_FRACTIONS, parseAmount(input)
 *   - RECIPE_CONTENT_FIELDS, RECIPE_NUMBER_LIMITS, MIN_SECTIONS, normalizeRecipeContent(input)
 *   - MAX_RELATED_RECIPES, missingRequiredFields(recipe)
 *   - submissionRecord({ recipeId, authorId, createdAt })
 */

// --- Model fields ---------------------------------------------------------

export const VISIBILITY = Object.freeze({ PRIVATE: 'private', PUBLISHED: 'published' });
export const STAGE = Object.freeze({ TO_TRY: 'to-try', TESTED: 'tested' });

/**
 * The model fields of a recipe being created: `authorId`, `visibility`
 * (private unless said otherwise) and `stage` ('tested' by default). The legacy
 * `userId` / `approved` are accepted as input but never written.
 * @param {Object} data
 * @returns {Object}
 */
export function withModelFields(data) {
  const { userId, approved, ...out } = data;
  out.authorId = out.authorId ?? userId ?? null;
  const published =
    out.visibility !== undefined ? out.visibility === VISIBILITY.PUBLISHED : approved === true;
  out.visibility = published ? VISIBILITY.PUBLISHED : VISIBILITY.PRIVATE;
  if (out.stage === undefined) out.stage = STAGE.TESTED;
  return out;
}

// --- Categories and difficulty --------------------------------------------

/** Category id → Hebrew label. The single source of truth for categories. */
export const CATEGORY_MAP = {
  appetizers: 'מנות ראשונות',
  'main-courses': 'מנות עיקריות',
  'side-dishes': 'תוספות',
  'soups-stews': 'מרקים ותבשילים',
  salads: 'סלטים',
  desserts: 'קינוחים',
  'breakfast-brunch': 'ארוחות בוקר',
  'breads-pastries': 'לחמים ומאפים',
  snacks: 'חטיפים',
  beverages: 'משקאות',
};

export const CATEGORY_IDS = Object.freeze(Object.keys(CATEGORY_MAP));

/** The difficulty values the recipe form offers (stored as these Hebrew strings). */
export const DIFFICULTIES = Object.freeze(['קלה', 'בינונית', 'קשה']);

// --- Storage layout -------------------------------------------------------

export const recipeImagesFolder = (recipeId) => `recipes/${recipeId}/images`;
export const recipeMediaFolder = (recipeId) => `recipes/${recipeId}/media`;
export const suggestionImagesFolder = (suggestionId) => `suggestions/${suggestionId}/images`;
export const suggestionMediaFolder = (suggestionId) => `suggestions/${suggestionId}/media`;

// --- Media types ----------------------------------------------------------

export const MEDIA_IMAGE_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
export const MEDIA_VIDEO_TYPES = Object.freeze(['video/mp4', 'video/webm', 'video/quicktime']);
export const MEDIA_TYPES = Object.freeze([...MEDIA_IMAGE_TYPES, ...MEDIA_VIDEO_TYPES]);
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024; // matches storage.rules

/**
 * @param {string} mime
 * @returns {'image'|'video'|null}
 */
export function mediaTypeOf(mime) {
  if (MEDIA_IMAGE_TYPES.includes(mime)) return 'image';
  if (MEDIA_VIDEO_TYPES.includes(mime)) return 'video';
  return null;
}

// --- File entries ---------------------------------------------------------

/** A unique image id: `img-<ms>-<random>`. */
export function generateImageId() {
  return 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/** A unique media-instruction id: `media-<uuid>` (browser and Node). */
export function generateMediaInstructionId() {
  return 'media-' + globalThis.crypto.randomUUID();
}

/**
 * Storage file name of a recipe image: its id plus the original extension.
 * Every upload gets its own name, so an upload never overwrites a file.
 * @param {string} id
 * @param {string} originalName
 * @returns {string}
 */
export function imageFileName(id, originalName) {
  return `${id}.${String(originalName).split('.').pop()}`;
}

/**
 * Storage file name of a media instruction: its id plus the sanitized original name.
 * @param {string} id
 * @param {string} originalName
 * @returns {string}
 */
export function mediaFileName(id, originalName) {
  return `${id}_${String(originalName).replace(/[^a-zA-Z0-9.-]/g, '_')}`;
}

/**
 * The `images[]` entry of an uploaded recipe image.
 * @param {{ id: string, path: string, fileName: string, isPrimary?: boolean,
 *   uploadedBy?: string, uploadedAt?: Date }} params
 * @returns {Object}
 */
export function buildImageEntry({
  id,
  path,
  fileName,
  isPrimary = false,
  uploadedBy,
  uploadedAt = new Date(),
}) {
  return {
    id,
    full: path,
    fileName,
    isPrimary,
    uploadedBy,
    access: 'public',
    uploadTimestamp: uploadedAt,
  };
}

/**
 * The `mediaInstructions[]` entry of an uploaded file (caption and order are
 * set by the caller once the list is assembled).
 * @param {{ id: string, path: string, type: 'image'|'video', uploadedBy: string,
 *   uploadedAt?: Date }} params
 * @returns {Object}
 */
export function buildMediaEntry({ id, path, type, uploadedBy, uploadedAt = new Date() }) {
  return { id, path, caption: '', type, order: 0, uploadedBy, uploadedAt };
}

// --- Amounts --------------------------------------------------------------

/**
 * The only fractions accepted on input and produced on display.
 * @type {Record<string, number>}
 */
export const COMMON_FRACTIONS = {
  '⅛': 1 / 8,
  '¼': 1 / 4,
  '⅓': 1 / 3,
  '½': 1 / 2,
  '⅔': 2 / 3,
  '¾': 3 / 4,
};

const COMMON_RATIOS = Object.values(COMMON_FRACTIONS);
const RATIO_EPSILON = 1e-6; // fraction-notation must resolve (near) exactly

const matchesCommonRatio = (value) =>
  COMMON_RATIOS.some((ratio) => Math.abs(value - ratio) < RATIO_EPSILON);

/**
 * Parse a user/stored amount string into a number.
 * Returns `null` for anything that is not a valid numeric amount
 * (empty, free text, ranges, or non-common fraction notation).
 * @param {string|number|null|undefined} input
 * @returns {number|null}
 */
export function parseAmount(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (s === '') return null;

  // Plain integer or decimal: "2", "2.5", "0.375"
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // Unicode vulgar fraction alone: "½"
  if (Object.prototype.hasOwnProperty.call(COMMON_FRACTIONS, s)) {
    return COMMON_FRACTIONS[s];
  }

  // Mixed number + unicode fraction: "1½", "2 ¾"
  const mixedUnicode = s.match(/^(\d+)\s*([⅛¼⅓½⅔¾])$/);
  if (mixedUnicode) {
    return parseInt(mixedUnicode[1], 10) + COMMON_FRACTIONS[mixedUnicode[2]];
  }

  // ASCII fraction: "1/2" — must resolve to a common ratio ("3/8" rejected)
  const fraction = s.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const den = parseInt(fraction[2], 10);
    if (den === 0) return null;
    const value = parseInt(fraction[1], 10) / den;
    return matchesCommonRatio(value) ? value : null;
  }

  // Mixed number + ASCII fraction: "1 1/2" — fraction part must be common
  const mixedAscii = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedAscii) {
    const den = parseInt(mixedAscii[3], 10);
    if (den === 0) return null;
    const fracValue = parseInt(mixedAscii[2], 10) / den;
    if (!matchesCommonRatio(fracValue)) return null;
    return parseInt(mixedAscii[1], 10) + fracValue;
  }

  // Ranges ("2-3", "1/2-1") and everything else are invalid.
  return null;
}

// --- Recipe content (API input) -------------------------------------------

/**
 * The content fields a caller may set. Everything else on a recipe document is
 * set by the write path itself: model fields (authorId, visibility, stage,
 * testedAt), times (creationTime, updatedAt), and files (images,
 * mediaInstructions — uploaded, never accepted as data).
 */
export const RECIPE_CONTENT_FIELDS = Object.freeze([
  'name',
  'description',
  'attribution',
  'category',
  'mainIngredient',
  'difficulty',
  'prepTime',
  'waitTime',
  'servings',
  'servingsUnit',
  'tags',
  'ingredients',
  'ingredientSections',
  'instructions',
  'stages',
  'comments',
  'relatedRecipes',
]);

// Sanity bounds for numbers sent by an API caller. Deliberately loose — they only
// keep out values that would break display (e.g. 1e300 minutes), not long recipes.
// Text length and list sizes are not limited; the request size cap covers abuse.
export const RECIPE_NUMBER_LIMITS = Object.freeze({
  minutes: 100000,
  servings: 10000,
  amount: 1000000,
});

// The recipe form links at most this many related recipes, all published.
export const MAX_RELATED_RECIPES = 4;

// The recipe form's section mode (ingredients or instruction stages) needs at least
// two sections, each with a title and items; a single list uses the flat format.
export const MIN_SECTIONS = 2;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const trimmed = (v) => (typeof v === 'string' ? v.trim() : v);

/**
 * Normalize recipe content sent by an API caller into document fields.
 *
 * Only `name` is required: a recipe may be incomplete and is finished later in
 * the app. Fields the caller leaves out stay absent. Every field that IS sent
 * must be valid — the same rules the recipe form applies — and unknown or
 * server-owned fields are rejected, so a caller's typo fails loudly.
 *
 * @param {*} input
 * @returns {{ ok: boolean, recipe: Object|null, errors: Array<{ field: string, message: string }> }}
 *   `recipe` is null whenever `ok` is false.
 */
export function normalizeRecipeContent(input) {
  const errors = [];
  const recipe = {};
  // Records an error; returns null so a failed item drops out of `.filter(Boolean)`.
  const fail = (field, message) => {
    errors.push({ field, message });
    return null;
  };

  if (!isPlainObject(input)) {
    fail('recipe', 'must be an object');
    return { ok: false, recipe: null, errors };
  }

  for (const key of Object.keys(input)) {
    if (!RECIPE_CONTENT_FIELDS.includes(key)) fail(key, 'unknown or server-owned field');
  }
  // Absent: missing, null, or an empty list (so `ingredients: []` beside sections is
  // not "both formats").
  const has = (key) =>
    input[key] !== undefined &&
    input[key] !== null &&
    !(Array.isArray(input[key]) && input[key].length === 0);

  // name (required)
  const name = trimmed(input.name);
  if (typeof name !== 'string' || !name) fail('name', 'is required');
  else recipe.name = name;

  // free-text strings
  for (const key of ['description', 'attribution', 'mainIngredient', 'servingsUnit']) {
    if (!has(key)) continue;
    if (typeof input[key] !== 'string') fail(key, 'must be a string');
    else if (input[key].trim()) recipe[key] = input[key].trim();
  }

  // enumerations
  if (has('category')) {
    if (!CATEGORY_IDS.includes(input.category)) {
      fail('category', `must be one of: ${CATEGORY_IDS.join(', ')}`);
    } else recipe.category = input.category;
  }
  if (has('difficulty')) {
    if (!DIFFICULTIES.includes(input.difficulty)) {
      fail('difficulty', `must be one of: ${DIFFICULTIES.join(', ')}`);
    } else recipe.difficulty = input.difficulty;
  }

  // whole numbers (minutes / servings). Prep time must be positive, as the form
  // requires on save; leave it out when unknown.
  for (const [key, min, max] of [
    ['prepTime', 1, RECIPE_NUMBER_LIMITS.minutes],
    ['waitTime', 0, RECIPE_NUMBER_LIMITS.minutes],
    ['servings', 1, RECIPE_NUMBER_LIMITS.servings],
  ]) {
    if (!has(key)) continue;
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) {
      fail(key, `must be a whole number from ${min} to ${max}`);
    } else recipe[key] = input[key];
  }

  // string lists
  for (const key of ['tags', 'comments', 'relatedRecipes']) {
    if (!has(key)) continue;
    if (!Array.isArray(input[key]) || !input[key].every((s) => typeof s === 'string')) {
      fail(key, 'must be an array of strings');
    } else {
      const list = input[key].map((s) => s.trim()).filter(Boolean);
      // The edit form joins tags with ", " and splits on "," when saving.
      if (key === 'tags' && list.some((t) => t.includes(','))) {
        fail(key, 'a tag cannot contain a comma');
      } else if (key === 'relatedRecipes' && list.some((id) => id.includes('/'))) {
        fail(key, 'must be recipe ids');
      } else if (key === 'relatedRecipes' && new Set(list).size !== list.length) {
        fail(key, 'lists a recipe twice');
      } else if (key === 'relatedRecipes' && list.length > MAX_RELATED_RECIPES) {
        fail(key, `can link at most ${MAX_RELATED_RECIPES} recipes, as in the recipe form`);
      } else if (list.length) recipe[key] = list;
    }
  }

  // Nested objects follow the top-level rule: unknown keys are errors. Validation
  // goes on, so the caller sees every problem with the object at once.
  const unknownKeys = (raw, allowed, field) => {
    Object.keys(raw)
      .filter((k) => !allowed.includes(k))
      .forEach((k) => fail(`${field}.${k}`, 'unknown field'));
  };

  // ingredients: flat list or sections, not both
  const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
  const ingredient = (raw, field) => {
    if (!isPlainObject(raw)) return fail(field, 'must be an object { item, amount?, unit? }');
    unknownKeys(raw, ['item', 'amount', 'unit'], field);
    // A fully blank row is skipped, as the form ignores empty rows.
    const onlyKnownKeys = Object.keys(raw).every((k) => ['item', 'amount', 'unit'].includes(k));
    if (onlyKnownKeys && blank(raw.item) && blank(raw.amount) && blank(raw.unit)) return null;
    const item = trimmed(raw.item);
    if (typeof item !== 'string' || !item) return fail(`${field}.item`, 'is required');
    let amount = null;
    if (raw.amount !== undefined && raw.amount !== null && raw.amount !== '') {
      const typed = typeof raw.amount === 'number' || typeof raw.amount === 'string';
      amount = typed ? parseAmount(raw.amount) : null;
      if (!(amount > 0 && amount < RECIPE_NUMBER_LIMITS.amount)) {
        return fail(
          `${field}.amount`,
          'must be a positive number under 1,000,000 or a common fraction ' +
            '(e.g. 2, 0.5, "1/2", "1½"); ' +
            'put ranges or "to taste" in the item text',
        );
      }
    }
    if (raw.unit !== undefined && raw.unit !== null && typeof raw.unit !== 'string') {
      return fail(`${field}.unit`, 'must be a string');
    }
    return { amount, unit: trimmed(raw.unit) || '', item };
  };
  const ingredientList = (raw, field) => {
    if (!Array.isArray(raw)) {
      fail(field, 'must be an array');
      return [];
    }
    return raw.map((r, i) => ingredient(r, `${field}[${i}]`)).filter(Boolean);
  };

  if (has('ingredients') && has('ingredientSections')) {
    fail('ingredients', 'send either ingredients or ingredientSections, not both');
  } else if (has('ingredients')) {
    const list = ingredientList(input.ingredients, 'ingredients');
    if (list.length) recipe.ingredients = list;
  } else if (has('ingredientSections')) {
    if (!Array.isArray(input.ingredientSections)) {
      fail('ingredientSections', 'must be an array');
    } else {
      const errorsBefore = errors.length;
      const sections = input.ingredientSections
        .map((section, i) => {
          const field = `ingredientSections[${i}]`;
          if (!isPlainObject(section)) return fail(field, 'must be an object { title, items }');
          unknownKeys(section, ['title', 'items'], field);
          const title = trimmed(section.title);
          if (typeof title !== 'string' || !title) return fail(`${field}.title`, 'is required');
          const before = errors.length;
          const items = ingredientList(section.items, `${field}.items`);
          if (!items.length && errors.length === before) {
            return fail(`${field}.items`, 'needs at least one ingredient');
          }
          return items.length ? { title, items } : null;
        })
        .filter(Boolean);
      // The count rule only once the sections themselves are valid.
      if (errors.length === errorsBefore && sections.length < MIN_SECTIONS) {
        fail(
          'ingredientSections',
          `needs at least ${MIN_SECTIONS} sections, as in the recipe form (for one list, send ingredients)`,
        );
      } else if (sections.length) recipe.ingredientSections = sections;
    }
  }

  // instructions: flat list or stages, not both
  const stepList = (raw, field) => {
    if (!Array.isArray(raw) || !raw.every((s) => typeof s === 'string')) {
      fail(field, 'must be an array of strings');
      return [];
    }
    return raw.map((s) => s.trim()).filter(Boolean);
  };

  if (has('instructions') && has('stages')) {
    fail('instructions', 'send either instructions or stages, not both');
  } else if (has('instructions')) {
    const steps = stepList(input.instructions, 'instructions');
    if (steps.length) recipe.instructions = steps;
  } else if (has('stages')) {
    if (!Array.isArray(input.stages)) {
      fail('stages', 'must be an array');
    } else {
      const errorsBefore = errors.length;
      const stages = input.stages
        .map((stage, i) => {
          const field = `stages[${i}]`;
          if (!isPlainObject(stage))
            return fail(field, 'must be an object { title, instructions }');
          unknownKeys(stage, ['title', 'instructions'], field);
          const title = trimmed(stage.title);
          if (typeof title !== 'string' || !title) return fail(`${field}.title`, 'is required');
          const before = errors.length;
          const steps = stepList(stage.instructions, `${field}.instructions`);
          if (!steps.length && errors.length === before) {
            return fail(`${field}.instructions`, 'needs at least one step');
          }
          return steps.length ? { title, instructions: steps } : null;
        })
        .filter(Boolean);
      if (errors.length === errorsBefore && stages.length < MIN_SECTIONS) {
        fail(
          'stages',
          `needs at least ${MIN_SECTIONS} stages, as in the recipe form (for one list, send instructions)`,
        );
      } else if (stages.length) recipe.stages = stages;
    }
  }

  // A rejected input yields no recipe, so a caller can't use half-validated data.
  const ok = errors.length === 0;
  return { ok, recipe: ok ? recipe : null, errors };
}

// --- Completeness and submission ------------------------------------------

/**
 * What the recipe form requires before any recipe can be saved. The API requires the
 * same of every recipe it creates (decision 16; incomplete private recipes: #434).
 * Wait time is not here: the form treats an empty wait time as 0.
 * @param {Object} recipe - Normalized content (normalizeRecipeContent's `recipe`).
 * @returns {string[]} The missing fields, in form order; empty when complete.
 */
export function missingRequiredFields(recipe) {
  const r = recipe || {};
  const missing = [];
  for (const field of ['name', 'category', 'difficulty', 'prepTime', 'servings']) {
    if (r[field] === undefined || r[field] === null || r[field] === '') missing.push(field);
  }
  if (!r.ingredients?.length && !r.ingredientSections?.length) missing.push('ingredients');
  if (!r.instructions?.length && !r.stages?.length) missing.push('instructions');
  return missing;
}

/**
 * The `recipe_submissions/{recipeId}` record that puts a recipe in the approval queue
 * (firestore.rules: status pending, the caller as author, written with the recipe).
 * @param {{ recipeId: string, authorId: string, createdAt: * }} params - `createdAt` in
 *   the writing SDK's own type (a Timestamp or serverTimestamp()).
 */
export function submissionRecord({ recipeId, authorId, createdAt }) {
  return {
    recipeId,
    authorId,
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt,
  };
}
