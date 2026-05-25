import { jest } from '@jest/globals';

let calculateTotalTime,
  formatCookingTime,
  getTimeClass,
  getDifficultyClass,
  getLocalizedCategoryName,
  getCategoryIcon,
  formatRecipeData,
  validateRecipeData,
  extractIngredientNamesFromSections;

describe('recipe-data-utils', () => {
  beforeEach(async () => {
    jest.resetModules();
    const utils = await import('src/js/utils/recipes/recipe-data-utils.js');
    calculateTotalTime = utils.calculateTotalTime;
    formatCookingTime = utils.formatCookingTime;
    getTimeClass = utils.getTimeClass;
    getDifficultyClass = utils.getDifficultyClass;
    getLocalizedCategoryName = utils.getLocalizedCategoryName;
    getCategoryIcon = utils.getCategoryIcon;
    formatRecipeData = utils.formatRecipeData;
    validateRecipeData = utils.validateRecipeData;
    extractIngredientNamesFromSections = utils.extractIngredientNamesFromSections;
  });

  describe('calculateTotalTime', () => {
    it('returns the sum of prepTime and waitTime', () => {
      expect(calculateTotalTime(10, 20)).toBe(30);
      expect(calculateTotalTime(0, 0)).toBe(0);
      expect(calculateTotalTime(15, 0)).toBe(15);
      expect(calculateTotalTime(undefined, 10)).toBe(10);
      expect(calculateTotalTime(5, undefined)).toBe(5);
    });
  });

  describe('formatCookingTime', () => {
    it('formats times under 60 minutes', () => {
      expect(formatCookingTime(25)).toBe('25 דקות');
      expect(formatCookingTime(60)).toBe('60 דקות');
    });
    it('formats times between 61 and 119 minutes', () => {
      expect(formatCookingTime(75)).toBe('שעה ו-15 דקות');
      expect(formatCookingTime(119)).toBe('שעה ו-59 דקות');
    });
    it('formats exactly 120 minutes', () => {
      expect(formatCookingTime(120)).toBe('שעתיים');
    });
    it('formats times between 121 and 179 minutes', () => {
      expect(formatCookingTime(135)).toBe('שעתיים ו-15 דקות');
    });
    it('formats times that are whole hours', () => {
      expect(formatCookingTime(180)).toBe('3 שעות');
      expect(formatCookingTime(240)).toBe('4 שעות');
    });
    it('formats times that are hours and minutes', () => {
      expect(formatCookingTime(185)).toBe('3 שעות ו-5 דקות');
    });
  });

  describe('getTimeClass', () => {
    it('returns quick for <= 30', () => {
      expect(getTimeClass(10)).toBe('quick');
      expect(getTimeClass(30)).toBe('quick');
    });
    it('returns medium for 31-60', () => {
      expect(getTimeClass(31)).toBe('medium');
      expect(getTimeClass(60)).toBe('medium');
    });
    it('returns long for > 60', () => {
      expect(getTimeClass(61)).toBe('long');
      expect(getTimeClass(120)).toBe('long');
    });
  });

  describe('getDifficultyClass', () => {
    it('returns correct class for Hebrew difficulty', () => {
      expect(getDifficultyClass('קלה')).toBe('easy');
      expect(getDifficultyClass('בינונית')).toBe('medium');
      expect(getDifficultyClass('קשה')).toBe('hard');
    });
    it('returns medium for unknown difficulty', () => {
      expect(getDifficultyClass('unknown')).toBe('medium');
    });
  });

  describe('getLocalizedCategoryName', () => {
    it('returns Hebrew name for known category', () => {
      expect(getLocalizedCategoryName('appetizers')).toBe('מנות ראשונות');
      expect(getLocalizedCategoryName('desserts')).toBe('קינוחים');
    });
    it('returns input for unknown category', () => {
      expect(getLocalizedCategoryName('unknown')).toBe('unknown');
    });
  });

  describe('getCategoryIcon', () => {
    it('returns icon for known category', () => {
      expect(getCategoryIcon('appetizers')).toBe('🥗');
      expect(getCategoryIcon('desserts')).toBe('🍰');
    });
    it('returns default icon for unknown category', () => {
      expect(getCategoryIcon('unknown')).toBe('🍽️');
    });
  });

  describe('formatRecipeData', () => {
    it('returns null for non-object input', () => {
      expect(formatRecipeData(null)).toBeNull();
      expect(formatRecipeData(undefined)).toBeNull();
      expect(formatRecipeData(123)).toBeNull();
    });

    it('normalizes a complete recipe object', () => {
      const raw = {
        id: 'abc',
        name: 'Cake',
        description: 'A tasty cake',
        attribution: 'Grandma',
        category: 'desserts',
        prepTime: 10,
        waitTime: 20,
        difficulty: 'קלה',
        mainIngredient: 'flour',
        tags: ['sweet'],
        servings: 8,
        ingredients: [{ amount: '1', unit: 'cup', item: 'flour' }],
        ingredientSections: undefined,
        stages: [{ title: 'Mix', instructions: ['Do this'] }],
        instructions: ['Step 1'],
        images: [{ file: 'cake.jpg', isPrimary: true, access: 'public', uploadedBy: 'user1' }],
        mediaInstructions: [],
        relatedRecipes: ['recipe-1'],
        comments: ['Yum!'],
        approved: true,
        creationTime: 1234567890,
        updatedAt: 1234567891,
      };
      const formatted = formatRecipeData(raw);
      expect(formatted).toEqual(raw);
    });

    it('fills in defaults for missing fields', () => {
      const raw = { name: 'Bread' };
      const formatted = formatRecipeData(raw);
      expect(formatted).toEqual({
        id: '',
        name: 'Bread',
        description: '',
        attribution: '',
        category: '',
        prepTime: 0,
        waitTime: 0,
        difficulty: '',
        mainIngredient: '',
        tags: [],
        servings: 1,
        ingredients: [],
        ingredientSections: undefined,
        stages: undefined,
        instructions: undefined,
        images: [],
        mediaInstructions: [],
        comments: [],
        relatedRecipes: [],
        approved: false,
        creationTime: null,
        updatedAt: null,
      });
    });

    it('handles arrays and booleans correctly', () => {
      const raw = {
        tags: 'not-an-array',
        ingredients: undefined,
        images: null,
        comments: 0,
        approved: 'yes',
      };
      const formatted = formatRecipeData(raw);
      expect(formatted.tags).toEqual([]);
      expect(formatted.ingredients).toEqual([]);
      expect(formatted.images).toEqual([]);
      expect(formatted.comments).toEqual([]);
      expect(formatted.approved).toBe(false);
    });
  });

  describe('validateRecipeData', () => {
    const baseRecipe = {
      name: 'Test',
      category: 'desserts',
      prepTime: 10,
      waitTime: 5,
      difficulty: 'קלה',
      mainIngredient: 'sugar',
      servings: 2,
      ingredients: [{ amount: '1', unit: 'cup', item: 'sugar' }],
      instructions: ['Mix'],
    };

    it('validates a correct recipe', () => {
      const result = validateRecipeData(baseRecipe);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('validates a recipe without main ingredient', () => {
      const r = { ...baseRecipe };
      delete r.mainIngredient;
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('validates a recipe with empty main ingredient', () => {
      const r = { ...baseRecipe, mainIngredient: '' };
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('validates a recipe with null main ingredient', () => {
      const r = { ...baseRecipe, mainIngredient: null };
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('fails if main ingredient is not a string', () => {
      const r = { ...baseRecipe, mainIngredient: 123 };
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.mainIngredient).toBeDefined();
    });

    it('fails if name is missing', () => {
      const r = { ...baseRecipe, name: '' };
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.name).toBeDefined();
    });

    it('fails if category is invalid', () => {
      const r = { ...baseRecipe, category: 'invalid' };
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.category).toBeDefined();
    });

    it('fails if servings is not an integer >= 1', () => {
      expect(validateRecipeData({ ...baseRecipe, servings: 0 }).isValid).toBe(false);
      expect(validateRecipeData({ ...baseRecipe, servings: 1.5 }).isValid).toBe(false);
      expect(validateRecipeData({ ...baseRecipe, servings: '2' }).isValid).toBe(false);
    });

    it('allows both instructions and stages to exist (validation handled at component level)', () => {
      const r = { ...baseRecipe, stages: [{ title: 'Stage', instructions: ['Do'] }] };
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('allows missing instructions and stages (validation handled at component level)', () => {
      const r = { ...baseRecipe };
      delete r.instructions;
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(true);
      expect(result.errors.instructions).toBeUndefined();
      expect(result.errors.stages).toBeUndefined();
    });

    describe('ingredients vs ingredientSections validation', () => {
      it('validates flat ingredients format', () => {
        const r = { ...baseRecipe, ingredients: [{ amount: '1', unit: 'cup', item: 'sugar' }] };
        const result = validateRecipeData(r);
        expect(result.isValid).toBe(true);
      });

      it('validates sectioned ingredients format', () => {
        const r = {
          ...baseRecipe,
          ingredients: undefined,
          ingredientSections: [
            {
              title: 'Dry Ingredients',
              items: [{ amount: '1', unit: 'cup', item: 'flour' }],
            },
          ],
        };
        delete r.ingredients;
        const result = validateRecipeData(r);
        expect(result.isValid).toBe(true);
      });

      it('fails if both ingredients and ingredientSections exist', () => {
        const r = {
          ...baseRecipe,
          ingredients: [{ amount: '1', unit: 'cup', item: 'sugar' }],
          ingredientSections: [
            { title: 'Test', items: [{ amount: '1', unit: 'cup', item: 'flour' }] },
          ],
        };
        const result = validateRecipeData(r);
        expect(result.isValid).toBe(false);
        expect(result.errors.ingredients).toBeDefined();
        expect(result.errors.ingredientSections).toBeDefined();
      });

      it('fails if neither ingredients nor ingredientSections exist', () => {
        const r = { ...baseRecipe };
        delete r.ingredients;
        const result = validateRecipeData(r);
        expect(result.isValid).toBe(false);
        expect(result.errors.ingredientsRequired).toBe(true);
      });

      it('allows flat ingredients with empty fields (validation handled at component level)', () => {
        const r = { ...baseRecipe, ingredients: [{ amount: '', unit: '', item: '' }] };
        const result = validateRecipeData(r);
        expect(result.isValid).toBe(true);
        expect(result.errors['ingredients[0]']).toBeUndefined();
      });

      it('allows ingredientSections with empty fields (validation handled at component level)', () => {
        const r = {
          ...baseRecipe,
          ingredientSections: [{ title: '', items: [] }],
        };
        delete r.ingredients;
        const result = validateRecipeData(r);
        expect(result.isValid).toBe(true);
        expect(result.errors['ingredientSections[0]']).toBeUndefined();
      });

      it('allows ingredientSection with invalid items (validation handled at component level)', () => {
        const r = {
          ...baseRecipe,
          ingredientSections: [
            {
              title: 'Valid Title',
              items: [{ amount: '', unit: '', item: '' }],
            },
          ],
        };
        delete r.ingredients;
        const result = validateRecipeData(r);
        expect(result.isValid).toBe(true);
        expect(result.errors['ingredientSections[0]']).toBeUndefined();
      });
    });

    it('validates a recipe with stages and no instructions', () => {
      const r = { ...baseRecipe };
      delete r.instructions;
      r.stages = [{ title: 'Stage 1', instructions: ['Do this'] }];
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(true);
    });

    it('allows stages with missing title or instructions (validation handled at component level)', () => {
      const r = { ...baseRecipe };
      delete r.instructions;
      r.stages = [{ title: '', instructions: [] }];
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(true);
      expect(result.errors['stages[0].title']).toBeUndefined();
      expect(result.errors['stages[0].instructions']).toBeUndefined();
    });

    it('allows stages with empty instructions (validation handled at component level)', () => {
      const r = { ...baseRecipe };
      delete r.instructions;
      r.stages = [{ title: 'Stage', instructions: [''] }];
      const result = validateRecipeData(r);
      expect(result.isValid).toBe(true);
      expect(result.errors['stages[0].instructions[0]']).toBeUndefined();
    });

    it('validates optional fields types (tags, images, comments, approved, creationTime, updatedAt)', () => {
      // Valid types
      let r = {
        ...baseRecipe,
        tags: ['a', 'b'],
        images: [{}],
        comments: ['c'],
        approved: true,
        creationTime: 1234,
        updatedAt: new Date(),
      };
      let result = validateRecipeData(r);
      expect(result.isValid).toBe(true);

      // Valid Timestamp-like object
      r = {
        ...baseRecipe,
        creationTime: { seconds: 1234, nanoseconds: 5678 },
        updatedAt: { seconds: 5678, nanoseconds: 1234 },
      };
      result = validateRecipeData(r);
      expect(result.isValid).toBe(true);

      // Invalid tags
      r = { ...baseRecipe, tags: [1, 2] };
      result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.tags).toBeDefined();
      // Invalid images
      r = { ...baseRecipe, images: [1, 2] };
      result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.images).toBeDefined();
      // Invalid comments
      r = { ...baseRecipe, comments: [1, 2] };
      result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.comments).toBeDefined();
      // Invalid approved
      r = { ...baseRecipe, approved: 'yes' };
      result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.approved).toBeDefined();
      // Invalid creationTime (object without seconds)
      r = { ...baseRecipe, creationTime: { notSeconds: 123 } };
      result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.creationTime).toBeDefined();
      // Invalid updatedAt
      r = { ...baseRecipe, updatedAt: [] };
      result = validateRecipeData(r);
      expect(result.isValid).toBe(false);
      expect(result.errors.updatedAt).toBeDefined();
    });
  });

  describe('extractIngredientNamesFromSections', () => {
    it('extracts names from ingredient sections', () => {
      const sections = [
        {
          title: 'Dry',
          items: [
            { amount: '1', unit: 'cup', item: 'flour' },
            { amount: '2', unit: 'tbsp', item: 'sugar' },
          ],
        },
        {
          title: 'Wet',
          items: [{ amount: '1', unit: 'cup', item: 'milk' }],
        },
      ];
      expect(extractIngredientNamesFromSections(sections)).toEqual(['flour', 'sugar', 'milk']);
    });

    it('filters out empty names and handles invalid data', () => {
      const sections = [
        {
          title: 'Test',
          items: [
            { amount: '1', unit: 'cup', item: '' },
            { amount: '2', unit: 'tbsp', item: 'sugar' },
            { item: null },
          ],
        },
      ];
      expect(extractIngredientNamesFromSections(sections)).toEqual(['sugar']);
    });

    it('returns empty array for invalid input', () => {
      expect(extractIngredientNamesFromSections(null)).toEqual([]);
      expect(extractIngredientNamesFromSections([])).toEqual([]);
      expect(extractIngredientNamesFromSections('invalid')).toEqual([]);
    });
  });
});
