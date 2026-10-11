import { jest } from '@jest/globals';

const authMocks = {
  getCurrentUser: jest.fn(() => null),
  addAuthObserver: jest.fn(() => jest.fn()),
};
const favoritesMocks = {
  getUserFavorites: jest.fn(async () => []),
  updateCache: jest.fn(),
  clearCache: jest.fn(),
};

jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({ default: authMocks }));
jest.unstable_mockModule('src/js/services/users/favorites-service.js', () => ({
  default: favoritesMocks,
}));

let RecipeListController;

const recipes = [
  { id: 'a', name: 'עוגת שוקולד', category: 'desserts' },
  { id: 'b', name: 'מרק עדשים', category: 'soups-stews' },
  { id: 'c', name: 'עוגת תפוזים', category: 'desserts' },
];

function fakeGrid() {
  const grid = document.createElement('div');
  grid.id = 'recipe-presentation-grid';
  grid.waitForReady = jest.fn(async () => true);
  grid.showLoading = jest.fn();
  grid.setRecipes = jest.fn();
  return grid;
}

function fakeFilter() {
  const filter = document.createElement('div');
  filter.id = 'unified-filter';
  filter.setState = jest.fn();
  filter.setBaseRecipes = jest.fn();
  filter.setSearchQuery = jest.fn();
  return filter;
}

let grid;
let filter;

beforeEach(async () => {
  jest.resetModules();
  Object.values(authMocks).forEach((m) => m.mockClear());
  Object.values(favoritesMocks).forEach((m) => m.mockClear());
  authMocks.getCurrentUser.mockReturnValue(null);
  document.body.innerHTML = '';
  grid = fakeGrid();
  filter = fakeFilter();
  document.body.append(grid, filter);
  ({ RecipeListController } =
    await import('src/lib/collections/recipe-list/recipe-list-controller.js'));
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RecipeListController', () => {
  it('requires a data source', () => {
    expect(() => new RecipeListController({})).toThrow('loadRecipes is required');
  });

  it('loads from the data source with the current category and shows the result', async () => {
    const loadRecipes = jest.fn(async () => recipes);
    const list = new RecipeListController({ loadRecipes });
    list.init({ category: 'desserts' });
    await list.start();
    await flush();

    expect(loadRecipes).toHaveBeenCalledWith({ category: 'desserts' });
    expect(grid.setRecipes).toHaveBeenLastCalledWith(recipes, false);
    expect(grid.getAttribute('recipes-per-page')).toBe('8');
    expect(filter.setState).toHaveBeenCalledWith(
      expect.objectContaining({ currentCategory: 'desserts' }),
    );
  });

  it('applies the search query on top of the loaded recipes', async () => {
    const list = new RecipeListController({ loadRecipes: async () => recipes });
    list.init({ searchQuery: 'עוגת' });
    await list.start();
    await flush();

    const shown = grid.setRecipes.mock.calls.at(-1)[0].map((r) => r.id);
    expect(shown).toEqual(['a', 'c']);
  });

  it('reloads and reports URL + state changes when the category chip changes', async () => {
    const loadRecipes = jest.fn(async () => recipes);
    const onUrlChanged = jest.fn();
    const onStateChanged = jest.fn();
    const list = new RecipeListController({ loadRecipes, onUrlChanged, onStateChanged });
    list.init();
    await list.start();
    await flush();
    loadRecipes.mockClear();

    filter.dispatchEvent(
      new CustomEvent('unified-category-changed', { detail: { category: 'soups-stews' } }),
    );
    await flush();
    await flush();

    expect(loadRecipes).toHaveBeenCalledWith({ category: 'soups-stews' });
    expect(onUrlChanged).toHaveBeenCalledWith(
      expect.objectContaining({ currentCategory: 'soups-stews' }),
    );
    expect(onStateChanged).toHaveBeenCalled();
  });

  it('applyState reloads only when something changed', async () => {
    const loadRecipes = jest.fn(async () => recipes);
    const list = new RecipeListController({ loadRecipes });
    list.init({ category: 'desserts' });
    await list.start();
    await flush();
    loadRecipes.mockClear();

    await list.applyState({ category: 'desserts' });
    expect(loadRecipes).not.toHaveBeenCalled();

    await list.applyState({ category: 'desserts', searchQuery: 'מרק' });
    expect(loadRecipes).toHaveBeenCalledTimes(1);
    expect(filter.setSearchQuery).toHaveBeenCalledWith('מרק');
  });

  it('the favourites view needs a signed-in user', async () => {
    const list = new RecipeListController({ loadRecipes: async () => recipes });
    list.init();
    await list.start();
    await flush();

    await list.setFilterState({ favoritesOnly: true });
    expect(list.activeFilters.favoritesOnly).toBe(false);

    authMocks.getCurrentUser.mockReturnValue({ uid: 'u1' });
    favoritesMocks.getUserFavorites.mockResolvedValue(['b']);
    await list.setFilterState({ favoritesOnly: true });
    expect(list.activeFilters.favoritesOnly).toBe(true);
    expect(grid.setRecipes.mock.calls.at(-1)[0].map((r) => r.id)).toEqual(['b']);
  });

  it('stop() removes its listeners', async () => {
    const unsubscribe = jest.fn();
    authMocks.addAuthObserver.mockReturnValue(unsubscribe);
    const list = new RecipeListController({ loadRecipes: async () => recipes });
    list.init();
    await list.start();
    const handler = list._boundFavoriteChanged;
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    list.stop();

    expect(unsubscribe).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('recipe-favorite-changed', handler);
    removeSpy.mockRestore();
  });

  it('shows the error in the grid when loading fails', async () => {
    const list = new RecipeListController({
      loadRecipes: async () => {
        throw new Error('boom');
      },
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    list.init();
    await list.loadInitialRecipes();
    expect(grid.innerHTML).toContain('error-message');
  });
});
