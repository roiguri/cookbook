import { test, expect } from '@playwright/test';

test.describe('Recipe Card Visuals', () => {
  test('renders correctly', async ({ page }) => {
    page.on('console', (msg) => console.log(`BROWSER LOG: ${msg.text()}`));
    // Serve the test page directly from the test file
    await page.goto('/tests/visuals/components/recipe-card/index.html');

    // Check if customized element is defined
    const isDefined = await page.evaluate(() => !!customElements.get('recipe-card'));
    expect(isDefined).toBe(true);

    // Inject data directly into the component
    await page.evaluate(async () => {
      const card = document.querySelector('recipe-card');

      // Wait for templates to load (fix race condition)
      if (!card.constructor._templateCache) {
        let retries = 0;
        while (!card.constructor._templateCache && retries < 10) {
          await new Promise((r) => setTimeout(r, 100));
          retries++;
        }
      }

      // Verify usage of external templates (checks if static cache is populated)
      if (!card.constructor._templateCache) {
        throw new Error(
          'Test failed: RecipeCard is using inline templates fallback instead of external file',
        );
      }

      // Patch internal methods to prevent network calls and resolve dependencies
      card._fetchRecipeData = async () => {};
      card._fetchRecipeImage = async () => {
        // Simple red pixel
        card._imageUrl =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        return Promise.resolve();
      };

      // Patch _addToMeal and favorites too just in case
      card._fetchUserFavorites = async () => {
        card._userFavorites = new Set();
      };

      // Override default behaviors to force immediate rendering
      const originalRender = card._renderRecipe;
      card._renderRecipe = function () {
        originalRender.call(this);
        const img = this.shadowRoot.querySelector('.recipe-image');
        if (img && this._imageUrl) {
          img.src = this._imageUrl;
          img.classList.add('loaded');
        }
      };

      // Set attribute now that fetch is patched (needed for link generation)
      card.setAttribute('recipe-id', 'mock-recipe');

      // Ensure error is cleared if any (though shouldn't be now)
      card._error = null;

      // Now set the data
      card.recipeData = {
        id: 'mock-recipe',
        visibility: 'published', // family-book recipe: no status badge
        name: 'Succulent Visual Burger',
        category: 'main-courses',
        prepTime: 20,
        waitTime: 15,
        difficulty: 'medium',
        images: [{ id: 'img1', isPrimary: true }],
      };
    });

    const card = page.locator('recipe-card');

    // Wait for image to be visible/loaded
    await expect(card.locator('.recipe-image')).toBeVisible();
    await expect(card.locator('.recipe-title')).toHaveText('Succulent Visual Burger');

    // Verify buttons are hidden (default state)
    await expect(card.locator('.add-to-meal-btn')).toBeHidden();
    await expect(card.locator('.favorite-btn')).toBeHidden();

    // Take snapshot for default state
    await expect(card).toHaveScreenshot('recipe-card-default.png');
  });

  test('shows buttons when authenticated and enabled', async ({ page }) => {
    await page.goto('/tests/visuals/components/recipe-card/index.html');

    // Mock Authentication
    await page.evaluate(async () => {
      const authService = window.__authService;
      authService.getCurrentUser = () => ({ uid: 'test-user-123', email: 'test@example.com' });

      const favoritesService = window.__favoritesService;
      favoritesService.removeFavorite = async () => {};
      favoritesService.addFavorite = async () => {};
    });

    // Configure and render component
    await page.evaluate(async () => {
      const card = document.querySelector('recipe-card');

      // Mock Data Fetching BEFORE setting attributes that trigger it
      card._fetchRecipeData = async () => {};
      card._fetchRecipeImage = async () => {
        card._imageUrl =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      };
      // Explicitly set favorites and disable the fetch method so it doesn't overwrite
      card._userFavorites = new Set(['mock-recipe-auth']);
      card._fetchUserFavorites = async () => {};

      // Enable features
      card.setAttribute('show-favorites', 'true');
      card.setAttribute('show-add-to-meal', 'true');
      card.setAttribute('recipe-id', 'mock-recipe-auth');

      // Patch render to ensure image loads
      const originalRender = card._renderRecipe;
      card._renderRecipe = function () {
        originalRender.call(this);
        const img = this.shadowRoot.querySelector('.recipe-image');
        if (img && this._imageUrl) {
          img.src = this._imageUrl;
          img.classList.add('loaded');
        }
      };

      // Set Data (triggers render)
      card.recipeData = {
        id: 'mock-recipe-auth',
        visibility: 'published', // family-book recipe: no status badge
        name: 'Build Your Own Burger',
        category: 'main-courses',
        prepTime: 20,
        waitTime: 15,
        difficulty: 'medium',
        images: [{ id: 'img1', isPrimary: true }],
      };
    });

    const card = page.locator('recipe-card');

    // Verify Favorites Button is Visible and Active (since we mocked it as favorite)
    const favBtn = card.locator('.favorite-btn');
    await expect(favBtn).toBeVisible();
    await expect(favBtn).toHaveClass(/active/); // recipe-card.js toggles .active class

    // Verify Add to Meal Button is Visible
    const addBtn = card.locator('.add-to-meal-btn');
    await expect(addBtn).toBeVisible();

    // Take snapshot for authenticated state
    await expect(card).toHaveScreenshot('recipe-card-authenticated.png');

    // Test Interaction: Toggle Favorite
    await favBtn.click();
    await expect(favBtn).not.toHaveClass(/active/); // Should remove active class

    // Test Interaction: Toggle Back
    await favBtn.click();
    await expect(favBtn).toHaveClass(/active/); // Should add active class back
  });
});
