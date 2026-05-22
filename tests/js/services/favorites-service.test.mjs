import { jest } from '@jest/globals';

describe('FavoritesService', () => {
  let favoritesService;
  let authServiceMock;
  let firestoreServiceMock;
  let mockUser;
  let arrayUnionMock;
  let arrayRemoveMock;

  beforeEach(async () => {
    jest.resetModules(); // Important to reset module registry to apply new mocks

    mockUser = { uid: 'user123' };

    // Create mock implementations
    authServiceMock = {
      getCurrentUser: jest.fn().mockReturnValue(mockUser),
    };

    firestoreServiceMock = {
      getDocument: jest.fn(),
      updateDocument: jest.fn(),
    };

    arrayUnionMock = jest.fn((id) => ({ type: 'arrayUnion', value: id }));
    arrayRemoveMock = jest.fn((id) => ({ type: 'arrayRemove', value: id }));

    // Mock dependencies using unstable_mockModule (required for ESM)
    jest.unstable_mockModule('../../../src/js/services/auth/auth-service.js', () => ({
      default: authServiceMock,
    }));

    jest.unstable_mockModule('../../../src/js/services/_firebase/firestore-service.js', () => ({
      FirestoreService: firestoreServiceMock,
    }));

    jest.unstable_mockModule('firebase/firestore', () => ({
      arrayUnion: arrayUnionMock,
      arrayRemove: arrayRemoveMock,
    }));

    // Dynamically import the service under test
    const module = await import('../../../src/js/services/users/favorites-service.js');
    favoritesService = module.default;
  });

  describe('getUserFavorites', () => {
    test('should return empty array if no user is logged in', async () => {
      authServiceMock.getCurrentUser.mockReturnValue(null);

      const result = await favoritesService.getUserFavorites();

      expect(result).toEqual([]);
      expect(firestoreServiceMock.getDocument).not.toHaveBeenCalled();
    });

    test('should fetch favorites from Firestore if not cached', async () => {
      const mockFavorites = ['recipe1', 'recipe2'];
      firestoreServiceMock.getDocument.mockResolvedValue({ favorites: mockFavorites });

      const result = await favoritesService.getUserFavorites();

      expect(result).toEqual(mockFavorites);
      expect(firestoreServiceMock.getDocument).toHaveBeenCalledWith('users', mockUser.uid);
    });

    test('should deduplicate concurrent requests', async () => {
      const mockFavorites = ['recipe1'];
      // Create a delayed promise to simulate network latency
      let resolvePromise;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      firestoreServiceMock.getDocument.mockReturnValue(delayedPromise);

      // Call twice concurrently
      const promise1 = favoritesService.getUserFavorites();
      const promise2 = favoritesService.getUserFavorites();

      // Resolve the Firestore call
      resolvePromise({ favorites: mockFavorites });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual(mockFavorites);
      expect(result2).toEqual(mockFavorites);

      // Should verify that getDocument was called only ONCE
      expect(firestoreServiceMock.getDocument).toHaveBeenCalledTimes(1);
    });

    test('should return cached favorites if available and user matches', async () => {
      const mockFavorites = ['recipe1', 'recipe2'];
      firestoreServiceMock.getDocument.mockResolvedValue({ favorites: mockFavorites });

      // First call to populate cache
      await favoritesService.getUserFavorites();

      // Clear mock to ensure second call doesn't hit Firestore
      firestoreServiceMock.getDocument.mockClear();

      // Second call should use cache
      const result = await favoritesService.getUserFavorites();

      expect(result).toEqual(mockFavorites);
      expect(firestoreServiceMock.getDocument).not.toHaveBeenCalled();
    });

    test('should handle Firestore errors gracefully', async () => {
      firestoreServiceMock.getDocument.mockRejectedValue(new Error('Firestore error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await favoritesService.getUserFavorites();

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('addFavorite', () => {
    test('should add recipe to Firestore and update cache', async () => {
      // Setup initial cache
      firestoreServiceMock.getDocument.mockResolvedValue({ favorites: ['recipe1'] });
      await favoritesService.getUserFavorites();

      await favoritesService.addFavorite('recipe2');

      // Check Firestore call
      expect(arrayUnionMock).toHaveBeenCalledWith('recipe2');
      expect(firestoreServiceMock.updateDocument).toHaveBeenCalledWith('users', mockUser.uid, {
        favorites: { type: 'arrayUnion', value: 'recipe2' },
      });

      // Check cache update
      const result = await favoritesService.getUserFavorites();
      expect(result).toContain('recipe2');
      expect(result).toHaveLength(2);
    });

    test('should revert cache update if Firestore fails', async () => {
      // Setup initial cache
      firestoreServiceMock.getDocument.mockResolvedValue({ favorites: ['recipe1'] });
      await favoritesService.getUserFavorites();

      firestoreServiceMock.updateDocument.mockRejectedValue(new Error('Update failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(favoritesService.addFavorite('recipe2')).rejects.toThrow('Update failed');

      // Check cache reverted
      const result = await favoritesService.getUserFavorites();
      expect(result).not.toContain('recipe2');
      expect(result).toHaveLength(1);

      consoleSpy.mockRestore();
    });
  });

  describe('removeFavorite', () => {
    test('should remove recipe from Firestore and update cache', async () => {
      // Setup initial cache
      firestoreServiceMock.getDocument.mockResolvedValue({ favorites: ['recipe1', 'recipe2'] });
      await favoritesService.getUserFavorites();

      await favoritesService.removeFavorite('recipe1');

      // Check Firestore call
      expect(arrayRemoveMock).toHaveBeenCalledWith('recipe1');
      expect(firestoreServiceMock.updateDocument).toHaveBeenCalledWith('users', mockUser.uid, {
        favorites: { type: 'arrayRemove', value: 'recipe1' },
      });

      // Check cache update
      const result = await favoritesService.getUserFavorites();
      expect(result).not.toContain('recipe1');
      expect(result).toContain('recipe2');
      expect(result).toHaveLength(1);
    });

    test('should revert cache update if Firestore fails', async () => {
      // Setup initial cache
      firestoreServiceMock.getDocument.mockResolvedValue({ favorites: ['recipe1', 'recipe2'] });
      await favoritesService.getUserFavorites();

      firestoreServiceMock.updateDocument.mockRejectedValue(new Error('Update failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(favoritesService.removeFavorite('recipe1')).rejects.toThrow('Update failed');

      // Check cache reverted (recipe1 should still be there)
      const result = await favoritesService.getUserFavorites();
      expect(result).toContain('recipe1');
      expect(result).toHaveLength(2);

      consoleSpy.mockRestore();
    });
  });

  describe('updateCache', () => {
    test('should update cache manually', async () => {
      // Setup initial cache
      firestoreServiceMock.getDocument.mockResolvedValue({ favorites: ['recipe1'] });
      await favoritesService.getUserFavorites();

      favoritesService.updateCache('recipe2', true);

      const result = await favoritesService.getUserFavorites();
      expect(result).toContain('recipe2');
    });
  });
});
