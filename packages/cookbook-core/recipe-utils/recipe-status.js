/**
 * A recipe's status as shown to its reader — the single source for status
 * badges on cards and on the recipe page.
 *
 *   pending    submitted to the family book, awaiting a manager
 *   rejected   returned by a manager with a note
 *   published  in the family book — shown only in the author's own views
 *              (My recipes, their recipe page); elsewhere a published recipe
 *              carries no badge
 *   to-try     saved or imported, not cooked yet (author's private recipe)
 *   private    tested, in the author's library, not published
 *
 * Lists that know more than the recipe document attach it to the recipe:
 *   `submissionStatus` — the author's submission ('pending' | 'rejected' | …)
 *   `ownView`          — the reader is the author, in their own view
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
 * @param {Object|null|undefined} recipe - Recipe data (raw or formatted), with
 *   the optional `submissionStatus` / `ownView` described above.
 * @returns {string|null} One of RECIPE_STATUS, or null when no badge applies.
 */
export function getRecipeStatus(recipe) {
  if (!recipe) return null;
  if (recipe.visibility === 'published') return recipe.ownView ? RECIPE_STATUS.PUBLISHED : null;
  if (recipe.submissionStatus === 'pending') return RECIPE_STATUS.PENDING;
  if (recipe.submissionStatus === 'rejected') return RECIPE_STATUS.REJECTED;
  return recipe.stage === 'to-try' ? RECIPE_STATUS.TO_TRY : RECIPE_STATUS.PRIVATE;
}
