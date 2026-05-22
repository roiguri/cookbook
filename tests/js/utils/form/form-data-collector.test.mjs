import { jest } from '@jest/globals';

// Mock auth service
const mockGetCurrentUser = jest.fn();
jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
  default: {
    getCurrentUser: mockGetCurrentUser,
  },
}));

// Import utilities to test
let collectRecipeFormData, collectSectionData, hasMinimumRequiredData;

describe('form-data-collector', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    const utils = await import('src/js/utils/form/form-data-collector.js');
    collectRecipeFormData = utils.collectRecipeFormData;
    collectSectionData = utils.collectSectionData;
    hasMinimumRequiredData = utils.hasMinimumRequiredData;
  });

  // Mock DOM elements and shadow root
  function createMockShadowRoot(data = {}) {
    const mockInput = (value = '') => ({
      value,
      type: 'text',
    });

    const mockElements = {
      name: mockInput(data.name || 'Test Recipe'),
      'dish-type': mockInput(data.category || 'main-courses'),
      'prep-time': mockInput(data.prepTime || '30'),
      'wait-time': mockInput(data.waitTime || '45'),
      difficulty: mockInput(data.difficulty || 'קלה'),
      'main-ingredient': mockInput(data.mainIngredient || 'Chicken'),
      tags: mockInput(data.tags || 'healthy, quick'),
      'servings-form': mockInput(data.servings || '4'),
      comments: mockInput(data.comments !== undefined ? data.comments : 'Test comments'),
    };

    const mockIngredientEntries = [
      {
        querySelector: jest.fn((selector) => {
          if (selector.includes('quantity')) return mockInput('2');
          if (selector.includes('unit')) return mockInput('cups');
          if (selector.includes('item')) return mockInput('rice');
          return null;
        }),
      },
      {
        querySelector: jest.fn((selector) => {
          if (selector.includes('quantity')) return mockInput('1');
          if (selector.includes('unit')) return mockInput('kg');
          if (selector.includes('item')) return mockInput('chicken');
          return null;
        }),
      },
    ];

    const mockStagesContainer = {
      querySelectorAll: jest.fn(() => [mockInput('Step 1'), mockInput('Step 2')]),
    };

    const mockImageHandler = {
      getImages: jest.fn(() => [
        {
          file: new File(['test'], 'test.jpg', { type: 'image/jpeg' }),
          isPrimary: true,
        },
        {
          id: 'existing-1',
          isPrimary: false,
          full: 'path/to/full.jpg',
          access: 'public',
          uploadedBy: 'user123',
          fileName: 'existing.jpg',
          uploadTimestamp: new Date(),
        },
      ]),
      getRemovedImages: jest.fn(() => [{ id: 'removed-1', full: 'path/to/removed.jpg' }]),
    };

    const mockIngredientsComponent = {
      getData: jest.fn(
        () =>
          data.ingredientSections ||
          data.ingredients || [
            { amount: '2', unit: 'cups', item: 'rice' },
            { amount: '1', unit: 'kg', item: 'chicken' },
          ],
      ),
    };

    const mockInstructionsComponent = {
      getInstructions: jest.fn(() => data.stages || data.instructions || ['Step 1', 'Step 2']),
    };

    const mockMetadataComponent = {
      getFormData: jest.fn(() => ({
        name: data.name || 'Test Recipe',
        category: data.category || 'main-courses',
        prepTime: data.prepTime ? parseInt(data.prepTime) : 30,
        waitTime: data.waitTime ? parseInt(data.waitTime) : 45,
        difficulty: data.difficulty || 'קלה',
        mainIngredient: data.mainIngredient || 'Chicken',
        tags: data.tags
          ? Array.isArray(data.tags)
            ? data.tags
            : data.tags.split(', ')
          : ['healthy', 'quick'],
        servings: data.servings ? parseInt(data.servings) : 4,
      })),
    };

    const mockCommentsComponent = {
      getData: jest.fn(() => {
        if (data.comments === '') return [];
        return data.comments
          ? Array.isArray(data.comments)
            ? data.comments
            : [data.comments]
          : ['Test comments'];
      }),
    };

    return {
      getElementById: jest.fn((id) => {
        if (id === 'recipe-images') return mockImageHandler;
        if (id === 'ingredients-list') return mockIngredientsComponent;
        if (id === 'instructions-list') return mockInstructionsComponent;
        if (id === 'metadata-fields') return mockMetadataComponent;
        if (id === 'comments-list') return mockCommentsComponent;
        return mockElements[id] || null;
      }),
      querySelector: jest.fn((selector) => {
        if (selector === '.recipe-form__stages') return mockStagesContainer;
        return null;
      }),
      querySelectorAll: jest.fn((selector) => {
        if (selector === '.recipe-form__ingredient-entry') return mockIngredientEntries;
        if (selector === '.recipe-form__steps') return []; // Single stage mode
        return [];
      }),
    };
  }

  describe('collectRecipeFormData', () => {
    beforeEach(() => {
      mockGetCurrentUser.mockReturnValue({ uid: 'test-user-123' });
    });

    it('should collect basic recipe metadata correctly', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.name).toBe('Test Recipe');
      expect(result.category).toBe('main-courses');
      expect(result.prepTime).toBe(30);
      expect(result.waitTime).toBe(45);
      expect(result.difficulty).toBe('קלה');
      expect(result.mainIngredient).toBe('Chicken');
      expect(result.servings).toBe(4);
      expect(result.approved).toBeUndefined();
    });

    it('should parse tags correctly', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.tags).toEqual(['healthy', 'quick']);
    });

    it('should collect flat ingredients correctly', () => {
      const mockShadowRoot = createMockShadowRoot({
        ingredients: [
          { amount: '2', unit: 'cups', item: 'rice' },
          { amount: '1', unit: 'kg', item: 'chicken' },
        ],
      });

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.ingredients).toEqual([
        { amount: '2', unit: 'cups', item: 'rice' },
        { amount: '1', unit: 'kg', item: 'chicken' },
      ]);
      expect(result.ingredientSections).toBeUndefined();
    });

    it('should collect sectioned ingredients correctly', () => {
      const mockShadowRoot = createMockShadowRoot({
        ingredientSections: [
          {
            title: 'Dry Ingredients',
            items: [
              { amount: '2', unit: 'cups', item: 'flour' },
              { amount: '1', unit: 'tsp', item: 'salt' },
            ],
          },
          {
            title: 'Wet Ingredients',
            items: [{ amount: '1', unit: 'cup', item: 'milk' }],
          },
        ],
      });

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.ingredientSections).toEqual([
        {
          title: 'Dry Ingredients',
          items: [
            { amount: '2', unit: 'cups', item: 'flour' },
            { amount: '1', unit: 'tsp', item: 'salt' },
          ],
        },
        {
          title: 'Wet Ingredients',
          items: [{ amount: '1', unit: 'cup', item: 'milk' }],
        },
      ]);
      expect(result.ingredients).toBeUndefined();
    });

    it('should default to flat ingredients when component returns null', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const mockShadowRoot = createMockShadowRoot();
      // Override ingredients component to return null
      mockShadowRoot.getElementById = jest.fn((id) => {
        if (id === 'ingredients-list') return null;
        if (id === 'instructions-list') return null;
        if (id === 'metadata-fields')
          return {
            getFormData: () => ({ name: 'Test Recipe', category: 'main-courses' }),
          };
        return null;
      });

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.ingredients).toBeUndefined();
      expect(result.ingredientSections).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Ingredients component not found or missing getData method',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Instructions component not found or missing getInstructions method',
      );
      consoleSpy.mockRestore();
    });

    it('should collect instructions in single stage mode', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.instructions).toEqual(['Step 1', 'Step 2']);
      expect(result.stages).toBeUndefined();
    });

    it('should collect stages in multi-stage mode', () => {
      const mockShadowRoot = createMockShadowRoot({
        stages: [
          {
            title: 'Stage 1',
            items: [{ text: 'Step 1.1' }, { text: 'Step 1.2' }],
          },
          {
            title: 'Stage 2',
            items: [{ text: 'Step 2.1' }],
          },
        ],
      });

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.stages).toEqual([
        { title: 'Stage 1', instructions: ['Step 1.1', 'Step 1.2'] },
        { title: 'Stage 2', instructions: ['Step 2.1'] },
      ]);
      expect(result.instructions).toBeUndefined();
    });

    it('should collect images with correct metadata', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.images).toHaveLength(2);

      // New image
      expect(result.images[0]).toEqual({
        file: expect.any(File),
        isPrimary: true,
        access: 'public',
        uploadedBy: 'test-user-123',
        source: 'new',
      });

      // Existing image (collected as part of the images array)
      expect(result.images[1]).toEqual({
        id: 'existing-1',
        isPrimary: false,
        full: 'path/to/full.jpg',
        access: 'public',
        uploadedBy: 'user123',
        fileName: 'existing.jpg',
        uploadTimestamp: expect.any(Date),
        source: 'existing',
      });

      expect(result.toDelete).toEqual([{ id: 'removed-1', full: 'path/to/removed.jpg' }]);
    });

    it('preserves arbitrary persistent fields on existing images (e.g. aiEnhanced)', () => {
      const mockShadowRoot = createMockShadowRoot();
      const imageHandler = mockShadowRoot.getElementById('recipe-images');
      const [newImg, existingImg] = imageHandler.getImages();
      imageHandler.getImages = jest.fn(() => [
        newImg,
        { ...existingImg, aiEnhanced: true, unknownFutureField: 'preserved' },
      ]);

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.images[1]).toMatchObject({
        aiEnhanced: true,
        unknownFutureField: 'preserved',
        source: 'existing',
      });
    });

    it('should handle anonymous user for new images', () => {
      mockGetCurrentUser.mockReturnValue(null);
      const mockShadowRoot = createMockShadowRoot();

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.images[0].uploadedBy).toBe('anonymous');
    });

    it('should collect comments as array', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.comments).toEqual(['Test comments']);
    });

    it('should handle empty comments', () => {
      const mockShadowRoot = createMockShadowRoot({ comments: '' });

      const result = collectRecipeFormData(mockShadowRoot);

      expect(result.comments).toEqual([]);
    });
  });

  describe('collectSectionData', () => {
    it('should collect metadata section', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectSectionData(mockShadowRoot, 'metadata');

      expect(result).toEqual({
        name: 'Test Recipe',
        category: 'main-courses',
        prepTime: 30,
        waitTime: 45,
        difficulty: 'קלה',
        mainIngredient: 'Chicken',
        tags: ['healthy', 'quick'],
        servings: 4,
      });
    });

    it('should collect ingredients section', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectSectionData(mockShadowRoot, 'ingredients');

      expect(result.ingredients).toEqual([
        { amount: '2', unit: 'cups', item: 'rice' },
        { amount: '1', unit: 'kg', item: 'chicken' },
      ]);
    });

    it('should collect instructions section', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectSectionData(mockShadowRoot, 'instructions');

      expect(result.instructions).toEqual(['Step 1', 'Step 2']);
    });

    it('should collect images section', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectSectionData(mockShadowRoot, 'images');

      expect(result.images).toHaveLength(2);
      expect(result.toDelete).toHaveLength(1);
    });

    it('should collect comments section', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectSectionData(mockShadowRoot, 'comments');

      expect(result.comments).toEqual(['Test comments']);
    });

    it('should return empty object for unknown section', () => {
      const mockShadowRoot = createMockShadowRoot();

      const result = collectSectionData(mockShadowRoot, 'unknown');

      expect(result).toEqual({});
    });
  });

  describe('hasMinimumRequiredData', () => {
    it('should return true for valid recipe data', () => {
      const recipeData = {
        name: 'Test Recipe',
        category: 'main-courses',
        ingredients: [{ amount: '1', unit: 'cup', item: 'rice' }],
        instructions: ['Step 1', 'Step 2'],
      };

      const result = hasMinimumRequiredData(recipeData);

      expect(result).toBe(true);
    });

    it('should return true for valid recipe data with stages', () => {
      const recipeData = {
        name: 'Test Recipe',
        category: 'main-courses',
        ingredients: [{ amount: '1', unit: 'cup', item: 'rice' }],
        stages: [{ title: 'Stage 1', instructions: ['Step 1'] }],
      };

      const result = hasMinimumRequiredData(recipeData);

      expect(result).toBe(true);
    });

    it('should return false for missing name', () => {
      const recipeData = {
        category: 'main-courses',
        ingredients: [{ amount: '1', unit: 'cup', item: 'rice' }],
        instructions: ['Step 1'],
      };

      const result = hasMinimumRequiredData(recipeData);

      expect(result).toBe(false);
    });

    it('should return false for missing category', () => {
      const recipeData = {
        name: 'Test Recipe',
        ingredients: [{ amount: '1', unit: 'cup', item: 'rice' }],
        instructions: ['Step 1'],
      };

      const result = hasMinimumRequiredData(recipeData);

      expect(result).toBe(false);
    });

    it('should return false for empty ingredients', () => {
      const recipeData = {
        name: 'Test Recipe',
        category: 'main-courses',
        ingredients: [],
        instructions: ['Step 1'],
      };

      const result = hasMinimumRequiredData(recipeData);

      expect(result).toBe(false);
    });

    it('should return false for missing instructions and stages', () => {
      const recipeData = {
        name: 'Test Recipe',
        category: 'main-courses',
        ingredients: [{ amount: '1', unit: 'cup', item: 'rice' }],
      };

      const result = hasMinimumRequiredData(recipeData);

      expect(result).toBe(false);
    });

    it('should return false for empty instructions array', () => {
      const recipeData = {
        name: 'Test Recipe',
        category: 'main-courses',
        ingredients: [{ amount: '1', unit: 'cup', item: 'rice' }],
        instructions: [],
      };

      const result = hasMinimumRequiredData(recipeData);

      expect(result).toBe(false);
    });
  });
});
