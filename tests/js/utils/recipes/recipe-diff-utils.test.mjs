import { buildApplyPayload, buildRecipeDiffModel } from 'src/js/utils/recipes/recipe-diff-utils.js';

describe('buildApplyPayload', () => {
  it('tags kept images existing and schedules dropped live images for deletion', () => {
    const current = {
      name: 'Old',
      images: [
        { id: 'keep', full: 'f/keep.jpg' },
        { id: 'drop', full: 'f/drop.jpg' },
      ],
    };
    const proposed = {
      name: 'New',
      images: [
        { id: 'keep', full: 'f/keep.jpg', isPrimary: true },
        { id: 'addnew', full: 'f/new.jpg' },
      ],
    };

    const { changes, images, imagesToDelete } = buildApplyPayload(current, proposed);

    expect(changes).toEqual({ name: 'New' }); // images/media stripped out of changes
    expect(images).toEqual([
      { id: 'keep', full: 'f/keep.jpg', isPrimary: true, source: 'existing' },
      { id: 'addnew', full: 'f/new.jpg', source: 'existing' },
    ]);
    expect(imagesToDelete).toEqual([{ id: 'drop', full: 'f/drop.jpg' }]);
  });

  it('computes media add/remove when the suggestion carries media', () => {
    const current = {
      mediaInstructions: [
        { id: '1', path: 'p/a' },
        { id: '2', path: 'p/b' },
      ],
    };
    const proposed = {
      images: [],
      mediaInstructions: [
        { id: '2', path: 'p/b' },
        { id: '3', path: 'p/c' },
      ],
    };
    const { mediaItemsOrdered, mediaToDelete } = buildApplyPayload(current, proposed);
    expect(mediaItemsOrdered.map((m) => m.path)).toEqual(['p/b', 'p/c']);
    expect(mediaToDelete).toEqual(['p/a']);
  });

  it('clears all media when the suggestion carries an empty mediaInstructions array', () => {
    const current = {
      mediaInstructions: [
        { id: '1', path: 'p/a' },
        { id: '2', path: 'p/b' },
      ],
    };
    const { mediaItemsOrdered, mediaToDelete } = buildApplyPayload(current, {
      images: [],
      mediaInstructions: [],
    });
    expect(mediaItemsOrdered).toEqual([]);
    expect(mediaToDelete).toEqual(['p/a', 'p/b']);
  });

  it('leaves media untouched when the suggestion does not carry mediaInstructions', () => {
    const { mediaItemsOrdered, mediaToDelete } = buildApplyPayload(
      { mediaInstructions: [{ id: '1', path: 'p/a' }] },
      { images: [] },
    );
    expect(mediaItemsOrdered).toBeUndefined();
    expect(mediaToDelete).toBeUndefined();
  });

  it('never leaks toDelete/mediaToDelete into changes', () => {
    const { changes } = buildApplyPayload(
      {},
      { name: 'X', images: [], toDelete: [{ id: 'z' }], mediaToDelete: ['p/x'] },
    );
    expect(changes).toEqual({ name: 'X' });
  });
});

describe('buildRecipeDiffModel', () => {
  it('flags hasChange=false and marks all rows context when nothing changed', () => {
    const recipe = {
      name: 'A',
      ingredients: [{ amount: 1, unit: 'כוס', item: 'קמח' }],
      instructions: ['ערבב'],
    };
    const model = buildRecipeDiffModel(recipe, {
      name: 'A',
      ingredients: [{ amount: 1, unit: 'כוס', item: 'קמח' }],
      instructions: ['ערבב'],
    });
    expect(model.hasChange).toBe(false);
    expect(model.ingredients.every((o) => o.type === 'context')).toBe(true);
    expect(model.instructions.every((o) => o.type === 'context')).toBe(true);
  });

  it('marks an added ingredient as add and keeps the rest as context (display-shaped item)', () => {
    const model = buildRecipeDiffModel(
      { ingredients: [{ amount: 1, unit: 'כוס', item: 'קמח' }] },
      {
        ingredients: [
          { amount: 1, unit: 'כוס', item: 'קמח' },
          { amount: 2, unit: '', item: 'ביצים' },
        ],
      },
    );
    const added = model.ingredients.filter((o) => o.type === 'add');
    expect(added).toHaveLength(1);
    expect(added[0].item).toMatchObject({ kind: 'item', ingredient: { item: 'ביצים' } });
    expect(model.hasChange).toBe(true);
  });

  it('splits images into kept/added/removed and flags primary change', () => {
    const model = buildRecipeDiffModel(
      { images: [{ id: 'a', isPrimary: true }, { id: 'b' }] },
      { images: [{ id: 'b', isPrimary: true }, { id: 'c' }] },
    );
    expect(model.images.kept.map((i) => i.id)).toEqual(['b']);
    expect(model.images.added.map((i) => i.id)).toEqual(['c']);
    expect(model.images.removed.map((i) => i.id)).toEqual(['a']);
    expect(model.images.primaryChanged).toBe(true);
  });

  it('shows servings with its unit and diffs tags/difficulty', () => {
    const model = buildRecipeDiffModel(
      { servings: 4, servingsUnit: 'מנות', difficulty: 'קל', tags: ['חלבי'] },
      { servings: 6, servingsUnit: 'מנות', difficulty: 'בינוני', tags: ['חלבי', 'חגיגי'] },
    );
    const byField = Object.fromEntries(model.meta.map((m) => [m.field, m]));
    expect(byField.servings).toMatchObject({ before: '4 מנות', after: '6 מנות', changed: true });
    expect(byField.difficulty).toMatchObject({ before: 'קל', after: 'בינוני', changed: true });
    expect(byField.tags).toMatchObject({ before: 'חלבי', after: 'חלבי, חגיגי', changed: true });
  });

  it('detects a media caption change as captionChanged, not remove+add', () => {
    const model = buildRecipeDiffModel(
      { mediaInstructions: [{ id: '1', path: 'p/a', type: 'image', caption: 'ישן' }] },
      { mediaInstructions: [{ id: '1', path: 'p/a', type: 'image', caption: 'חדש' }] },
    );
    expect(model.media.added).toEqual([]);
    expect(model.media.removed).toEqual([]);
    expect(model.media.captionChanged).toHaveLength(1);
    expect(model.media.captionChanged[0]).toMatchObject({
      path: 'p/a',
      before: 'ישן',
      after: 'חדש',
    });
    expect(model.hasChange).toBe(true);
  });

  it('splits related recipes into added/removed by id', () => {
    const model = buildRecipeDiffModel(
      { relatedRecipes: ['r1', 'r2'] },
      { relatedRecipes: ['r2', 'r3'] },
    );
    expect(model.related.added).toEqual(['r3']);
    expect(model.related.removed).toEqual(['r1']);
    expect(model.related.kept).toEqual(['r2']);
  });

  it('preserves stage headers as context anchors so only the changed step diffs', () => {
    const model = buildRecipeDiffModel(
      { stages: [{ title: 'הכנה', instructions: ['א', 'ב'] }] },
      { stages: [{ title: 'הכנה', instructions: ['א', 'ג'] }] },
    );
    const headers = model.instructions.filter((o) => o.item.kind === 'stage');
    expect(headers).toHaveLength(1);
    expect(headers[0].type).toBe('context');
    expect(model.instructions.filter((o) => o.type === 'add').map((o) => o.item.text)).toEqual([
      'ג',
    ]);
    expect(model.instructions.filter((o) => o.type === 'remove').map((o) => o.item.text)).toEqual([
      'ב',
    ]);
  });
});
