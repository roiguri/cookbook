import { jest } from '@jest/globals';

describe('FavoritesService (CollectionService shim)', () => {
  let favoritesService;
  let authServiceMock;
  let collectionServiceMock;
  let recipeServiceMock;
  let getPrimaryImageMock;
  let mockUser;

  beforeEach(async () => {
    jest.resetModules(); // Important to reset module registry to apply new mocks

    mockUser = { uid: 'user123' };

    // Create mock implementations
    authServiceMock = {
      getCurrentUser: jest.fn().mockReturnValue(mockUser),
    };

    collectionServiceMock = {
      list: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };

    recipeServiceMock = {
      get: jest.fn(),
    };

    getPrimaryImageMock = jest.fn();

    // Mock dependencies using unstable_mockModule (required for ESM)
    jest.unstable_mockModule('../../../src/js/services/auth/auth-service.js', () => ({
      default: authServiceMock,
    }));

    jest.unstable_mockModule('../../../src/js/services/users/collection-service.js', () => ({
      CollectionService: collectionServiceMock,
    }));

    jest.unstable_mockModule('../../../src/js/services/recipes/recipe-service.js', () => ({
      RecipeService: recipeServiceMock,
    }));

    jest.unstable_mockModule('../../../src/js/utils/recipes/recipe-image-utils.js', () => ({
      getPrimaryImage: getPrimaryImageMock,
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
      expect(collectionServiceMock.list).not.toHaveBeenCalled();
    });

    test('should return entry IDs from CollectionService.list, regardless of state', async () => {
      collectionServiceMock.list.mockResolvedValue([
        { id: 'recipe1', source: 'saved', state: 'rotation' },
        { id: 'recipe2', source: 'saved', state: 'to-try' },
      ]);

      const result = await favoritesService.getUserFavorites();

      expect(result).toEqual(['recipe1', 'recipe2']);
      expect(collectionServiceMock.list).toHaveBeenCalledWith(mockUser.uid);
    });

    test('should deduplicate concurrent requests', async () => {
      let resolvePromise;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      collectionServiceMock.list.mockReturnValue(delayedPromise);

      const promise1 = favoritesService.getUserFavorites();
      const promise2 = favoritesService.getUserFavorites();

      resolvePromise([{ id: 'recipe1' }]);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual(['recipe1']);
      expect(result2).toEqual(['recipe1']);
      expect(collectionServiceMock.list).toHaveBeenCalledTimes(1);
    });

    test('should return cached favorites if available and user matches', async () => {
      collectionServiceMock.list.mockResolvedValue([{ id: 'recipe1' }, { id: 'recipe2' }]);

      // First call to populate cache
      await favoritesService.getUserFavorites();

      collectionServiceMock.list.mockClear();

      // Second call should use cache
      const result = await favoritesService.getUserFavorites();

      expect(result).toEqual(['recipe1', 'recipe2']);
      expect(collectionServiceMock.list).not.toHaveBeenCalled();
    });

    test('should handle CollectionService errors gracefully', async () => {
      collectionServiceMock.list.mockRejectedValue(new Error('Firestore error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await favoritesService.getUserFavorites();

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('addFavorite', () => {
    test('creates a collection entry with source saved, state to-try, and a card', async () => {
      collectionServiceMock.list.mockResolvedValue([]);
      recipeServiceMock.get.mockResolvedValue({
        name: 'Soup',
        category: 'Mains',
        prepTime: 30,
        images: [{ full: 'img/recipes/full/mains/r2/photo.jpg', isPrimary: true }],
      });
      getPrimaryImageMock.mockReturnValue({
        full: 'img/recipes/full/mains/r2/photo.jpg',
        isPrimary: true,
      });
      collectionServiceMock.create.mockResolvedValue({ id: 'recipe2', source: 'saved' });

      // Populate the cache first (isLoaded stays false after a bare
      // optimistic update, so an uncached addFavorite would otherwise be
      // clobbered by the next full fetch below — see updateCache()).
      await favoritesService.getUserFavorites();

      await favoritesService.addFavorite('recipe2');

      expect(recipeServiceMock.get).toHaveBeenCalledWith('recipe2');
      expect(collectionServiceMock.create).toHaveBeenCalledWith(mockUser.uid, 'recipe2', {
        source: 'saved',
        state: 'to-try',
        card: {
          name: 'Soup',
          category: 'Mains',
          prepTime: 30,
          primaryImage: 'img/recipes/full/mains/r2/photo.jpg',
        },
      });

      // Check cache update
      const result = await favoritesService.getUserFavorites();
      expect(result).toContain('recipe2');
    });

    test('tolerates a failed recipe fetch and creates without a card', async () => {
      collectionServiceMock.list.mockResolvedValue([]);
      recipeServiceMock.get.mockRejectedValue(new Error('offline'));
      collectionServiceMock.create.mockResolvedValue({ id: 'recipe2', source: 'saved' });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await favoritesService.addFavorite('recipe2');

      expect(collectionServiceMock.create).toHaveBeenCalledWith(mockUser.uid, 'recipe2', {
        source: 'saved',
        state: 'to-try',
      });
      warnSpy.mockRestore();
    });

    test('double-add is a passthrough to create-only semantics and does not clobber the cache', async () => {
      collectionServiceMock.list.mockResolvedValue([{ id: 'recipe1' }]);
      recipeServiceMock.get.mockResolvedValue({ name: 'Soup', category: 'Mains', prepTime: 30 });
      getPrimaryImageMock.mockReturnValue(undefined);
      collectionServiceMock.create.mockResolvedValue({
        id: 'recipe1',
        source: 'saved',
        state: 'rotation',
        notes: 'keep me',
      });

      await favoritesService.getUserFavorites();
      await favoritesService.addFavorite('recipe1');

      expect(collectionServiceMock.create).toHaveBeenCalledTimes(1);
      const result = await favoritesService.getUserFavorites();
      expect(result).toEqual(['recipe1']);
    });

    test('should revert cache update if CollectionService.create fails', async () => {
      collectionServiceMock.list.mockResolvedValue([{ id: 'recipe1' }]);
      recipeServiceMock.get.mockResolvedValue({ name: 'Soup' });
      getPrimaryImageMock.mockReturnValue(undefined);
      collectionServiceMock.create.mockRejectedValue(new Error('Create failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await favoritesService.getUserFavorites();

      await expect(favoritesService.addFavorite('recipe2')).rejects.toThrow('Create failed');

      const result = await favoritesService.getUserFavorites();
      expect(result).not.toContain('recipe2');
      expect(result).toEqual(['recipe1']);

      consoleSpy.mockRestore();
    });
  });

  describe('removeFavorite', () => {
    test('should delete the collection entry and update cache', async () => {
      collectionServiceMock.list.mockResolvedValue([{ id: 'recipe1' }, { id: 'recipe2' }]);
      collectionServiceMock.delete.mockResolvedValue();

      await favoritesService.getUserFavorites();
      await favoritesService.removeFavorite('recipe1');

      expect(collectionServiceMock.delete).toHaveBeenCalledWith(mockUser.uid, 'recipe1');

      const result = await favoritesService.getUserFavorites();
      expect(result).not.toContain('recipe1');
      expect(result).toContain('recipe2');
    });

    test('should revert cache update if CollectionService.delete fails', async () => {
      collectionServiceMock.list.mockResolvedValue([{ id: 'recipe1' }, { id: 'recipe2' }]);
      collectionServiceMock.delete.mockRejectedValue(new Error('Delete failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await favoritesService.getUserFavorites();

      await expect(favoritesService.removeFavorite('recipe1')).rejects.toThrow('Delete failed');

      const result = await favoritesService.getUserFavorites();
      expect(result).toContain('recipe1');
      expect(result).toHaveLength(2);

      consoleSpy.mockRestore();
    });
  });

  describe('isFavorite', () => {
    test('returns true when the recipe ID is in the collection, regardless of state', async () => {
      collectionServiceMock.list.mockResolvedValue([{ id: 'recipe1', state: 'rotation' }]);

      await expect(favoritesService.isFavorite('recipe1')).resolves.toBe(true);
      await expect(favoritesService.isFavorite('recipe2')).resolves.toBe(false);
    });
  });

  describe('updateCache', () => {
    test('should update cache manually', async () => {
      collectionServiceMock.list.mockResolvedValue([{ id: 'recipe1' }]);
      await favoritesService.getUserFavorites();

      favoritesService.updateCache('recipe2', true);

      const result = await favoritesService.getUserFavorites();
      expect(result).toContain('recipe2');
    });
  });
});
