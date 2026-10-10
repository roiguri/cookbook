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
      this.setupSuggestionListener(container);
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

      // Every load (including later recipe-id changes) reports whether the recipe was
      // found; a missing or hidden recipe swaps in the "not found" state.
      recipeComponent.addEventListener('recipe-data-loaded', (event) => {
        this.toggleNotFound(recipeContainer, event.detail?.found === false);
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
    await import('../../lib/recipes/suggest_edit_modal/suggest-edit-modal.js');
    await import('../../lib/modals/message-modal/message-modal.js');
  },

  setupMenuHandlers(container, recipeId) {
    const menu = container.querySelector('.recipe-menu');
    const menuButton = container.querySelector('.recipe-menu-button');
    const menuDropdown = container.querySelector('.recipe-menu-dropdown');
    const suggestEditBtn = container.querySelector('#suggest-edit-btn');
    const addToMealBtn = container.querySelector('#add-to-meal-btn');

    if (!menu || !menuButton || !menuDropdown) {
      console.warn('Menu elements not found in container');
      return;
    }

    // Every menu action needs a signed-in user, so signed-out visitors get no menu.
    // (Image proposals go through "Suggest an edit"; the old "Suggest images" item was retired.)
    const user = authService.getCurrentUser();
    if (!user) return;
    menu.style.display = '';
    if (addToMealBtn) {
      addToMealBtn.style.display = 'flex';
    }
    if (suggestEditBtn) {
      suggestEditBtn.style.display = 'flex';
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

    // Handle "Suggest Edit" click
    if (suggestEditBtn) {
      suggestEditBtn.addEventListener('click', () => {
        menuDropdown.classList.remove('open');
        const modal = container.querySelector('suggest-edit-modal');
        if (modal) {
          modal.openForRecipe(recipeId);
        } else {
          console.error('Suggest edit modal not found');
        }
      });
    }

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

  setupSuggestionListener(container) {
    const messageModal = container.querySelector('message-modal');
    if (!messageModal) {
      console.warn('Message modal not found');
      return;
    }

    // Listen for successfully submitted edit suggestions
    const suggestEditModal = container.querySelector('suggest-edit-modal');
    if (suggestEditModal) {
      suggestEditModal.addEventListener('edit-suggested', () => {
        messageModal.show('העריכה נשלחה לאישור מנהל', 'נשלח לאישור');
      });
    }
  },

  toggleNotFound(recipeContainer, notFound) {
    const component = recipeContainer.querySelector('recipe-component');
    const menu = recipeContainer.querySelector('.recipe-menu');
    let block = recipeContainer.querySelector('.recipe-not-found');

    // style.display, not `hidden`: the component's :host display rule overrides the attribute.
    if (component) component.style.display = notFound ? 'none' : '';
    if (!notFound) {
      block?.remove();
      if (menu && authService.getCurrentUser()) menu.style.display = '';
      return;
    }

    if (menu) menu.style.display = 'none';
    if (block) return;

    // Markup and copy follow the "NotFound" artboard in the Cookbook screens canvas.
    const signedOut = !authService.getCurrentUser();
    block = document.createElement('section');
    block.className = 'recipe-not-found nf';
    block.setAttribute('dir', 'rtl');
    block.setAttribute('aria-labelledby', 'nf-title');
    block.innerHTML = `
      <div class="nf__card card">
        <svg class="nf__art" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="60" cy="62" r="34"></circle>
          <circle class="accent" cx="60" cy="62" r="23" stroke-dasharray="3 5"></circle>
          <path d="M14 26v18M10 26v14a4 4 0 0 0 8 0V26M14 48v52"></path>
          <path d="M106 48v52"></path>
          <ellipse cx="106" cy="36" rx="6" ry="11"></ellipse>
        </svg>
        <span class="eyebrow nf__eyebrow">מתכון לא נמצא</span>
        <h1 id="nf-title" class="heading-2-he nf__title">המתכון הזה לא זמין</h1>
        <p class="body-text-he nf__lede">
          ייתכן שהקישור שגוי, שהמתכון הוסר, או שהוא שמור כמתכון פרטי שרק בעליו יכולים לראות.
        </p>
        <div class="nf__actions">
          <a class="btn btn-primary btn-lg" href="/categories" data-route="/categories">לכל המתכונים</a>
          <a class="btn btn-ghost btn-lg" href="/home" data-route="/home">לדף הבית</a>
        </div>
        ${
          signedOut
            ? `<div class="nf__owner">
                 <p><b>זה מתכון שלכם?</b>מתכונים פרטיים מוצגים רק אחרי התחברות.</p>
                 <button type="button" class="btn btn-ghost nf__login">התחברות</button>
               </div>`
            : ''
        }
      </div>
    `;

    block.querySelectorAll('a[data-route]').forEach((link) => {
      link.addEventListener('click', (event) => {
        if (window.spa?.router) {
          event.preventDefault();
          window.spa.router.navigate(link.dataset.route);
        }
      });
    });

    // Signed-out visitors may be the author of a pending recipe: after signing in,
    // reload so the recipe (and the signed-in menu) can show.
    block.querySelector('.nf__login')?.addEventListener('click', (event) => {
      document.querySelector('auth-controller')?.openModal(event.currentTarget);
      if (this._reloadOnSignIn) return;
      this._reloadOnSignIn = (authEvent) => {
        if (authEvent.detail?.user) window.location.reload();
      };
      document.addEventListener('auth-state-changed', this._reloadOnSignIn);
    });

    recipeContainer.appendChild(block);
    document.title = AppConfig.getPageTitle('המתכון לא נמצא');
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
    if (this._reloadOnSignIn) {
      document.removeEventListener('auth-state-changed', this._reloadOnSignIn);
      this._reloadOnSignIn = null;
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
