/**
 * Storage layout for recipe files — the single place that builds these paths.
 *
 *   recipes/{recipeId}/images/{file}          published or proposed recipe photos
 *   recipes/{recipeId}/media/{file}           step-by-step photos and videos
 *   suggestions/{suggestionId}/images/{file}  edit-suggestion uploads, until approved
 *   suggestions/{suggestionId}/media/{file}
 *   users/{uid}/recipes/{recipeId}/…          private recipes (release 3a)
 *
 * The resize extension writes `_400x400.webp` / `_1080x1080.webp` variants next to
 * each image. Before release 2b, recipe files lived under
 * `img/recipes/full/{category}/{recipeId}/` and `recipes/{recipeId}/media-instructions/`;
 * scripts/migrations/003-restructure-storage.mjs copies them to this layout.
 */

// The folder builders live in the shared recipe model, so the recipe API uploads
// to exactly the same layout.
export {
  recipeImagesFolder,
  recipeMediaFolder,
  suggestionImagesFolder,
  suggestionMediaFolder,
} from '../../shared/recipe-model.js';

/**
 * True when a string is a Storage path to recipe/suggestion files (current or
 * legacy layout), as opposed to a URL or a local preview.
 * @param {*} value
 * @returns {boolean}
 */
export function isRecipeStoragePath(value) {
  return (
    typeof value === 'string' &&
    (value.startsWith('recipes/') ||
      value.startsWith('suggestions/') ||
      value.startsWith('users/') ||
      value.startsWith('img/recipes/'))
  );
}

/**
 * Return a deep copy of `value` with every string that is a key of `mapping`
 * replaced by its mapped path. Used when files are copied to a new location
 * (suggestion approval, the 2b layout migration) to repoint the documents.
 * @param {*} value - Any JSON-like value (Firestore Timestamps and other class
 *   instances are kept as they are).
 * @param {Object<string, string>} mapping - old path → new path
 * @returns {*}
 */
export function rewriteStoragePaths(value, mapping) {
  if (typeof value === 'string') {
    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteStoragePaths(item, mapping));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteStoragePaths(item, mapping)]),
    );
  }
  return value;
}
