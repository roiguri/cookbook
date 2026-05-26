import { test, expect } from '@playwright/test';

// Constants for test data
const MOCK_IMAGE_SRC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FULL_RECIPE_DATA = {
  name: 'בדיקת מתכון מלא',
  prepTime: 30,
  waitTime: 60,
  difficulty: 'בינוני',
  category: 'main-courses',
  servings: 4,
  ingredients: [
    { amount: 500, unit: 'גרם', item: 'קמח' },
    { amount: 2, unit: 'כפות', item: 'סוכר' },
  ],
  instructions: ['מערבבים את כל המצרכים', 'אופים בתנור למשך 30 דקות'],
  comments: ['הערה חשובה: לא לשרוף'],
  images: [{ full: 'path/to/image.jpg', isPrimary: true }],
};

const SECTIONED_RECIPE_DATA = {
  name: 'מתכון עם שלבים',
  prepTime: 45,
  waitTime: 15,
  difficulty: 'קשה',
  category: 'desserts',
  servings: 6,
  ingredientSections: [
    {
      title: 'בצק',
      items: [
        { amount: 200, unit: 'גרם', item: 'חמאה' },
        { amount: 300, unit: 'גרם', item: 'קמח' },
      ],
    },
    {
      title: 'מילוי',
      items: [
        { amount: 5, unit: 'יחידות', item: 'תפוחים' },
        { amount: 1, unit: 'כפית', item: 'קינמון' },
      ],
    },
  ],
  stages: [
    {
      title: 'הכנת הבצק',
      instructions: ['מעבדים חמאה וקמח', 'מקררים שעה'],
    },
    {
      title: 'הכנת המילוי',
      instructions: ['קולפים תפוחים', 'מערבבים עם קינמון'],
    },
  ],
  comments: [],
  images: [{ full: 'path/to/image.jpg', isPrimary: true }],
};

/**
 * Setup helpers to inject mocks into the component
 */
async function setupComponentWithMock(page, recipeData, mockImageSrc = MOCK_IMAGE_SRC) {
  await page.evaluate(
    async ({ recipe, imgSrc }) => {
      const component = document.querySelector('recipe-component');

      // Import services to mock
      const authServiceModule = await import('/src/js/services/auth/auth-service.js');
      const authService = authServiceModule.default;

      // Mock Auth Service
      authService.getCurrentUserRole = async () => 'user';
      authService.getCurrentUser = () => ({ uid: 'test-uid' });

      // Mock Data Fetching
      component.fetchAndPopulateRecipeData = async () => {
        // Populate manually since we are bypassing the real fetch
        component.updatePageTitle(recipe.name);
        component.populateRecipeDetails(recipe);

        // Mock image loading if needed
        const imageContainer = component.shadowRoot.querySelector(
          '.Recipe_component__image-container',
        );
        if (recipe.images && recipe.images.length > 0) {
          imageContainer.innerHTML = '';
          const img = document.createElement('img');
          img.src = imgSrc;
          img.className = 'Recipe_component__image';
          imageContainer.appendChild(img);
          imageContainer.style.display = '';
        } else {
          imageContainer.style.display = 'none';
        }

        component.populateIngredientsList(recipe);
        component.populateInstructions(recipe);
        component.populateCommentList(recipe);
        component.setupServingsAdjuster(recipe);
        component._originalIngredients = recipe.ingredients || recipe.ingredientSections;
      };

      // Trigger load
      component.setAttribute('recipe-id', 'test-recipe-' + Date.now());
      await component.fetchAndPopulateRecipeData();
    },
    { recipe: recipeData, imgSrc: mockImageSrc },
  );
}

test.describe('Recipe Component Visuals', () => {
  test.beforeEach(async ({ page }) => {
    // Serve the test page directly from the test file
    await page.goto('/tests/visuals/components/recipes/recipe-component/index.html');

    // Wait for custom element to be defined
    const isDefined = await page.evaluate(() => !!customElements.get('recipe-component'));
    expect(isDefined).toBe(true);
  });

  test('renders correctly with full recipe data', async ({ page }) => {
    await setupComponentWithMock(page, FULL_RECIPE_DATA);

    const component = page.locator('recipe-component');

    // Verify basic content
    await expect(component.locator('#Recipe_component__name')).toHaveText(FULL_RECIPE_DATA.name);
    await expect(component.locator('#Recipe_component__prepTime')).toContainText('30 דקות');

    // Verify ingredients
    const ingredientsList = component.locator('#Recipe_component__ingredients-list');
    await expect(ingredientsList.locator('li').first()).toContainText('קמח');

    // Take snapshot
    await expect(component).toHaveScreenshot('recipe-component-full.png');
  });

  test('renders correctly with sectioned ingredients and instructions', async ({ page }) => {
    await setupComponentWithMock(page, SECTIONED_RECIPE_DATA);

    const component = page.locator('recipe-component');

    // Verify sections exist
    await expect(
      component.locator('.Recipe_component__section-title').filter({ hasText: 'בצק' }),
    ).toBeVisible();
    await expect(
      component.locator('.Recipe_component__stage-title').filter({ hasText: 'הכנת הבצק' }),
    ).toBeVisible();

    // Take snapshot
    await expect(component).toHaveScreenshot('recipe-component-sectioned.png');
  });

  test('renders correctly on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await setupComponentWithMock(page, FULL_RECIPE_DATA);
    const component = page.locator('recipe-component');

    // Take snapshot
    await expect(component).toHaveScreenshot('recipe-component-mobile.png');
  });

  test('handles servings adjustment correctly', async ({ page }) => {
    const servingsData = {
      name: 'מתכון לחישוב מנות',
      prepTime: 10,
      waitTime: 0,
      difficulty: 'קל',
      category: 'starters',
      servings: 2,
      ingredients: [{ amount: 100, unit: 'גרם', item: 'אורז' }],
      instructions: ['לבשל'],
      images: [],
    };

    await setupComponentWithMock(page, servingsData);

    const component = page.locator('recipe-component');
    const servingsInput = component.locator('#Recipe_component__servings');
    const ingredientAmount = component.locator('.Recipe_component__ingredients-list .qty');

    // Initial check (2 servings -> 100g)
    await expect(servingsInput).toHaveValue('2');
    await expect(ingredientAmount).toHaveText('100 גרם');

    // Change servings to 4
    await servingsInput.fill('4');
    await servingsInput.press('Enter');

    // Verify amount doubled (4 servings -> 200g)
    await expect(ingredientAmount).toHaveText('200 גרם');
  });

  test('handles stage/instruction selection', async ({ page }) => {
    await setupComponentWithMock(page, FULL_RECIPE_DATA);

    const component = page.locator('recipe-component');
    const firstInstruction = component.locator('.Recipe_component__instructions li').first();

    // Determine initial state (not active)
    await expect(firstInstruction).not.toHaveClass(/active-step/);

    // Click to activate
    await firstInstruction.click();

    // Verify active
    await expect(firstInstruction).toHaveClass(/active-step/);

    // Verify styling via screenshot of the instructions section
    const instructionsSection = component.locator('.Recipe_component__instructions');
    await expect(instructionsSection).toHaveScreenshot('instructions-selection.png');
  });
});
