import { buildLibraryViews, LIBRARY_VIEW } from 'src/js/utils/recipes/library-views.js';

const at = (ms) => ({ toMillis: () => ms });
const mine = [
  { id: 'm1', stage: 'tested', creationTime: at(3), ownView: true },
  { id: 'm2', stage: 'to-try', creationTime: at(1), ownView: true },
];
const saved = [
  { id: 's1', creationTime: at(2) },
  { id: 'm1', creationTime: at(3) }, // I saved my own recipe too
];

describe('buildLibraryViews', () => {
  const views = buildLibraryViews(mine, saved);
  const ids = (list) => list.map((r) => r.id);

  it('"all" holds every recipe once, newest first', () => {
    expect(ids(views[LIBRARY_VIEW.ALL])).toEqual(['m1', 's1', 'm2']);
  });

  it('"mine" is what I wrote; "to-try" what I haven’t tried', () => {
    expect(ids(views[LIBRARY_VIEW.MINE])).toEqual(['m1', 'm2']);
    expect(ids(views[LIBRARY_VIEW.TO_TRY])).toEqual(['m2']);
  });

  it('"saved" keeps my own recipe’s version (with its badge fields)', () => {
    expect(ids(views[LIBRARY_VIEW.SAVED])).toEqual(['s1', 'm1']);
    expect(views[LIBRARY_VIEW.SAVED][1].ownView).toBe(true);
  });

  it('works with nothing (a plain user with no favourites)', () => {
    const empty = buildLibraryViews([], []);
    expect(Object.values(empty).every((list) => list.length === 0)).toBe(true);
  });
});
