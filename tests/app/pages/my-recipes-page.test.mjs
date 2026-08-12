import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

let myRecipesPage;
let authServiceMock;
let collectionServiceMock;
let recipeServiceMock;

const mockUser = { uid: 'user-1' };

const TEMPLATE_HTML = fs.readFileSync(
  path.join(process.cwd(), 'src/app/pages/my-recipes-page.html'),
  'utf-8',
);

function buildContainer() {
  const container = document.createElement('main');
  container.innerHTML = TEMPLATE_HTML;
  document.body.appendChild(container);
  return container;
}

function entry(id, state, overrides = {}) {
  return {
    id,
    source: 'saved',
    state,
    card: { name: `Recipe ${id}`, category: 'main-courses', prepTime: 20 },
    ...overrides,
  };
}

beforeEach(async () => {
  jest.resetModules();
  document.body.innerHTML = '';

  authServiceMock = {
    waitForAuth: jest.fn().mockResolvedValue(mockUser),
    onAuthStateChanged: jest.fn(() => jest.fn()),
  };
  collectionServiceMock = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
  };
  recipeServiceMock = {
    list: jest.fn().mockResolvedValue([]),
  };

  jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
    default: authServiceMock,
  }));
  jest.unstable_mockModule('src/js/services/users/collection-service.js', () => ({
    CollectionService: collectionServiceMock,
  }));
  jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
    RecipeService: recipeServiceMock,
  }));
  jest.unstable_mockModule(
    'src/lib/collections/recipe-grid/recipe-presentation-grid.js',
    () => ({}),
  );
  jest.unstable_mockModule('src/lib/modals/message-modal/message-modal.js', () => ({}));
  // The real component drags in recipe_form_component (image handler, media
  // editor, import modal, firebase...) — stub a minimal custom element with
  // just the surface my-recipes-page.js calls, mirroring the "the orchestrator
  // only needs the element to exist" pattern used for other heavy components.
  jest.unstable_mockModule('src/lib/recipes/recipe_form_component/private_recipe_modal.js', () => {
    if (!customElements.get('private-recipe-modal')) {
      class FakePrivateRecipeModal extends HTMLElement {
        openModal() {
          this.openModalCalled = (this.openModalCalled || 0) + 1;
        }
      }
      customElements.define('private-recipe-modal', FakePrivateRecipeModal);
    }
    return {};
  });
  jest.unstable_mockModule('src/js/config/app-config.js', () => ({
    AppConfig: {
      getPageTitle: (title) => title,
    },
  }));

  window.spa = { router: { navigate: jest.fn() } };

  ({ default: myRecipesPage } = await import('src/app/pages/my-recipes-page.js'));
});

describe('my-recipes-page: auth guard', () => {
  test('redirects to home when no user is signed in, without loading data', async () => {
    authServiceMock.waitForAuth.mockResolvedValue(null);
    const container = buildContainer();

    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    expect(window.spa.router.navigate).toHaveBeenCalledWith('/');
    expect(collectionServiceMock.list).not.toHaveBeenCalled();
  });

  test('does not redirect when a user is signed in', async () => {
    const container = buildContainer();

    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    expect(window.spa.router.navigate).not.toHaveBeenCalled();
  });
});

describe('my-recipes-page: rail state switching', () => {
  test('loads both lifecycle states with the right CollectionService filters', async () => {
    collectionServiceMock.list.mockImplementation((uid, filters) => {
      if (filters?.state === 'rotation') return Promise.resolve([entry('r1', 'rotation')]);
      if (filters?.state === 'to-try') return Promise.resolve([entry('t1', 'to-try')]);
      return Promise.resolve([]);
    });
    const container = buildContainer();

    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    expect(collectionServiceMock.list).toHaveBeenCalledWith('user-1', { state: 'rotation' });
    expect(collectionServiceMock.list).toHaveBeenCalledWith('user-1', { state: 'to-try' });
  });

  test('clicking a rail entry switches the active state and updates aria-current', async () => {
    collectionServiceMock.list.mockImplementation((uid, filters) => {
      if (filters?.state === 'rotation') return Promise.resolve([entry('r1', 'rotation')]);
      if (filters?.state === 'to-try') return Promise.resolve([entry('t1', 'to-try')]);
      return Promise.resolve([]);
    });
    const container = buildContainer();
    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    const rotationBtn = container.querySelector('.rail__item[data-state="rotation"]');
    const toTryBtn = container.querySelector('.rail__item[data-state="to-try"]');
    expect(rotationBtn.getAttribute('aria-current')).toBe('true');
    expect(toTryBtn.getAttribute('aria-current')).toBe('false');

    toTryBtn.click();

    expect(toTryBtn.getAttribute('aria-current')).toBe('true');
    expect(rotationBtn.getAttribute('aria-current')).toBe('false');
  });

  test('rail counts reflect both buckets regardless of the active entry', async () => {
    collectionServiceMock.list.mockImplementation((uid, filters) => {
      if (filters?.state === 'rotation') {
        return Promise.resolve([entry('r1', 'rotation'), entry('r2', 'rotation')]);
      }
      if (filters?.state === 'to-try') return Promise.resolve([entry('t1', 'to-try')]);
      return Promise.resolve([]);
    });
    const container = buildContainer();

    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    expect(container.querySelector('#rail-count-rotation').textContent).toBe('2');
    expect(container.querySelector('#rail-count-to-try').textContent).toBe('1');
  });
});

