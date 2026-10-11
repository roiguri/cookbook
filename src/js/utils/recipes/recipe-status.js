/**
 * A recipe's status as shown to its reader — the single source for status
 * badges on cards and on the recipe page.
 *
 *   to-try     saved or imported, not cooked yet (author's private recipe)
 *   private    tested, in the author's library, not published
 *   pending · rejected · published   — added with release 3b (from the submission)
 *
 * Published recipes in the family book carry no badge.
 */
export const RECIPE_STATUS = Object.freeze({
  TO_TRY: 'to-try',
  PRIVATE: 'private',
  PENDING: 'pending',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
});

export const RECIPE_STATUS_LABELS = Object.freeze({
  [RECIPE_STATUS.TO_TRY]: 'לנסות',
  [RECIPE_STATUS.PRIVATE]: 'פרטי',
  [RECIPE_STATUS.PENDING]: 'ממתין',
  [RECIPE_STATUS.REJECTED]: 'נדחה',
  [RECIPE_STATUS.PUBLISHED]: 'פורסם',
});

/**
 * @param {Object|null|undefined} recipe - Recipe data (raw or formatted).
 * @returns {string|null} One of RECIPE_STATUS, or null when no badge applies.
 */
export function getRecipeStatus(recipe) {
  if (!recipe) return null;
  const visibility = recipe.visibility ?? (recipe.approved === true ? 'published' : 'private');
  if (visibility === 'published') return null;
  return recipe.stage === 'to-try' ? RECIPE_STATUS.TO_TRY : RECIPE_STATUS.PRIVATE;
}
