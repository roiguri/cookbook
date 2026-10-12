import { mapExtractedDataToForm } from '../../../src/js/utils/recipe-extractor-utils.js';

describe('Recipe Extractor Utils', () => {
  describe('mapExtractedDataToForm', () => {
    it('should map valid full data correctly', () => {
      const input = {
        name: 'Test Recipe',
        category: 'Dessert',
        prepTime: 10,
        waitTime: 20,
        servings: 4,
        difficulty: 'Easy',
        description: 'A yummy test',
        ingredients: [
          { item: 'Flour', amount: '2', unit: 'cups' },
          { item: 'Sugar', amount: '1', unit: 'tbsp' },
        ],
        instructions: ['Mix', 'Bake'],
        comments: ['Enjoy'],
        tags: ['sweet'],
      };

      const result = mapExtractedDataToForm(input);

      expect(result.name).toBe('Test Recipe');
      expect(result.category).toBe('Dessert');
      expect(result.prepTime).toBe(10);
      expect(result.ingredients).toHaveLength(2);
      expect(result.ingredients[0]).toEqual({ item: 'Flour', amount: 2, unit: 'cups' });
      expect(result.instructions).toEqual(['Mix', 'Bake']);
      expect(result.comments).toEqual(['Enjoy']);
      expect(result.tags).toEqual(['sweet']);
    });

    it('should handle missing optional fields gracefully', () => {
      const input = {
        name: 'Minimal Recipe',
        ingredients: [],
        instructions: [],
      };

      const result = mapExtractedDataToForm(input);

      expect(result.name).toBe('Minimal Recipe');
      expect(result.category).toBe('');
      expect(result.prepTime).toBeNull();
      expect(result.waitTime).toBeNull();
      expect(result.servings).toBeNull();
      expect(result.difficulty).toBe('בינונית'); // Default
      expect(result.ingredients).toEqual([]);
    });

    it('should map mainIngredient correctly', () => {
      const input = {
        name: 'Chicken Soup',
        mainIngredient: 'Chicken',
      };
      const result = mapExtractedDataToForm(input);
      expect(result.mainIngredient).toBe('Chicken');
    });

    it('should handle null input', () => {
      const result = mapExtractedDataToForm(null);
      expect(result).toEqual({});
    });

    it('should map partial ingredients correctly', () => {
      const input = {
        name: 'Partial',
        ingredients: [
          { item: 'Salt' }, // Missing amount/unit
        ],
      };

      const result = mapExtractedDataToForm(input);
      expect(result.ingredients[0]).toEqual({ item: 'Salt', amount: null, unit: '' });
    });

    it('should map recipe with sections and stages correctly', () => {
      const input = {
        name: 'Complex Cake',
        ingredientSections: [
          {
            title: 'Cake',
            items: [{ item: 'Flour', amount: '2', unit: 'cups' }],
          },
          {
            title: 'Frosting',
            items: [{ item: 'Sugar', amount: '1', unit: 'cup' }],
          },
        ],
        stages: [
          {
            title: 'Bake Cake',
            instructions: ['Mix flour', 'Bake'],
          },
          {
            title: 'Make Frosting',
            instructions: ['Mix sugar'],
          },
        ],
      };

      const result = mapExtractedDataToForm(input);

      expect(result.name).toBe('Complex Cake');

      // Check sections
      expect(result.ingredientSections).toHaveLength(2);
      expect(result.ingredientSections[0].title).toBe('Cake');
      expect(result.ingredientSections[0].items[0]).toEqual({
        item: 'Flour',
        amount: 2,
        unit: 'cups',
      });
      expect(result.ingredientSections[1].title).toBe('Frosting');

      // Check that flat ingredients are null
      expect(result.ingredients).toBeNull();

      // Check stages
      expect(result.stages).toHaveLength(2);
      expect(result.stages[0].title).toBe('Bake Cake');
      expect(result.stages[0].instructions).toEqual(['Mix flour', 'Bake']);

      // Check that flat instructions are null
      expect(result.instructions).toBeNull();
    });
    it('should use Hebrew defaults for missing section titles', () => {
      const input = {
        name: 'Untitled Sections',
        ingredientSections: [
          {
            items: [{ item: 'Salt' }], // Missing title
          },
        ],
        stages: [
          {
            instructions: ['Do this'], // Missing title
          },
        ],
      };

      const result = mapExtractedDataToForm(input);

      expect(result.ingredientSections[0].title).toBe('כללי');
      expect(result.stages[0].title).toBe('שלב');
    });
  });
});
