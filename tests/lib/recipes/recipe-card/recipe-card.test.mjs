import { jest } from '@jest/globals';

// Mock global fetch for template loading
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    text: () =>
      Promise.resolve(`
      <template id="recipe-card-template">
        <div class="recipe-card">
          <img class="recipe-image" />
          <div class="recipe-content">
             <a class="recipe-link"></a>
             <div class="recipe-details"></div>
          </div>
        </div>
      </template>
      <template id="loading-template"><div class="loading">Loading...</div></template>
      <template id="error-template"><div class="error-state">Error</div></template>
      <template id="no-image-card-template">
        <div class="recipe-card">
           <div class="no-image-placeholder recipe-image"></div>
           <div class="recipe-content">
             <a class="recipe-link"></a>
           </div>
        </div>
      </template>
    `),
  }),
);

// Define Mocks
const mockRecipeData = {
  id: 'recipe-123',
  name: 'Test Recipe',
  category: 'main-courses',
  prepTime: 10,
  waitTime: 20,
  difficulty: 'קלה',
  images: [{ id: 'img1', isPrimary: true }],
};

const mockUser = {
  uid: 'user-123',
  favorites: ['recipe-123'],
};

// Mock Dependencies
jest.unstable_mockModule('src/js/services/users/favorites-service.js', () => ({
  default: {
    getUserFavorites: jest.fn(() => Promise.resolve(['recipe-123'])),
    addFavorite: jest.fn(() => Promise.resolve()),
    removeFavorite: jest.fn(() => Promise.resolve()),
  },
}));

jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
  default: {
    getCurrentUser: jest.fn(() => mockUser),
  },
}));

jest.unstable_mockModule('src/js/services/meals/active-meal-service.js', () => ({
  ActiveMealService: {
    addToMeal: jest.fn(() => Promise.resolve({ success: true })),
  },
}));

jest.unstable_mockModule('src/js/utils/recipes/recipe-data-utils.js', () => ({
  getRecipeById: jest.fn(() => Promise.resolve(mockRecipeData)),
  getLocalizedCategoryName: jest.fn((cat) => cat),
  formatCookingTime: jest.fn((time) => `${time} mins`),
  getTimeClass: jest.fn(() => 'quick'),
  getDifficultyClass: jest.fn(() => 'easy'),
}));

jest.unstable_mockModule('src/js/utils/recipes/recipe-image-utils.js', () => ({
  getPlaceholderImageUrl: jest.fn(() => Promise.resolve('http://example.com/placeholder.jpg')),
}));

jest.unstable_mockModule('src/js/services/recipes/recipe-image-service.js', () => ({
  RecipeImageService: {
    getPrimaryUrl: jest.fn(() => Promise.resolve('http://example.com/img.jpg')),
  },
}));

jest.unstable_mockModule('src/js/utils/lazy-loading.js', () => ({
  initLazyLoading: jest.fn(),
  lazyImageLoader: {
    observe: jest.fn(),
    unobserve: jest.fn(),
  },
}));

// Import Component under test (Dynamic import after mocks)
let RecipeCard;
beforeAll(async () => {
  // Import the module which defines the custom element
  await import('src/lib/recipes/recipe-card/recipe-card.js');
  RecipeCard = customElements.get('recipe-card');
});

describe('RecipeCard Component', () => {
  let element;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    element = document.createElement('recipe-card');
    document.body.appendChild(element);
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('initializes correctly', () => {
    expect(element).toBeDefined();
    expect(element.shadowRoot).toBeDefined();
  });

  it('renders loading state initially', () => {
    // Since default is loading=true
    const loadingEl = element.shadowRoot.querySelector('.loading');
    expect(loadingEl).toBeTruthy();
  });

  it('fetches data and renders content when recipe-id is set', async () => {
    element.setAttribute('recipe-id', 'recipe-123');

    // Wait for async operations (fetch recipe, fetch image, render)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Manually trigger render to ensure DOM updates in test environment
    // (JSDOM/Jest async timing can sometimes miss the final render call from async fetch)
    element._render();

    const recipeTitle = element.shadowRoot.querySelector('.recipe-link');
    expect(recipeTitle).toBeTruthy();
    expect(recipeTitle.textContent).toBe('Test Recipe');

    const recipeImage = element.shadowRoot.querySelector('.recipe-image');
    expect(recipeImage.getAttribute('data-src')).toBe('http://example.com/img.jpg');
  });
});
