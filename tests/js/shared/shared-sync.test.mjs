import { staleCopies, SHARED_FILES } from '../../../scripts/sync-shared.mjs';

describe('shared modules copied into functions/', () => {
  it('are up to date (run `npm run sync:shared` after editing src/js/shared)', () => {
    expect(staleCopies()).toEqual([]);
  });

  it.each(SHARED_FILES)('%s loads as the same module from functions/', async (source, target) => {
    const original = await import(`../../../${source}`);
    const copy = await import(`../../../${target}`);
    expect(Object.keys(copy).sort()).toEqual(Object.keys(original).sort());
  });
});
