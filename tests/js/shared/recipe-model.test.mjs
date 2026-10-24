import {
  CATEGORY_IDS,
  RECIPE_CONTENT_FIELDS,
  RECIPE_NUMBER_LIMITS,
  MIN_SECTIONS,
  MAX_RELATED_RECIPES,
  missingRequiredFields,
  submissionRecord,
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

    it('accepts ingredient sections (at least two, each titled with items)', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredientSections: [
          { title: ' Dough ', items: [{ item: 'flour', amount: 2, unit: 'cups' }] },
          { title: 'Filling', items: [{ item: 'apples' }] },
        ],
      });
      expect(result.recipe.ingredientSections).toEqual([
        { title: 'Dough', items: [{ item: 'flour', amount: 2, unit: 'cups' }] },
        { title: 'Filling', items: [{ item: 'apples', amount: null, unit: '' }] },
      ]);
    });

    it('rejects one section, and a section without items, like the form', () => {
      const one = normalizeRecipeContent({
        name: 'x',
        ingredientSections: [{ title: 'Only', items: [{ item: 'a' }] }],
      });
      expect(errorFields(one)).toEqual(['ingredientSections']);
      const empty = normalizeRecipeContent({
        name: 'x',
        ingredientSections: [
          { title: 'A', items: [{ item: 'a' }] },
          { title: 'Empty', items: [] },
        ],
      });
      expect(errorFields(empty)).toEqual(['ingredientSections[1].items']);
      expect(MIN_SECTIONS).toBe(2);
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
          { title: 'Cook', instructions: ['Fry'] },
        ],
      });
      expect(staged.recipe.stages).toEqual([
        { title: 'Prep', instructions: ['Chop'] },
        { title: 'Cook', instructions: ['Fry'] },
      ]);
      const oneStage = normalizeRecipeContent({
        name: 'x',
        stages: [{ title: 'Only', instructions: ['a'] }],
      });
      expect(errorFields(oneStage)).toEqual(['stages']);
      const emptyStage = normalizeRecipeContent({
        name: 'x',
        stages: [
          { title: 'A', instructions: ['a'] },
          { title: 'B', instructions: [' '] },
        ],
      });
      expect(errorFields(emptyStage)).toEqual(['stages[1].instructions']);

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

    it('returns no recipe when the input is rejected', () => {
      expect(normalizeRecipeContent({ name: 'x', prepTime: -1 }).recipe).toBeNull();
      expect(normalizeRecipeContent(null).recipe).toBeNull();
    });

    it('requires a positive prep time, as the form does on save', () => {
      expect(errorFields(normalizeRecipeContent({ name: 'x', prepTime: 0 }))).toEqual(['prepTime']);
      expect(normalizeRecipeContent({ name: 'x', waitTime: 0 }).ok).toBe(true);
    });

    it('keeps out absurd numbers but not long recipes', () => {
      const absurd = normalizeRecipeContent({
        name: 'x',
        prepTime: 1e300,
        waitTime: RECIPE_NUMBER_LIMITS.minutes + 1,
        servings: RECIPE_NUMBER_LIMITS.servings + 1,
        ingredients: [{ item: 'a', amount: '99999999999999999999' }],
      });
      expect(errorFields(absurd)).toEqual([
        'prepTime',
        'waitTime',
        'servings',
        'ingredients[0].amount',
      ]);

      const long = normalizeRecipeContent({
        name: 'א'.repeat(5000),
        instructions: Array.from({ length: 1000 }, (_, i) => `step ${i}`),
        prepTime: RECIPE_NUMBER_LIMITS.minutes,
      });
      expect(long.ok).toBe(true);
      expect(long.recipe.instructions).toHaveLength(1000);
    });

    it('accepts only numbers or strings as amounts', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredients: [
          { item: 'a', amount: [2] },
          { item: 'b', amount: { n: 1 } },
          { item: 'c', amount: true },
        ],
      });
      expect(errorFields(result)).toEqual([
        'ingredients[0].amount',
        'ingredients[1].amount',
        'ingredients[2].amount',
      ]);
    });

    it('rejects unknown fields inside ingredients, sections and stages', () => {
      const section = normalizeRecipeContent({
        name: 'x',
        ingredientSections: [{ title: 't', items: [{ item: 'a' }], note: '' }],
      });
      expect(errorFields(section)).toEqual(['ingredientSections[0].note']);
      const flat = normalizeRecipeContent({ name: 'x', ingredients: [{ item: 'a', qty: 2 }] });
      expect(errorFields(flat)).toEqual(['ingredients[0].qty']);
      const nested = normalizeRecipeContent({
        name: 'x',
        ingredientSections: [{ title: 't', items: [{ item: 'a', qty: 2 }] }],
      });
      expect(errorFields(nested)).toEqual(['ingredientSections[0].items[0].qty']);
      const stage = normalizeRecipeContent({
        name: 'x',
        stages: [{ title: 's', instructions: ['a'], steps: [] }],
      });
      expect(errorFields(stage)).toEqual(['stages[0].steps']);
    });

    it("reports an unknown field together with the object's other errors", () => {
      const result = normalizeRecipeContent({
        name: 'x',
        stages: [{ title: '', foo: 1 }],
        ingredients: [{ qty: 2 }],
      });
      expect(errorFields(result)).toEqual([
        'ingredients[0].qty',
        'ingredients[0].item',
        'stages[0].foo',
        'stages[0].title',
      ]);
    });

    it('rejects tags with commas (the edit form splits on them)', () => {
      expect(errorFields(normalizeRecipeContent({ name: 'x', tags: ['a,b'] }))).toEqual(['tags']);
    });

    it('rejects related recipe ids that are paths', () => {
      expect(
        errorFields(normalizeRecipeContent({ name: 'x', relatedRecipes: ['recipes/abc'] })),
      ).toEqual(['relatedRecipes']);
    });

    it('lists what the form requires before any save', () => {
      expect(missingRequiredFields({ name: 'x' })).toEqual([
        'category',
        'difficulty',
        'prepTime',
        'servings',
        'ingredients',
        'instructions',
      ]);
      const complete = {
        name: 'x',
        category: 'desserts',
        difficulty: 'קלה',
        prepTime: 10,
        servings: 4,
        ingredientSections: [{ title: 'a', items: [{ item: 'b' }] }],
        stages: [{ title: 's', instructions: ['t'] }],
      };
      expect(missingRequiredFields(complete)).toEqual([]);
      expect(missingRequiredFields(null)).toContain('name');
    });

    it('builds the submission record the rules expect', () => {
      expect(submissionRecord({ recipeId: 'r', authorId: 'u', createdAt: 'T' })).toEqual({
        recipeId: 'r',
        authorId: 'u',
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        createdAt: 'T',
      });
    });

    it('links related recipes like the form: unique, at most four', () => {
      expect(
        normalizeRecipeContent({ name: 'x', relatedRecipes: ['a', 'b'] }).recipe.relatedRecipes,
      ).toEqual(['a', 'b']);
      expect(
        errorFields(normalizeRecipeContent({ name: 'x', relatedRecipes: ['a', 'a'] })),
      ).toEqual(['relatedRecipes']);
      expect(
        errorFields(
          normalizeRecipeContent({ name: 'x', relatedRecipes: ['a', 'b', 'c', 'd', 'e'] }),
        ),
      ).toEqual(['relatedRecipes']);
      expect(MAX_RELATED_RECIPES).toBe(4);
    });

    it('skips fully blank ingredient rows, as the form does', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredients: [{ item: 'a' }, { item: '', amount: '', unit: ' ' }, {}],
      });
      expect(result.recipe.ingredients).toEqual([{ item: 'a', amount: null, unit: '' }]);
      // An amount without an ingredient is still an error.
      expect(
        errorFields(normalizeRecipeContent({ name: 'x', ingredients: [{ amount: 2 }] })),
      ).toEqual(['ingredients[0].item']);
    });

    it('treats an empty list as absent', () => {
      const result = normalizeRecipeContent({
        name: 'x',
        ingredients: [],
        ingredientSections: [
          { title: 'a', items: [{ item: 'b' }] },
          { title: 'c', items: [{ item: 'd' }] },
        ],
      });
      expect(result.ok).toBe(true);
      expect(result.recipe.ingredients).toBeUndefined();
    });

    it('validates string lists', () => {
      const result = normalizeRecipeContent({ name: 'x', tags: 'a,b', comments: [1] });
      expect(errorFields(result)).toEqual(['tags', 'comments']);
    });
  });
});