describe('my-recipes-page: empty-state selection', () => {
  test('an entirely empty collection always shows the whole-book empty state', () => {
    expect(myRecipesPage.determineEmptyState({ rotation: 0, 'to-try': 0 }, 'rotation')).toBe(
      'whole-book',
    );
    expect(myRecipesPage.determineEmptyState({ rotation: 0, 'to-try': 0 }, 'to-try')).toBe(
      'whole-book',
    );
  });

  test('an empty kitchen with items still to try shows the kitchen-empty state', () => {
    expect(myRecipesPage.determineEmptyState({ rotation: 0, 'to-try': 7 }, 'rotation')).toBe(
      'kitchen-empty',
    );
  });

  test('an empty to-try list with a non-empty kitchen shows the to-try-empty state', () => {
    expect(myRecipesPage.determineEmptyState({ rotation: 24, 'to-try': 0 }, 'to-try')).toBe(
      'to-try-empty',
    );
  });

  test('returns null (render the grid) when the active bucket has items', () => {
    expect(myRecipesPage.determineEmptyState({ rotation: 24, 'to-try': 7 }, 'rotation')).toBeNull();
  });
});

describe('my-recipes-page: add-recipe flow', () => {
  test('the header add button lazily loads and opens the private-authoring modal', async () => {
    const container = buildContainer();
    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    const addBtn = container.querySelector('#add-recipe-btn');
    addBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const modal = document.querySelector('private-recipe-modal');
    expect(modal).not.toBeNull();
    expect(modal.openModalCalled).toBe(1);
  });

  test('re-clicking add reuses the same modal instance instead of creating another', async () => {
    const container = buildContainer();
    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    const addBtn = container.querySelector('#add-recipe-btn');
    addBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    addBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll('private-recipe-modal').length).toBe(1);
    expect(document.querySelector('private-recipe-modal').openModalCalled).toBe(2);
  });

  test('a recipe-added event from the modal refreshes the collection and re-renders', async () => {
    collectionServiceMock.list.mockImplementation((uid, filters) => {
      if (filters?.state === 'to-try') return Promise.resolve([entry('t1', 'to-try')]);
      return Promise.resolve([]);
    });
    const container = buildContainer();
    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    const addBtn = container.querySelector('#add-recipe-btn');
    addBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    collectionServiceMock.list.mockClear();
    collectionServiceMock.list.mockImplementation((uid, filters) => {
      if (filters?.state === 'to-try') {
        return Promise.resolve([entry('t1', 'to-try'), entry('new-1', 'to-try')]);
      }
      return Promise.resolve([]);
    });

    const modal = document.querySelector('private-recipe-modal');
    modal.dispatchEvent(new CustomEvent('recipe-added', { detail: { recipeId: 'new-1' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(collectionServiceMock.list).toHaveBeenCalled();
    expect(container.querySelector('#rail-count-to-try').textContent).toBe('2');
  });
});

describe('my-recipes-page: orphan self-heal', () => {
  test('writes a collection entry for an owned recipe missing one', async () => {
    recipeServiceMock.list.mockResolvedValue([
      { id: 'owned-1', userId: 'user-1', name: 'Grandma soup', category: 'soups-stews' },
    ]);
    collectionServiceMock.create.mockResolvedValue({
      id: 'owned-1',
      source: 'owned',
      state: 'to-try',
      addedAt: 'ts',
    });
    const container = buildContainer();

    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    expect(recipeServiceMock.list).toHaveBeenCalledWith({ where: [['userId', '==', 'user-1']] });
    expect(collectionServiceMock.create).toHaveBeenCalledWith(
      'user-1',
      'owned-1',
      expect.objectContaining({ source: 'owned', state: 'to-try' }),
    );
    expect(container.querySelector('#rail-count-to-try').textContent).toBe('1');
  });

  test('does not repair a recipe that already has a collection entry', async () => {
    collectionServiceMock.list.mockImplementation((uid, filters) => {
      if (filters?.state === 'to-try') return Promise.resolve([entry('owned-1', 'to-try')]);
      return Promise.resolve([]);
    });
    recipeServiceMock.list.mockResolvedValue([
      { id: 'owned-1', userId: 'user-1', name: 'Grandma soup', category: 'soups-stews' },
    ]);
    const container = buildContainer();

    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    expect(collectionServiceMock.create).not.toHaveBeenCalled();
  });

  test('a self-heal failure does not blank the page — existing entries still render', async () => {
    collectionServiceMock.list.mockImplementation((uid, filters) => {
      if (filters?.state === 'rotation') return Promise.resolve([entry('r1', 'rotation')]);
      return Promise.resolve([]);
    });
    recipeServiceMock.list.mockRejectedValue(new Error('offline'));
    const container = buildContainer();

    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    expect(container.querySelector('#rail-count-rotation').textContent).toBe('1');
  });

  test('an owned recipe still renders even when persisting its entry fails', async () => {
    // The entry write is best-effort — an owned recipe must appear whether or
    // not the write lands (e.g. collection rules not yet deployed). Regression
    // guard: a rejected create must not drop the recipe from the view.
    recipeServiceMock.list.mockResolvedValue([
      { id: 'owned-1', userId: 'user-1', name: 'Grandma soup', category: 'soups-stews' },
    ]);
    collectionServiceMock.create.mockRejectedValue(new Error('permission-denied'));
    const container = buildContainer();

    await myRecipesPage.mount(container);
    await myRecipesPage.waitForReady();

    expect(collectionServiceMock.create).toHaveBeenCalled();
    expect(container.querySelector('#rail-count-to-try').textContent).toBe('1');
  });
});
