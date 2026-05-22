import { AppConfig } from '../../js/config/app-config.js';
import authService from '../../js/services/auth/auth-service.js';
import { ActiveMealService } from '../../js/services/meals/active-meal-service.js';
import '../../styles/pages/recipe-detail-spa.css';

export default {
  async render() {
    const response = await fetch(new URL('./recipe-detail-page.html', import.meta.url));

    if (!response.ok) {
      throw new Error(`Failed to load template: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  },

  async mount(container, params) {
    const recipeId = params.id;
    if (!recipeId) {
      this.showError(container, 'Recipe ID is required');
      return;
    }

    try {
      await this.initializeRecipeComponent(container, recipeId);
      await this.importComponents();
      this.setupMenuHandlers(container, recipeId);
      this.setupImageProposalListener(container);
    } catch (error) {
      console.error('Failed to load recipe detail page:', error);
      this.showError(container, 'Failed to load recipe details');
    }
  },

  async initializeRecipeComponent(container, recipeId) {
    await import('../../lib/recipes/recipe_component/recipe_component.js');

    const recipeContainer = container.querySelector('.recipe-container');
    if (recipeContainer) {
      // Remove only existing recipe-component, preserve menu
      const existingComponent = recipeContainer.querySelector('recipe-component');
      if (existingComponent) {
        existingComponent.remove();
      }

      const recipeComponent = document.createElement('recipe-component');

      // Set up the listener before attaching to DOM and triggering fetch
      this._readyPromise = new Promise((resolve) => {
        recipeComponent.addEventListener('recipe-data-loaded', resolve, { once: true });
      });

      recipeComponent.setAttribute('recipe-id', recipeId);
      recipeContainer.appendChild(recipeComponent);

      // Handle navigation from related recipe cards inside the component
      recipeContainer.addEventListener('recipe-card-open', (event) => {
        const targetId = event.detail.recipeId;
        if (window.spa?.router) {
          window.spa.router.navigate(`/recipe/${targetId}`);
        } else {
          window.location.href = `${import.meta.env.BASE_URL}recipe/${targetId}`;
        }
      });
    } else {
      throw new Error('Recipe container not found in template');
    }
  },

  async importComponents() {
    // Import modal dependencies
    await import('../../lib/utilities/modal/modal.js');
    await import('../../lib/utilities/loading-spinner/loading-spinner.js');
    await import('../../lib/media/image-handler/image-handler.js');
    await import('../../lib/media/image-proposal-modal/image-proposal-modal.js');
    await import('../../lib/modals/message-modal/message-modal.js');
  },

  setupMenuHandlers(container, recipeId) {
    const menuButton = container.querySelector('.recipe-menu-button');
    const menuDropdown = container.querySelector('.recipe-menu-dropdown');
    const suggestImagesBtn = container.querySelector('#suggest-images-btn');
    const addToMealBtn = container.querySelector('#add-to-meal-btn');

    if (!menuButton || !menuDropdown || !suggestImagesBtn) {
      console.warn('Menu elements not found in container');
      return;
    }

    // Show "Add to Meal" only if user is logged in
    const user = authService.getCurrentUser();
    if (user && addToMealBtn) {
      addToMealBtn.style.display = 'flex';
    }

    // Toggle dropdown on button click
    menuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    const closeDropdown = (e) => {
      if (!menuButton.contains(e.target) && !menuDropdown.contains(e.target)) {
        menuDropdown.classList.remove('open');
      }
    };
    document.addEventListener('click', closeDropdown);

    // Store cleanup function for unmount
    this._menuCleanup = () => {
      document.removeEventListener('click', closeDropdown);
    };

    // Handle "Suggest Images" click
    suggestImagesBtn.addEventListener('click', () => {
      menuDropdown.classList.remove('open');
      const modal = container.querySelector('image-proposal-modal');
      if (modal) {
        modal.openForRecipe(recipeId);
      } else {
        console.error('Image proposal modal not found');
      }
    });

    // Handle "Add to Meal" click
    if (addToMealBtn) {
      addToMealBtn.addEventListener('click', async () => {
        menuDropdown.classList.remove('open');
        const currentUser = authService.getCurrentUser();
        if (!currentUser) return;

        try {
          const result = await ActiveMealService.addToMeal(currentUser.uid, recipeId);

          const messageModal = container.querySelector('message-modal');

          if (messageModal) {
            if (result.success) {
              messageModal.show('המתכון נוסף לארוחה שלך בהצלחה', 'נוסף לארוחה');
            } else if (result.reason === 'duplicate') {
              messageModal.show('המתכון כבר נמצא בארוחה שלך', 'כבר קיים');
            } else {
              messageModal.show('שגיאה בהוספת המתכון לארוחה', 'שגיאה');
            }
          }
        } catch (error) {
          console.error('Error adding to meal:', error);
          const messageModal = container.querySelector('message-modal');
          if (messageModal) {
            messageModal.show('שגיאה בהוספת המתכון לארוחה', 'שגיאה');
          }
        }
      });
    }
  },

  setupImageProposalListener(container) {
    const imageProposalModal = container.querySelector('image-proposal-modal');
    const messageModal = container.querySelector('message-modal');

    if (!imageProposalModal || !messageModal) {
      console.warn('Image proposal modal or message modal not found');
      return;
    }

    // Listen for successful image uploads
    imageProposalModal.addEventListener('images-proposed', (event) => {
      const { pendingImages } = event.detail;
      const count = pendingImages.length;
      const message =
        count === 1 ? 'התמונה נשלחה לאישור מנהל' : `${count} תמונות נשלחו לאישור מנהל`;
      messageModal.show(message, 'העלאה הצליחה');
    });
  },

  showError(container, message) {
    container.innerHTML = `
      <div class="page-error">
        <div class="error-card">
          <h2>Error Loading Recipe</h2>
          <p>Sorry, there was an error loading this recipe.</p>
          <div class="error-details" id="recipe-error-details"></div>
          <button class="reload-button" id="back-button">
            ← Go Back
          </button>
        </div>
      </div>
    `;

    const errorDetails = container.querySelector('#recipe-error-details');
    const backButton = container.querySelector('#back-button');

    errorDetails.textContent = message;
    backButton.addEventListener('click', () => {
      history.back();
    });
  },

  async unmount() {
    // Clean up menu event listeners
    if (this._menuCleanup) {
      this._menuCleanup();
      this._menuCleanup = null;
    }
  },

  async waitForReady(container) {
    if (this._readyPromise) {
      await this._readyPromise;
    }
  },

  async handleRouteChange(params) {
    // This method is called when navigating from one recipe to another
    // (e.g., when searching from a recipe page and finding a single match)
    const newRecipeId = params.id;
    if (!newRecipeId) {
      console.error('No recipe ID provided in route change');
      return;
    }

    // Find the current recipe component and update its recipe-id attribute
    const recipeContainer = document.querySelector('.recipe-container');
    if (recipeContainer) {
      const recipeComponent = recipeContainer.querySelector('recipe-component');
      if (recipeComponent) {
        // Update the recipe-id attribute, which will trigger the component to reload
        recipeComponent.setAttribute('recipe-id', newRecipeId);
      } else {
        // If component doesn't exist, reinitialize it
        await this.initializeRecipeComponent(recipeContainer, newRecipeId);
      }
    }

    // Update page title and metadata
    const title = this.getTitle(params);
    if (title) {
      document.title = title;
    }
  },

  getTitle(params) {
    return params.id
      ? AppConfig.getPageTitle(`Recipe ${params.id}`)
      : AppConfig.getPageTitle('Recipe');
  },

  getMeta() {
    return {
      description: 'View detailed recipe instructions, ingredients, and cooking tips.',
      keywords: 'recipe, cooking, instructions, ingredients, kitchen',
    };
  },

  stylePath: '/src/styles/pages/recipe-detail-spa.css',
};
