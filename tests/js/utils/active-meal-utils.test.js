import { jest } from '@jest/globals';

// Mock FirestoreService
jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: {
    getDocument: jest.fn(),
    batchWrite: jest.fn(),
    updateDocument: jest.fn(),
    deleteDocument: jest.fn(),
  },
}));

// Mock firebase/firestore
jest.unstable_mockModule('firebase/firestore', () => ({
  arrayUnion: jest.fn((...args) => ({ type: 'arrayUnion', args })),
  arrayRemove: jest.fn((...args) => ({ type: 'arrayRemove', args })),
  serverTimestamp: jest.fn(() => 'MOCK_TIMESTAMP'),
  deleteField: jest.fn(() => 'DELETE_FIELD'),
}));

let FirestoreService;
let ActiveMealUtils;
let arrayUnion, arrayRemove, serverTimestamp, deleteField;

describe('ActiveMealUtils', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    ({ FirestoreService } = await import('src/js/services/_firebase/firestore-service.js'));
    ({ ActiveMealUtils } = await import('src/js/utils/active-meal-utils.js'));
    ({ arrayUnion, arrayRemove, serverTimestamp, deleteField } = await import(
      'firebase/firestore'
    ));
  });

  describe('addToMeal', () => {
    it('returns error if userId or recipeId is missing', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(await ActiveMealUtils.addToMeal(null, 'recipe1')).toEqual({
        success: false,
        reason: 'invalid_input',
      });
      expect(await ActiveMealUtils.addToMeal('user1', null)).toEqual({
        success: false,
        reason: 'invalid_input',
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('returns duplicate if recipe already in meal', async () => {
      FirestoreService.getDocument.mockResolvedValue({ recipeIds: ['recipe1'] });
      const result = await ActiveMealUtils.addToMeal('user1', 'recipe1');
      expect(result).toEqual({ success: false, reason: 'duplicate' });
    });

    it('adds recipe to meal', async () => {
      FirestoreService.getDocument.mockResolvedValue({ recipeIds: [] });
      FirestoreService.batchWrite.mockResolvedValue(undefined);

      const result = await ActiveMealUtils.addToMeal('user1', 'recipe1');
      expect(result).toEqual({ success: true });
      expect(FirestoreService.batchWrite).toHaveBeenCalledWith([
        {
          type: 'set',
          collection: 'active_meals',
          id: 'user1',
          data: {
            recipeIds: { type: 'arrayUnion', args: ['recipe1'] },
            lastUpdated: 'MOCK_TIMESTAMP',
          },
          options: { merge: true },
        },
      ]);
    });

    it('handles errors', async () => {
      FirestoreService.getDocument.mockRejectedValue(new Error('fail'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await ActiveMealUtils.addToMeal('user1', 'recipe1');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('error');
      consoleSpy.mockRestore();
    });
  });

  describe('removeFromMeal', () => {
    it('returns error if input invalid', async () => {
      expect(await ActiveMealUtils.removeFromMeal(null, 'recipe1')).toEqual({
        success: false,
        error: 'invalid_inputs',
      });
    });

    it('removes recipe from meal and cleans up state', async () => {
      FirestoreService.updateDocument.mockResolvedValue(undefined);

      const result = await ActiveMealUtils.removeFromMeal('user1', 'recipe1');
      expect(result).toEqual({ success: true });
      expect(FirestoreService.updateDocument).toHaveBeenCalledWith('active_meals', 'user1', {
        recipeIds: { type: 'arrayRemove', args: ['recipe1'] },
        lastUpdated: 'MOCK_TIMESTAMP',
        'recipeStates.recipe1': 'DELETE_FIELD',
      });
    });

    it('handles errors', async () => {
      FirestoreService.updateDocument.mockRejectedValue(new Error('fail'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await ActiveMealUtils.removeFromMeal('user1', 'recipe1');
      expect(result.success).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('clearMeal', () => {
    it('returns error if userId missing', async () => {
      expect(await ActiveMealUtils.clearMeal(null)).toEqual({
        success: false,
        error: 'invalid_user',
      });
    });

    it('deletes the meal document', async () => {
      FirestoreService.deleteDocument.mockResolvedValue(undefined);
      const result = await ActiveMealUtils.clearMeal('user1');
      expect(result).toEqual({ success: true });
      expect(FirestoreService.deleteDocument).toHaveBeenCalledWith('active_meals', 'user1');
    });

    it('handles errors', async () => {
      FirestoreService.deleteDocument.mockRejectedValue(new Error('fail'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await ActiveMealUtils.clearMeal('user1');
      expect(result.success).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('switchRecipe', () => {
    it('updates activeRecipeId', async () => {
      FirestoreService.updateDocument.mockResolvedValue(undefined);
      const result = await ActiveMealUtils.switchRecipe('user1', 'recipe1');
      expect(result).toEqual({ success: true });
      expect(FirestoreService.updateDocument).toHaveBeenCalledWith('active_meals', 'user1', {
        activeRecipeId: 'recipe1',
        lastUpdated: 'MOCK_TIMESTAMP',
      });
    });

    it('handles errors', async () => {
      FirestoreService.updateDocument.mockRejectedValue(new Error('fail'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await ActiveMealUtils.switchRecipe('user1', 'recipe1');
      expect(result.success).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('updateRecipeState', () => {
    it('updates specific recipe fields using dot notation', async () => {
      FirestoreService.updateDocument.mockResolvedValue(undefined);
      const updates = { servings: 4, checked: true, unselectedIngredients: ['recipe1-0-1'] };
      const result = await ActiveMealUtils.updateRecipeState('user1', 'recipe1', updates);

      expect(result).toEqual({ success: true });
      expect(FirestoreService.updateDocument).toHaveBeenCalledWith('active_meals', 'user1', {
        'recipeStates.recipe1.servings': 4,
        'recipeStates.recipe1.checked': true,
        'recipeStates.recipe1.unselectedIngredients': ['recipe1-0-1'],
        lastUpdated: 'MOCK_TIMESTAMP',
      });
    });

    it('handles errors', async () => {
      FirestoreService.updateDocument.mockRejectedValue(new Error('fail'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await ActiveMealUtils.updateRecipeState('user1', 'recipe1', {});
      expect(result.success).toBe(false);
      consoleSpy.mockRestore();
    });
  });
});
