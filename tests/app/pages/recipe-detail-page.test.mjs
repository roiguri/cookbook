import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

let recipeDetailPage;

const TEMPLATE_HTML = fs.readFileSync(
  path.join(process.cwd(), 'src/app/pages/recipe-detail-page.html'),
  'utf-8',
);

function buildContainer() {
  const container = document.createElement('main');
  container.innerHTML = TEMPLATE_HTML;
  document.body.appendChild(container);
  return container;
}

beforeEach(async () => {
  jest.resetModules();
  document.body.innerHTML = '';

  // Stand-in for the real recipe_component: tests drive the
  // 'recipe-data-loaded' detail directly instead of pulling in the real
  // component's RecipeService/auth/Firestore-shaped internals — this file
  // only needs to verify what recipe-detail-page.js does with that event.
  jest.unstable_mockModule('src/lib/recipes/recipe_component/recipe_component.js', () => {
    class MockRecipeComponent extends HTMLElement {}
    if (!customElements.get('recipe-component')) {
      customElements.define('recipe-component', MockRecipeComponent);
    }
    return {};
  });

  jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
    default: {
      getCurrentUser: jest.fn(() => null),
    },
  }));
  jest.unstable_mockModule('src/js/services/meals/active-meal-service.js', () => ({
    ActiveMealService: { addToMeal: jest.fn() },
  }));
  jest.unstable_mockModule('src/js/config/app-config.js', () => ({
    AppConfig: { getPageTitle: (title) => title },
  }));
  jest.unstable_mockModule('src/lib/utilities/modal/modal.js', () => ({}));
  jest.unstable_mockModule('src/lib/utilities/loading-spinner/loading-spinner.js', () => ({}));
  jest.unstable_mockModule('src/lib/media/image-handler/image-handler.js', () => ({}));
  jest.unstable_mockModule(
    'src/lib/media/image-proposal-modal/image-proposal-modal.js',
    () => ({}),
  );
  jest.unstable_mockModule('src/lib/recipes/suggest_edit_modal/suggest-edit-modal.js', () => ({}));
  jest.unstable_mockModule('src/lib/modals/message-modal/message-modal.js', () => ({}));

  window.spa = { router: { navigate: jest.fn() } };

  ({ default: recipeDetailPage } = await import('src/app/pages/recipe-detail-page.js'));
});

afterEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

// Mounts the page, then simulates the recipe-component reporting a load
// outcome via the same 'recipe-data-loaded' event recipe_component.js
// dispatches in production, and waits for waitForReady to react to it.
async function mountAndFire(detail) {
  const container = buildContainer();
  await recipeDetailPage.mount(container, { id: 'recipe-1' });

  const recipeComponent = container.querySelector('recipe-component');
  const readyPromise = recipeDetailPage.waitForReady(container);
  recipeComponent.dispatchEvent(new CustomEvent('recipe-data-loaded', { detail }));
  await readyPromise;
  return container;
}

describe('recipe-detail-page: unavailable state', () => {
  test('renders the unavailable state when the recipe is missing', async () => {
    const container = await mountAndFire({ ok: false, reason: 'missing' });

    expect(container.querySelector('.recipe-detail-error')).not.toBeNull();
    expect(container.textContent).toContain('המתכון אינו זמין');
    expect(container.querySelector('recipe-component')).toBeNull();
  });

  test('renders the unavailable state when the fetch throws (permission-denied)', async () => {
    const container = await mountAndFire({ ok: false, reason: 'error' });

    expect(container.querySelector('.recipe-detail-error')).not.toBeNull();
    expect(container.textContent).toContain('המתכון אינו זמין');
  });

  test('a successful load leaves the recipe component in place, no unavailable state', async () => {
    const container = await mountAndFire({ ok: true });

    expect(container.querySelector('.recipe-detail-error')).toBeNull();
    expect(container.querySelector('recipe-component')).not.toBeNull();
  });

  test('the message never distinguishes missing from unreadable — same copy either way', async () => {
    const missingContainer = await mountAndFire({ ok: false, reason: 'missing' });
    document.body.innerHTML = '';
    const errorContainer = await mountAndFire({ ok: false, reason: 'error' });

    expect(missingContainer.querySelector('.recipe-detail-error').textContent).toBe(
      errorContainer.querySelector('.recipe-detail-error').textContent,
    );
  });

  test('"back to all recipes" navigates to /categories', async () => {
    const container = await mountAndFire({ ok: false, reason: 'missing' });

    container.querySelector('#unavailable-categories-btn').click();

    expect(window.spa.router.navigate).toHaveBeenCalledWith('/categories');
  });

  test('"home" navigates to /home', async () => {
    const container = await mountAndFire({ ok: false, reason: 'missing' });

    container.querySelector('#unavailable-home-btn').click();

    expect(window.spa.router.navigate).toHaveBeenCalledWith('/home');
  });
});
