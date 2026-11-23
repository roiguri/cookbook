/**
 * "הספרייה שלי" — what each scope chip shows, from the reader's own recipes,
 * the recipes they saved (favourites) and the private recipes family shared
 * with them. Pure, so it is unit-tested.
 *
 *   all     my recipes + saved + shared with me, once each, newest first (the default)
 *   mine    the recipes I wrote (any stage or visibility)
 *   saved   what I saved — my own saved recipes keep their badges, shared ones
 *           their "shared by" badge
 *   shared  private recipes family shared with me, newest share first
 *   to-try  my recipes not tried yet
 */
export const LIBRARY_VIEW = Object.freeze({
  ALL: 'all',
  MINE: 'mine',
  SAVED: 'saved',
  SHARED: 'shared',
  TO_TRY: 'to-try',
});

const time = (r) => r?.creationTime?.toMillis?.() ?? new Date(r?.creationTime ?? 0).getTime() ?? 0;
const newestFirst = (a, b) => time(b) - time(a);

/**
 * @param {Array<Object>} mine - The reader's recipes (with badge fields attached).
 * @param {Array<Object>} saved - The recipes they saved, as loaded (may include their own).
 * @param {Array<Object>} [shared] - Recipes shared with them, each with `sharedBy`.
 * @returns {Record<string, Array<Object>>} One list per LIBRARY_VIEW value.
 */
export function buildLibraryViews(mine = [], saved = [], shared = []) {
  const mineById = new Map(mine.map((r) => [r.id, r]));
  const sharedById = new Map(shared.map((r) => [r.id, r]));
  const savedList = saved.map((r) => mineById.get(r.id) || sharedById.get(r.id) || r);
  const savedOthers = savedList.filter((r) => !mineById.has(r.id));
  const savedIds = new Set(saved.map((r) => r.id));
  const sharedOthers = shared.filter((r) => !mineById.has(r.id) && !savedIds.has(r.id));
  return {
    [LIBRARY_VIEW.ALL]: [...mine, ...savedOthers, ...sharedOthers].sort(newestFirst),
    [LIBRARY_VIEW.MINE]: mine,
    [LIBRARY_VIEW.SAVED]: savedList,
    [LIBRARY_VIEW.SHARED]: shared,
    [LIBRARY_VIEW.TO_TRY]: mine.filter((r) => r.stage === 'to-try'),
  };
}
