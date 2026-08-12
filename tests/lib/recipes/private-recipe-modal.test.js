import { jest } from '@jest/globals';

// Holder so tests can control what authService.getCurrentUser() / isApproved() return.
const authHolder = {
  currentUser: { uid: 'tester' },
  isApproved: false,
};

const createMock = jest.fn(async () => ({
  recipeId: 'new-recipe-1',
  mediaUploadResults: { successCount: 0, failedCount: 0 },
}));
const getMock = jest.fn(async () => ({
  id: 'new-recipe-1',
  name: 'מרק עוף',
  category: 'soups-stews',
  prepTime: 30,
  images: [],
}));
const collectionCreateMock = jest.fn(async (uid, recipeId, entry) => ({ id: recipeId, ...entry }));
const addAuthObserverMock = jest.fn();
const removeAuthObserverMock = jest.fn();

jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: {
    create: createMock,
    get: getMock,
    list: jest.fn(async () => []),
  },
}));
jest.unstable_mockModule('src/js/services/users/collection-service.js', () => ({
  CollectionService: {
    create: collectionCreateMock,
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
    addAuthObserver: addAuthObserverMock,
    removeAuthObserver: removeAuthObserverMock,
    getCurrentUser: jest.fn(() => authHolder.currentUser),
    isApproved: jest.fn(() => authHolder.isApproved),
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
  await import('src/lib/recipes/recipe_form_component/private_recipe_modal.js');
});

async function mount() {
  document.body.innerHTML = '<private-recipe-modal></private-recipe-modal>';
  const el = document.querySelector('private-recipe-modal');
  await Promise.resolve();
  await Promise.resolve();
  return el;
}

const RAW_RECIPE_DATA = {
  name: 'מרק עוף',
  category: 'soups-stews',
  prepTime: 30,
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

describe('private-recipe-modal — submit payload', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    authHolder.currentUser = { uid: 'tester' };
    authHolder.isApproved = false;
    createMock.mockClear();
    getMock.mockClear();
    collectionCreateMock.mockClear();
    showToastMock.mockClear();
  });

  test('writes visibility: "private" alongside approved: false, userId from the auth uid', async () => {
    const el = await mount();
    dispatchRecipeData(el);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createMock).toHaveBeenCalledTimes(1);
    const { recipeData } = createMock.mock.calls[0][0];
    expect(recipeData).toMatchObject({
      userId: 'tester',
      approved: false,
      visibility: 'private',
    });
  });

  test('writes an owned collection entry at to-try, built from the created recipe', async () => {
    const el = await mount();
    dispatchRecipeData(el);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getMock).toHaveBeenCalledWith('new-recipe-1');
    expect(collectionCreateMock).toHaveBeenCalledWith('tester', 'new-recipe-1', {
      source: 'owned',
      state: 'to-try',
      card: { name: 'מרק עוף', category: 'soups-stews', prepTime: 30 },
    });
  });

  test('dispatches recipe-added with the new recipe id on success', async () => {
    const el = await mount();
    const handler = jest.fn();
    el.addEventListener('recipe-added', handler);

    dispatchRecipeData(el);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ recipeId: 'new-recipe-1' });
  });

  test('a failed collection-entry write is logged and swallowed — the recipe still saved', async () => {
    collectionCreateMock.mockRejectedValueOnce(new Error('offline'));
    const el = await mount();
    const handler = jest.fn();
    el.addEventListener('recipe-added', handler);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    dispatchRecipeData(el);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith('המתכון נוסף לאוסף שלך!', 'success');
    consoleSpy.mockRestore();
  });

  test('an unauthenticated submit does not call RecipeService.create and surfaces an error', async () => {
    authHolder.currentUser = null;
    const el = await mount();
    dispatchRecipeData(el);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createMock).not.toHaveBeenCalled();
    expect(collectionCreateMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(expect.any(String), 'error', expect.any(Number));
  });
});

describe('private-recipe-modal — modal open/close', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('openModal() opens the underlying custom-modal', async () => {
    const el = await mount();
    el.openModal();
    expect(el.shadowRoot.querySelector('custom-modal').isOpen).toBe(true);
  });
});

describe('private-recipe-modal — AI import gating', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    authHolder.isApproved = false;
    addAuthObserverMock.mockClear();
    removeAuthObserverMock.mockClear();
  });

  test('hides the AI import trigger for a plain user', async () => {
    authHolder.isApproved = false;
    const el = await mount();

    const importBtn = el.shadowRoot.getElementById('toolbar-import');
    expect(importBtn.hidden).toBe(true);
  });

  test('shows the AI import trigger for an approved/manager user', async () => {
    authHolder.isApproved = true;
    const el = await mount();

    const importBtn = el.shadowRoot.getElementById('toolbar-import');
    expect(importBtn.hidden).toBe(false);
  });

  test('clicking the import trigger delegates to the form component', async () => {
    authHolder.isApproved = true;
    const el = await mount();
    const openImportModalSpy = jest.fn();
    el.formComponent.openImportModal = openImportModalSpy;

    el.shadowRoot.getElementById('toolbar-import').click();

    expect(openImportModalSpy).toHaveBeenCalledTimes(1);
  });

  test('reacts to a later role change via the auth observer', async () => {
    authHolder.isApproved = false;
    const el = await mount();
    const importBtn = el.shadowRoot.getElementById('toolbar-import');
    expect(importBtn.hidden).toBe(true);

    // The nested recipe-form-component also registers its own (no-op)
    // auth observer, so the mock is shared — invoke this element's own
    // bound handler specifically rather than assuming registration order.
    expect(addAuthObserverMock).toHaveBeenCalledWith(el.handleAuthUpdate);
    el.handleAuthUpdate({ isApproved: true });

    expect(importBtn.hidden).toBe(false);
  });

  test('unregisters its own auth observer on disconnect', async () => {
    const el = await mount();
    const boundHandler = el.handleAuthUpdate;
    el.remove();

    expect(removeAuthObserverMock).toHaveBeenCalledWith(boundHandler);
  });
});
