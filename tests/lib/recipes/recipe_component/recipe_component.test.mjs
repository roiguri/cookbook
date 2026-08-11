import { jest } from '@jest/globals';

// Spy captured by the mocked <recipe-strip> so tests can assert what
// populateRelatedRecipes hands it, without pulling in the real
// recipe-strip -> recipe-card dependency chain (favorites, active-meal, etc).
const setRecipesSpy = jest.fn();

jest.unstable_mockModule('src/lib/recipes/recipe_strip/recipe_strip.js', () => {
  class MockRecipeStrip extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }
    setRecipes(items) {
      setRecipesSpy(items);
    }
  }
  if (!customElements.get('recipe-strip')) {
    customElements.define('recipe-strip', MockRecipeStrip);
  }
  return {};
});

jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
  default: {
    getCurrentUser: jest.fn(() => null),
    getCurrentUserRole: jest.fn(() => Promise.resolve('user')),
    isAuthenticated: jest.fn(() => false),
    isManager: jest.fn(() => false),
  },
}));

jest.unstable_mockModule('src/js/config/app-config.js', () => ({
  AppConfig: {
    title: 'Test Kitchen',
    name: 'Test Kitchen',
    iconPath: 'prod',
    manifestFile: 'site.webmanifest.json',
    getPageTitle: (title = '') => title,
  },
}));

const mockRecipeGet = jest.fn();
const mockRecipeUpdate = jest.fn(() => Promise.resolve());
jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: {
    get: mockRecipeGet,
    update: mockRecipeUpdate,
  },
}));

jest.unstable_mockModule('src/js/utils/recipes/recipe-data-utils.js', () => ({
  formatRecipeData: jest.fn((doc) => doc),
  getLocalizedCategoryName: jest.fn((cat) => cat),
  formatCookingTime: jest.fn((time) => `${time} mins`),
}));

jest.unstable_mockModule('src/js/utils/recipes/recipe-image-utils.js', () => ({
  getRecipeImages: jest.fn(() => []),
}));

jest.unstable_mockModule('src/js/services/recipes/recipe-image-service.js', () => ({
  RecipeImageService: {
    getPrimaryUrl: jest.fn(() => Promise.resolve('http://example.com/img.jpg')),
  },
}));

jest.unstable_mockModule('src/js/utils/recipes/recipe-ingredients-utils.js', () => ({
  formatIngredientAmount: jest.fn((amount) => String(amount)),
  scaleIngredients: jest.fn((ingredients) => ingredients),
}));

jest.unstable_mockModule('src/js/services/recipes/media-instruction-service.js', () => ({
  MediaInstructionService: {},
}));

// Import Component under test (dynamic import after mocks)
let RecipeComponent;
beforeAll(async () => {
  await import('src/lib/recipes/recipe_component/recipe_component.js');
  RecipeComponent = customElements.get('recipe-component');
});

describe('RecipeComponent — related recipes', () => {
  let element;

  beforeEach(() => {
    document.body.innerHTML = '';
    element = document.createElement('recipe-component');
    document.body.appendChild(element);
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('initializes correctly', () => {
    expect(element).toBeInstanceOf(RecipeComponent);
    expect(element.shadowRoot).toBeDefined();
  });

  it('skips a related recipe whose fetch fails and still renders the rest', async () => {
    mockRecipeGet.mockImplementation((id) => {
      if (id === 'bad-id') {
        return Promise.reject(new Error('permission-denied'));
      }
      return Promise.resolve({ id, approved: true, name: `Recipe ${id}` });
    });

    const recipe = {
      id: 'main-recipe',
      relatedRecipes: ['good-id-1', 'bad-id', 'good-id-2'],
    };

    await element.populateRelatedRecipes(recipe);

    expect(setRecipesSpy).toHaveBeenCalledTimes(1);
    const populated = setRecipesSpy.mock.calls[0][0];
    expect(populated.map((r) => r.id)).toEqual(['good-id-1', 'good-id-2']);

    const section = element.shadowRoot.getElementById('Recipe_component__related');
    expect(section.style.display).toBe('');
  });

  it('hides the related section when every related fetch fails', async () => {
    mockRecipeGet.mockImplementation(() => Promise.reject(new Error('permission-denied')));

    const recipe = {
      id: 'main-recipe',
      relatedRecipes: ['bad-id-1', 'bad-id-2'],
    };

    await element.populateRelatedRecipes(recipe);

    expect(setRecipesSpy).not.toHaveBeenCalled();
    const section = element.shadowRoot.getElementById('Recipe_component__related');
    expect(section.style.display).toBe('none');
  });
});
