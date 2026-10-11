import { jest } from '@jest/globals';

const RECIPE = {
  id: 'r1',
  name: 'עוגה',
  category: 'desserts',
  servings: 1,
  prepTime: 10,
  waitTime: 0,
  difficulty: 'קלה',
  ingredients: [{ item: 'קמח', amount: 1, unit: 'כוס' }],
  instructions: ['לערבב'],
  images: [],
};

const recipeGet = jest.fn(async () => ({ ...RECIPE }));

// Mock Firebase-backed dependencies so the component mounts in jsdom.
jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: { get: recipeGet, list: jest.fn(async () => []) },
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-image-service.js', () => ({
  RecipeImageService: {
    getOptimizedUrl: jest.fn(async () => ''),
    getFullUrl: jest.fn(async () => ''),
  },
}));
jest.unstable_mockModule('src/js/services/recipes/media-instruction-service.js', () => ({
  MediaInstructionService: { getUrl: jest.fn(async () => '') },
}));
jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
  default: {
    addAuthObserver: jest.fn(),
    removeAuthObserver: jest.fn(),
    getCurrentUser: jest.fn(() => null),
    getUserData: jest.fn(() => null),
  },
}));

// app-config reads import.meta.env, which only Vite provides.
jest.unstable_mockModule('src/js/config/app-config.js', () => ({
  AppConfig: { getPageTitle: (t) => t },
}));
// The related-recipes strip pulls recipe-card → favorites/meal services → Firebase SDK.
jest.unstable_mockModule('src/lib/recipes/recipe_strip/recipe_strip.js', () => ({}));

beforeAll(async () => {
  await import('src/lib/recipes/recipe_component/recipe_component.js');
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function waitFor(cond, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor: condition not met in time');
}

describe('recipe-component servings stepper (#204)', () => {
  beforeEach(() => {
    recipeGet.mockClear();
    document.body.innerHTML = '';
  });

  test('upgrading an element that already has recipe-id fetches the recipe once', async () => {
    document.body.innerHTML = '<recipe-component recipe-id="r1"></recipe-component>';
    await flush();
    expect(recipeGet).toHaveBeenCalledTimes(1);
  });

  test('+ / − step by one even after setData() ran more than once', async () => {
    const el = document.createElement('recipe-component');
    document.body.appendChild(el);
    await el.setData({ ...RECIPE });
    await el.setData({ ...RECIPE });

    const input = el.shadowRoot.getElementById('Recipe_component__servings');
    const inc = el.shadowRoot.getElementById('Recipe_component__servings-inc');
    const dec = el.shadowRoot.getElementById('Recipe_component__servings-dec');
    await waitFor(() => input.value === '1');

    inc.click();
    expect(input.value).toBe('2');
    inc.click();
    expect(input.value).toBe('3');
    dec.click();
    expect(input.value).toBe('2');
  });

  test('changing recipe-id after connect still reloads the recipe', async () => {
    const el = document.createElement('recipe-component');
    el.setAttribute('recipe-id', 'r1');
    document.body.appendChild(el);
    await flush();
    el.setAttribute('recipe-id', 'r2');
    await flush();
    expect(recipeGet.mock.calls.map((c) => c[0])).toEqual(['r1', 'r2']);
  });
});
