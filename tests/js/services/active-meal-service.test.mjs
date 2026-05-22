import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let ActiveMealService;
let onSnapshot;

const firestoreMocks = {
  getDocument: jest.fn(),
  updateDocument: jest.fn(),
  deleteDocument: jest.fn(),
  batchWrite: jest.fn(),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset());
  firestoreMocks.batchWrite.mockResolvedValue();
  firestoreMocks.updateDocument.mockResolvedValue();
  firestoreMocks.deleteDocument.mockResolvedValue();

  ({ ActiveMealService } = await import('src/js/services/meals/active-meal-service.js'));
  ({ onSnapshot } = await import('firebase/firestore'));
  onSnapshot.mockReset();
});

describe('ActiveMealService — CRUD', () => {
  describe('addToMeal', () => {
    it('returns invalid_input when uid or recipeId missing', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(await ActiveMealService.addToMeal('', 'r1')).toEqual({
        success: false,
        reason: 'invalid_input',
      });
      expect(await ActiveMealService.addToMeal('u1', '')).toEqual({
        success: false,
        reason: 'invalid_input',
      });
      errSpy.mockRestore();
    });

    it('returns duplicate when recipe is already in the meal', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        recipeIds: ['r1', 'r2'],
      });

      const result = await ActiveMealService.addToMeal('u1', 'r2');
      expect(result).toEqual({ success: false, reason: 'duplicate' });
      expect(firestoreMocks.batchWrite).not.toHaveBeenCalled();
    });

    it('writes a merge-set batch when recipe is new (or doc is empty)', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null); // doc not yet created

      const result = await ActiveMealService.addToMeal('u1', 'r1');
      expect(result).toEqual({ success: true });
      expect(firestoreMocks.batchWrite).toHaveBeenCalledTimes(1);
      const op = firestoreMocks.batchWrite.mock.calls[0][0][0];
      expect(op.type).toBe('set');
      expect(op.collection).toBe('active_meals');
      expect(op.id).toBe('u1');
      expect(op.options).toEqual({ merge: true });
    });

    it('returns error reason if Firestore throws', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ recipeIds: [] });
      firestoreMocks.batchWrite.mockRejectedValue(new Error('boom'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await ActiveMealService.addToMeal('u1', 'r1');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('error');
      expect(result.error.message).toBe('boom');
      errSpy.mockRestore();
    });
  });

  describe('removeFromMeal', () => {
    it('returns invalid_inputs when uid or recipeId missing', async () => {
      expect(await ActiveMealService.removeFromMeal('', 'r1')).toEqual({
        success: false,
        error: 'invalid_inputs',
      });
      expect(await ActiveMealService.removeFromMeal('u1', '')).toEqual({
        success: false,
        error: 'invalid_inputs',
      });
    });

    it('issues an updateDocument with arrayRemove on recipeIds AND deleteField on recipeStates[recipeId]', async () => {
      const result = await ActiveMealService.removeFromMeal('u1', 'r-a');
      expect(result).toEqual({ success: true });
      expect(firestoreMocks.updateDocument).toHaveBeenCalledTimes(1);
      const [collection, id, updates] = firestoreMocks.updateDocument.mock.calls[0];
      expect(collection).toBe('active_meals');
      expect(id).toBe('u1');
      // The dot-notation key for the per-recipe state cleanup
      expect(Object.keys(updates)).toContain('recipeStates.r-a');
      expect('recipeIds' in updates).toBe(true);
      expect('lastUpdated' in updates).toBe(true);
    });
  });

  describe('clearMeal', () => {
    it('returns invalid_user when uid is missing', async () => {
      expect(await ActiveMealService.clearMeal('')).toEqual({
        success: false,
        error: 'invalid_user',
      });
    });

    it('delegates to FirestoreService.deleteDocument', async () => {
      const result = await ActiveMealService.clearMeal('u1');
      expect(result).toEqual({ success: true });
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('active_meals', 'u1');
    });
  });

  describe('switchRecipe', () => {
    it('writes activeRecipeId + lastUpdated', async () => {
      const result = await ActiveMealService.switchRecipe('u1', 'r1');
      expect(result).toEqual({ success: true });
      const [collection, id, updates] = firestoreMocks.updateDocument.mock.calls[0];
      expect(collection).toBe('active_meals');
      expect(id).toBe('u1');
      expect(updates.activeRecipeId).toBe('r1');
      expect('lastUpdated' in updates).toBe(true);
    });
  });

  describe('updateRecipeState', () => {
    it('flattens updates into Firestore dot-notation under the right recipeId', async () => {
      const result = await ActiveMealService.updateRecipeState('u1', 'r1', {
        servings: 4,
        currentStep: 2,
      });
      expect(result).toEqual({ success: true });
      const [, , updates] = firestoreMocks.updateDocument.mock.calls[0];
      expect(updates['recipeStates.r1.servings']).toBe(4);
      expect(updates['recipeStates.r1.currentStep']).toBe(2);
      expect('lastUpdated' in updates).toBe(true);
    });

    it('returns error shape on Firestore failure', async () => {
      firestoreMocks.updateDocument.mockRejectedValue(new Error('boom'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await ActiveMealService.updateRecipeState('u1', 'r1', { foo: 1 });
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('boom');
      errSpy.mockRestore();
    });
  });
});

