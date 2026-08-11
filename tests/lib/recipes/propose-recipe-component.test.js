import { jest } from '@jest/globals';

// Holder so tests can control what authService.getCurrentUser() returns.
const currentUserHolder = { current: { uid: 'tester' } };

const createMock = jest.fn(async () => ({
  mediaUploadResults: { successCount: 0, failedCount: 0 },
}));

jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: {
    create: createMock,
    get: jest.fn(async () => null),
    list: jest.fn(async () => []),
  },
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-image-service.js', () => ({
  RecipeImageService: { getOptimizedUrl: jest.fn(async () => 'data:preview') },
}));
jest.unstable_mockModule('src/js/services/recipes/media-instruction-service.js', () => ({
  MediaInstructionService: { getUrl: jest.fn(async () => 'https://cdn/x'), delete: jest.fn() },
}));
jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
  default: {
    addAuthObserver: jest.fn(),
    removeAuthObserver: jest.fn(),
    getCurrentUser: jest.fn(() => currentUserHolder.current),
  },
}));
// The import modal drags in firebase/functions, cropperjs and the game wrapper —
// stub it out; the orchestrator only needs the element to exist.
jest.unstable_mockModule('src/lib/recipes/recipe_import_modal/recipe_import_modal.js', () => ({}));

const showToastMock = jest.fn();
jest.unstable_mockModule('src/lib/notifications/toast-notification/toast-notification.js', () => ({
  showToast: showToastMock,
}));

beforeAll(async () => {
  await import('src/lib/recipes/recipe_form_component/propose_recipe_component.js');
});

async function mount() {
  document.body.innerHTML = '<propose-recipe-component></propose-recipe-component>';
  const el = document.querySelector('propose-recipe-component');
  await Promise.resolve();
  await Promise.resolve();
  return el;
}

const RAW_RECIPE_DATA = {
  name: 'מתכון חדש',
  category: 'appetizers',
  description: 'תיאור',
  images: [],
  mediaInstructions: [],
  toDelete: [],
  mediaToDelete: [],
};

function dispatchRecipeData(el, recipeData = RAW_RECIPE_DATA) {
  const formComponent = el.shadowRoot.querySelector('recipe-form-component');
  formComponent.dispatchEvent(
    new CustomEvent('recipe-data-collected', {
      detail: { recipeData },
    }),
  );
}

describe('propose-recipe-component — submit payload', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    currentUserHolder.current = { uid: 'tester' };
  });

  test('writes visibility: "pending" alongside approved: false, userId from the auth uid', async () => {
    const el = await mount();
    dispatchRecipeData(el);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createMock).toHaveBeenCalledTimes(1);
    const { recipeData } = createMock.mock.calls[0][0];
    expect(recipeData).toMatchObject({
      userId: 'tester',
      approved: false,
      visibility: 'pending',
    });
  });

  test('an unauthenticated submit does not call RecipeService.create and surfaces a login error', async () => {
    currentUserHolder.current = null;
    const el = await mount();
    dispatchRecipeData(el);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining('התחבר'),
      'error',
      expect.any(Number),
    );
  });
});
