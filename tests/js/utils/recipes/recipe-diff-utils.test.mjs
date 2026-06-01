import { diffRecipe, buildApplyPayload } from 'src/js/utils/recipes/recipe-diff-utils.js';

describe('diffRecipe', () => {
  it('returns an empty array when nothing changed', () => {
    const recipe = { name: 'A', ingredients: ['x'], instructions: ['do'] };
    expect(diffRecipe(recipe, { name: 'A', ingredients: ['x'], instructions: ['do'] })).toEqual([]);
  });

  it('detects scalar field changes the proposal carries', () => {
    const changes = diffRecipe(
      { name: 'Old', servings: 4, description: 'd' },
      { name: 'New', servings: 6 },
    );
    const fields = changes.map((c) => c.field);
    expect(fields).toContain('name');
    expect(fields).toContain('servings');
    expect(fields).not.toContain('description'); // not in the proposal → not compared
    expect(changes.find((c) => c.field === 'name')).toMatchObject({
      type: 'scalar',
      before: 'Old',
      after: 'New',
    });
  });

  it('does not report a change for identical object-shaped ingredients', () => {
    const ingredients = [
      { amount: 2, unit: 'כוסות', item: 'קמח' },
      { amount: 1, unit: 'כפית', item: 'מלח' },
    ];
    const changes = diffRecipe(
      { ingredients },
      { ingredients: ingredients.map((i) => ({ ...i })) },
    );
    expect(changes.find((c) => c.field === 'ingredients')).toBeUndefined();
  });

  it('renders object-shaped ingredients as readable text (no [object Object])', () => {
    const changes = diffRecipe(
      { ingredients: [{ amount: 1, unit: 'כוס', item: 'סוכר' }] },
      { ingredients: [{ amount: 2, unit: 'כוסות', item: 'סוכר' }] },
    );
    const ing = changes.find((c) => c.field === 'ingredients');
    expect(ing.before).toEqual(['1 כוס סוכר']);
    expect(ing.after).toEqual(['2 כוסות סוכר']);
    expect(JSON.stringify(ing)).not.toContain('object Object');
  });

  it('detects related-recipes changes (applied on approve, so must show)', () => {
    const changes = diffRecipe({ relatedRecipes: ['a'] }, { relatedRecipes: ['a', 'b'] });
    const rel = changes.find((c) => c.field === 'relatedRecipes');
    expect(rel).toMatchObject({ type: 'list', before: ['a'], after: ['a', 'b'] });
  });

  it('detects media-instruction add/remove by path', () => {
    const changes = diffRecipe(
      { mediaInstructions: [{ id: '1', path: 'p/a' }] },
      {
        mediaInstructions: [
          { id: '1', path: 'p/a' },
          { id: '2', path: 'p/b' },
        ],
      },
    );
    const media = changes.find((c) => c.field === 'media');
    expect(media).toMatchObject({ type: 'media', before: 1, after: 2 });
  });

  it('summarizes image changes including a primary swap', () => {
    const changes = diffRecipe(
      { images: [{ id: 'a', isPrimary: true }, { id: 'b' }] },
      { images: [{ id: 'b', isPrimary: true }] },
    );
    const img = changes.find((c) => c.field === 'images');
    expect(img).toMatchObject({ type: 'images', before: 2, after: 1, primaryChanged: true });
  });
});

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