describe('ActiveMealService — subscribe()', () => {
  it('throws when uid is missing', () => {
    expect(() => ActiveMealService.subscribe('', () => {})).toThrow('uid is required');
  });

  it('throws when callback is not a function', () => {
    expect(() => ActiveMealService.subscribe('u1', null)).toThrow('callback must be a function');
    expect(() => ActiveMealService.subscribe('u1', 'not-a-fn')).toThrow(
      'callback must be a function',
    );
  });

  it('returns the unsubscribe function from onSnapshot', () => {
    const fakeUnsub = jest.fn();
    onSnapshot.mockReturnValue(fakeUnsub);

    const unsub = ActiveMealService.subscribe('u1', () => {});
    expect(unsub).toBe(fakeUnsub);
  });

  it('passes docSnap.data() to the callback when the doc exists', () => {
    let captured;
    onSnapshot.mockImplementation((_ref, listener) => {
      // Simulate Firestore firing the snapshot listener with an exists=true snapshot
      listener({
        exists: () => true,
        data: () => ({ recipeIds: ['r1'], activeRecipeId: 'r1' }),
      });
      return jest.fn();
    });

    ActiveMealService.subscribe('u1', (data) => {
      captured = data;
    });

    expect(captured).toEqual({ recipeIds: ['r1'], activeRecipeId: 'r1' });
  });

  it('passes null to the callback when the doc does not exist', () => {
    let captured = 'not-set';
    onSnapshot.mockImplementation((_ref, listener) => {
      listener({ exists: () => false });
      return jest.fn();
    });

    ActiveMealService.subscribe('u1', (data) => {
      captured = data;
    });

    expect(captured).toBeNull();
  });

  it('forwards every snapshot update to the callback (multiple calls)', () => {
    const calls = [];
    let savedListener;
    onSnapshot.mockImplementation((_ref, listener) => {
      savedListener = listener;
      return jest.fn();
    });

    ActiveMealService.subscribe('u1', (data) => calls.push(data));

    // First snapshot — doc didn't exist yet
    savedListener({ exists: () => false });
    // Then doc gets created — recipeIds gets populated
    savedListener({
      exists: () => true,
      data: () => ({ recipeIds: ['r1'] }),
    });
    // Then another recipe is added
    savedListener({
      exists: () => true,
      data: () => ({ recipeIds: ['r1', 'r2'] }),
    });

    expect(calls).toEqual([null, { recipeIds: ['r1'] }, { recipeIds: ['r1', 'r2'] }]);
  });

  it('after unsubscribe(), simulated subsequent snapshots are no longer relayed', () => {
    // We can't truly assert "onSnapshot's underlying connection is torn down"
    // without integration tests against Firestore. What we CAN verify is that
    // the unsubscribe function we hand back is the same opaque fn onSnapshot
    // returned — so calling it triggers Firestore's actual teardown.
    const fakeUnsub = jest.fn();
    onSnapshot.mockReturnValue(fakeUnsub);

    const unsub = ActiveMealService.subscribe('u1', () => {});
    expect(fakeUnsub).not.toHaveBeenCalled();
    unsub();
    expect(fakeUnsub).toHaveBeenCalledTimes(1);
  });
});
