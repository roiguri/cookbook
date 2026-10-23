import {
  CATEGORY_IDS,
  RECIPE_CONTENT_FIELDS,
  STAGE,
  VISIBILITY,
  buildImageEntry,
  buildMediaEntry,
  imageFileName,
  mediaFileName,
  mediaTypeOf,
  normalizeRecipeContent,
  withModelFields,
} from '../../../src/js/shared/recipe-model.js';
import { formatRecipeData } from '../../../src/js/utils/recipes/recipe-data-utils.js';

// Fields every recipe document may carry that a caller never sets: the write
// path owns them (model fields, times, files) or they are read-side only (id).
const SERVER_OWNED = [
  'id',
  'authorId',
  'visibility',
  'stage',
  'testedAt',
  'creationTime',
  'updatedAt',
  'images',
  'mediaInstructions',
];

const errorFields = (result) => result.errors.map((e) => e.field);

describe('shared recipe model', () => {
  describe('drift guard', () => {
    it('knows every field the app reads from a recipe', () => {
      // formatRecipeData is the app's read-side shape. A field added there must be
      // classified here (caller content or server-owned), or the API would reject it.
      const appFields = Object.keys(formatRecipeData({ name: 'x' }));
      const known = new Set([...RECIPE_CONTENT_FIELDS, ...SERVER_OWNED]);
      expect(appFields.filter((f) => !known.has(f))).toEqual([]);
    });
  });

  describe('withModelFields', () => {
    it('defaults to a private, tested recipe', () => {
      expect(withModelFields({ name: 'x', authorId: 'u1' })).toEqual({
        name: 'x',
        authorId: 'u1',
        visibility: VISIBILITY.PRIVATE,
        stage: STAGE.TESTED,
      });
    });

    it('drops the legacy userId / approved fields', () => {
      const out = withModelFields({ userId: 'u1', approved: true });
      expect(out).toEqual({ authorId: 'u1', visibility: 'published', stage: 'tested' });
    });
  });

  describe('file entries', () => {
    it('builds an image entry', () => {
      const at = new Date(0);
      expect(
        buildImageEntry({
          id: 'img-1',
          path: 'recipes/r/images/img-1.jpg',
          fileName: 'img-1.jpg',
          isPrimary: true,
          uploadedBy: 'u1',
          uploadedAt: at,
        }),
      ).toEqual({
        id: 'img-1',
        full: 'recipes/r/images/img-1.jpg',
        fileName: 'img-1.jpg',
        isPrimary: true,
        uploadedBy: 'u1',
        access: 'public',
        uploadTimestamp: at,
      });
    });

    it('builds a media entry with an empty caption at order 0', () => {
      const entry = buildMediaEntry({ id: 'm', path: 'p', type: 'video', uploadedBy: 'u1' });
      expect(entry).toMatchObject({ id: 'm', path: 'p', type: 'video', caption: '', order: 0 });
      expect(entry.uploadedAt).toBeInstanceOf(Date);
    });

    it('names files like the app always has', () => {
      expect(imageFileName('img-1', 'photo.final.JPG')).toBe('img-1.JPG');
      expect(mediaFileName('media-1', 'שלב 1 (b).mp4')).toBe('media-1_____1__b_.mp4');
    });

    it('maps mime types to media types', () => {
      expect(mediaTypeOf('image/webp')).toBe('image');
      expect(mediaTypeOf('video/quicktime')).toBe('video');
      expect(mediaTypeOf('text/plain')).toBeNull();
    });
  });

  describe('normalizeRecipeContent', () => {
    it('accepts a name-only (incomplete) recipe', () => {
      expect(normalizeRecipeContent({ name: '  שקשוקה ' })).toEqual({
        ok: true,
        recipe: { name: 'שקשוקה' },
        errors: [],
      });
    });

    it('requires a name', () => {
      expect(errorFields(normalizeRecipeContent({}))).toEqual(['name']);
      expect(errorFields(normalizeRecipeContent({ name: '  ' }))).toEqual(['name']);
    });

    it('rejects a non-object', () => {
      expect(normalizeRecipeContent('x').ok).toBe(false);
      expect(normalizeRecipeContent([]).ok).toBe(false);
    });

    it('rejects unknown and server-owned fields', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredient: [],
        authorId: 'someone',
        visibility: 'published',
        images: [],
      });
      expect(errorFields(result)).toEqual(['ingredient', 'authorId', 'visibility', 'images']);
    });

    it('keeps a complete recipe, trimmed', () => {
      const result = normalizeRecipeContent({
        name: 'Pasta',
        description: ' Quick ',
        attribution: 'https://example.com/pasta',
        category: 'main-courses',
        mainIngredient: 'pasta',
        difficulty: 'קלה',
        prepTime: 10,
        waitTime: 0,
        servings: 4,
        servingsUnit: 'מנות',
        tags: [' quick ', ''],
        ingredients: [
          { item: ' pasta ', amount: 500, unit: 'g' },
          { item: 'salt', amount: '' },
        ],
        instructions: [' Boil ', '', 'Serve'],
        comments: ['Good'],
        relatedRecipes: ['r1'],
      });
      expect(result.ok).toBe(true);
      expect(result.recipe).toEqual({
        name: 'Pasta',
        description: 'Quick',
        attribution: 'https://example.com/pasta',
        category: 'main-courses',
        mainIngredient: 'pasta',
        difficulty: 'קלה',
        prepTime: 10,
        waitTime: 0,
        servings: 4,
        servingsUnit: 'מנות',
        tags: ['quick'],
        ingredients: [
          { item: 'pasta', amount: 500, unit: 'g' },
          { item: 'salt', amount: null, unit: '' },
        ],
        instructions: ['Boil', 'Serve'],
        comments: ['Good'],
        relatedRecipes: ['r1'],
      });
    });

    it('leaves out fields that are null or empty', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        description: '',
        category: null,
        tags: [],
        instructions: [' '],
      });
      expect(result).toEqual({ ok: true, recipe: { name: 'x' }, errors: [] });
    });

    it('validates enumerations', () => {
      expect(CATEGORY_IDS).toContain('desserts');
      const result = normalizeRecipeContent({
        name: 'x',
        category: 'Desserts',
        difficulty: 'easy',
      });
      expect(errorFields(result)).toEqual(['category', 'difficulty']);
    });

    it('validates whole numbers', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        prepTime: '10',
        waitTime: -1,
        servings: 0,
      });
      expect(errorFields(result)).toEqual(['prepTime', 'waitTime', 'servings']);
      expect(normalizeRecipeContent({ name: 'x', prepTime: 2.5 }).ok).toBe(false);
    });

    it('parses amounts like the form does', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredients: [
          { item: 'a', amount: '1½' },
          { item: 'b', amount: '1/2' },
          { item: 'c', amount: '1 1/4' },
          { item: 'd', amount: 0.25 },
        ],
      });
      expect(result.recipe.ingredients.map((i) => i.amount)).toEqual([1.5, 0.5, 1.25, 0.25]);
    });

    it('rejects ranges, free text and non-positive amounts', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredients: [
          { item: 'a', amount: '2-3' },
          { item: 'b', amount: 'to taste' },
          { item: 'c', amount: 0 },
          { item: 'd', amount: '3/8' },
        ],
      });
      expect(errorFields(result)).toEqual([
        'ingredients[0].amount',
        'ingredients[1].amount',
        'ingredients[2].amount',
        'ingredients[3].amount',
      ]);
    });

    it('requires an ingredient name and a string unit', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredients: [{ amount: 1 }, { item: 'b', unit: 5 }, 'c'],
      });
      expect(errorFields(result)).toEqual([
        'ingredients[0].item',
        'ingredients[1].unit',
        'ingredients[2]',
      ]);
    });

    it('accepts ingredient sections and drops empty ones', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredientSections: [
          { title: ' Dough ', items: [{ item: 'flour', amount: 2, unit: 'cups' }] },
          { title: 'Empty', items: [] },
        ],
      });
      expect(result.recipe.ingredientSections).toEqual([
        { title: 'Dough', items: [{ item: 'flour', amount: 2, unit: 'cups' }] },
      ]);
    });

    it('rejects both ingredient formats at once', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredients: [{ item: 'a' }],
        ingredientSections: [{ title: 't', items: [{ item: 'b' }] }],
      });
      expect(errorFields(result)).toEqual(['ingredients']);
    });

    it('accepts stages and rejects both instruction formats at once', () => {
      const staged = normalizeRecipeContent({
        name: 'x',
        stages: [
          { title: 'Prep', instructions: ['Chop', ' '] },
          { title: 'Empty', instructions: [] },
        ],
      });
      expect(staged.recipe.stages).toEqual([{ title: 'Prep', instructions: ['Chop'] }]);

      const both = normalizeRecipeContent({
        name: 'x',
        instructions: ['a'],
        stages: [{ title: 't', instructions: ['b'] }],
      });
      expect(errorFields(both)).toEqual(['instructions']);
    });

    it('reports malformed sections and stages by position', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredientSections: [{ items: [{ item: 'a' }] }],
        stages: 'step',
      });
      expect(errorFields(result)).toEqual(['ingredientSections[0].title', 'stages']);
    });

    it('validates string lists', () => {
      const result = normalizeRecipeContent({ name: 'x', tags: 'a,b', comments: [1] });
      expect(errorFields(result)).toEqual(['tags', 'comments']);
    });
  });
});
