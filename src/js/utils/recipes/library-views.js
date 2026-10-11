/**
 * "הספרייה שלי" — what each scope chip shows, from the reader's own recipes
 * and the recipes they saved (favourites). Pure, so it is unit-tested.
 *
 *   all     my recipes + saved recipes, once each, newest first (the default)
 *   mine    the recipes I wrote (any stage or visibility)
 *   saved   what I saved — my own saved recipes keep their badges
 *   to-try  my recipes not tried yet
 */
export const LIBRARY_VIEW = Object.freeze({
  ALL: 'all',
  MINE: 'mine',
  SAVED: 'saved',
  TO_TRY: 'to-try',
});

const time = (r) => r?.creationTime?.toMillis?.() ?? new Date(r?.creationTime ?? 0).getTime() ?? 0;
const newestFirst = (a, b) => time(b) - time(a);

/**
 * @param {Array<Object>} mine - The reader's recipes (with badge fields attached).
 * @param {Array<Object>} saved - The recipes they saved, as loaded (may include their own).
 * @returns {Record<string, Array<Object>>} One list per LIBRARY_VIEW value.
 */
export function buildLibraryViews(mine = [], saved = []) {
  const mineById = new Map(mine.map((r) => [r.id, r]));
  const savedList = saved.map((r) => mineById.get(r.id) || r);
  const savedOthers = saved.filter((r) => !mineById.has(r.id));
  return {
    [LIBRARY_VIEW.ALL]: [...mine, ...savedOthers].sort(newestFirst),
    [LIBRARY_VIEW.MINE]: mine,
    [LIBRARY_VIEW.SAVED]: savedList,
    [LIBRARY_VIEW.TO_TRY]: mine.filter((r) => r.stage === 'to-try'),
  };
}
