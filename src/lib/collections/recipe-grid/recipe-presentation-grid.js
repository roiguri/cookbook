/**
 * Recipe Presentation Grid Web Component
 * A comprehensive grid component for displaying and managing recipe collections
 *
 * Architecture: Separated HTML, CSS, and JS files
 * - recipe-presentation-grid.html: HTML templates
 * - recipe-presentation-grid-styles.js: Component styles
 * - recipe-presentation-grid-config.js: Configuration constants
 * - recipe-presentation-grid.js: Component logic (this file)
 *
 * @attributes
 * - recipes-per-page: Number of recipes per page (default: 12)
 * - current-page: Current page number (default: 1)
 * - show-pagination: Whether to show pagination controls (default: true)
 * - show-favorites: Whether to show favorite buttons on cards (default: false)
 * - grid-layout: Grid layout type (default: 'responsive')
 *
 * @events
 * - page-changed: Emitted when page changes
 *   detail: { page: number, totalPages: number }
 * - recipe-selected: Emitted when a recipe is clicked
 *   detail: { recipeId: string, recipe: object }
 * - recipes-loaded: Emitted when recipes are loaded and displayed
 *   detail: { recipes: array, totalCount: number }
 * - favorite-changed: Emitted when favorite status changes
 *   detail: { recipeId: string, isFavorite: boolean }
 *
 * @features
 * - Responsive grid layout with CSS Grid
 * - Integrated pagination component
 * - Loading states and error handling
 * - No-results messaging
 * - Recipe card rendering with lazy loading
 * - Grid transition animations
 * - Configurable recipes per page
 */
import authService from '../../../js/services/auth/auth-service.js';
import { initLazyLoading } from '../../../js/utils/lazy-loading.js';
import { RECIPE_PRESENTATION_GRID_CONFIG } from './recipe-presentation-grid-config.js';
import { RECIPE_PRESENTATION_GRID_STYLES } from './recipe-presentation-grid-styles.js';

class RecipePresentationGrid extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Component state
    this.recipes = [];
    this.currentPage = 1;
    this.recipesPerPage = 12;
    this.totalPages = 1;
    this.showPagination = true;
    this.showFavorites = false;
    this.isLoading = false;
    this.isReady = false;
    this.pendingRecipes = null; // Store recipes if set before component is ready

    // Bind methods
    this.handleRecipeCardOpen = this.handleRecipeCardOpen.bind(this);
    this.handleFavoriteChanged = this.handleFavoriteChanged.bind(this);
    this.handlePaginationChange = this.handlePaginationChange.bind(this);
  }

  static get observedAttributes() {
    return ['recipes-per-page', 'current-page', 'show-pagination', 'show-favorites'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case 'recipes-per-page':
        const recipesPerPage = parseInt(newValue);
        this.recipesPerPage = recipesPerPage > 0 && recipesPerPage <= 100 ? recipesPerPage : 6;
        this.recalculatePages();
        this.renderCurrentPage();
        break;
      case 'current-page':
        const currentPage = parseInt(newValue);
        this.currentPage = currentPage > 0 ? currentPage : 1;
        this.renderCurrentPage();
        break;
      case 'show-pagination':
        this.showPagination = newValue !== 'false';
        this.updatePaginationVisibility();
        break;
      case 'show-favorites':
        this.showFavorites = newValue === 'true';
        this.renderCurrentPage();
        break;
    }
  }

  async connectedCallback() {
    await this.render();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    this.removeEventListeners();
  }

  async render() {
    try {
      // Load HTML template
      const templateResponse = await fetch(
        new URL('./recipe-presentation-grid.html', import.meta.url),
      );
      if (!templateResponse.ok) {
        throw new Error(`Failed to load template: ${templateResponse.status}`);
      }
      const template = await templateResponse.text();

      // Validate response is not empty
      if (!template || template.trim().length === 0) {
        throw new Error('Template file is empty or invalid');
      }

      this.shadowRoot.innerHTML = `
        <style>${RECIPE_PRESENTATION_GRID_STYLES}</style>
        ${template}
      `;

      // Initialize pagination component if needed
      if (this.showPagination) {
        await this.initializePagination();
      }

      // Set initial attributes
      this.updatePaginationVisibility();

      // Mark component as ready
      this.isReady = true;

      // Process any pending recipes that were set before component was ready
      if (this.pendingRecipes) {
        this.setRecipes(this.pendingRecipes, false);
        this.pendingRecipes = null;
      }
    } catch (error) {
      console.error('Error rendering recipe presentation grid:', error);
      this.shadowRoot.innerHTML = `
        <style>${RECIPE_PRESENTATION_GRID_STYLES}</style>
        <div class="error-state">
          <p>Error loading recipe grid</p>
        </div>
      `;
    }
  }

  setupEventListeners() {
    // Listen for recipe card interactions
    this.shadowRoot.addEventListener('recipe-card-open', this.handleRecipeCardOpen);
    this.shadowRoot.addEventListener('recipe-favorite-changed', this.handleFavoriteChanged);

    // Listen for pagination events
    const pagination = this.shadowRoot.querySelector('recipe-pagination');
    if (pagination) {
      pagination.addEventListener('page-changed', this.handlePaginationChange);
    }
  }

  removeEventListeners() {
    this.shadowRoot.removeEventListener('recipe-card-open', this.handleRecipeCardOpen);
    this.shadowRoot.removeEventListener('recipe-favorite-changed', this.handleFavoriteChanged);
  }

  /**
   * Set recipes data and render the grid
   * @param {Array} recipes - Array of recipe objects
   * @param {boolean} resetPage - Whether to reset to page 1
   */
  setRecipes(recipes, resetPage = false) {
    // If component isn't ready yet, store recipes for later processing
    if (!this.isReady) {
      this.pendingRecipes = recipes || [];
      return;
    }

    this.recipes = recipes || [];

    if (resetPage) {
      this.currentPage = 1;
    }

    this.recalculatePages();
    this.renderCurrentPage();
    this.updatePagination();

    // Emit recipes loaded event
    this.dispatchEvent(
      new CustomEvent('recipes-loaded', {
        detail: {
          recipes: this.recipes,
          totalCount: this.recipes.length,
        },
      }),
    );
  }

  /**
   * Get current page recipes
   */
  getCurrentPageRecipes() {
    const startIndex = (this.currentPage - 1) * this.recipesPerPage;
    const endIndex = startIndex + this.recipesPerPage;
    return this.recipes.slice(startIndex, endIndex);
  }

  /**
   * Recalculate total pages based on recipes and per-page count
   */
  recalculatePages() {
    this.totalPages = Math.ceil(this.recipes.length / this.recipesPerPage);
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }
  }

  /**
   * Render current page of recipes
   */
  async renderCurrentPage() {
    const gridContainer = this.shadowRoot.querySelector('.recipe-grid');
    if (!gridContainer) return;

    // Add transition class for smooth updates
    gridContainer.classList.add('transitioning');

    // Wait for fade out
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Clear existing content
    gridContainer.innerHTML = '';

    const currentPageRecipes = this.getCurrentPageRecipes();

    if (currentPageRecipes.length === 0) {
      this.renderNoResults(gridContainer);
    } else {
      await this.renderRecipeCards(gridContainer, currentPageRecipes);
    }

    // Remove transition class
    gridContainer.classList.remove('transitioning');
  }

  /**
   * Render no results message
   */
  renderNoResults(container) {
    container.className = 'recipe-grid no-results';

    const noResultsDiv = document.createElement('div');
    noResultsDiv.className = 'no-results-message';
    noResultsDiv.innerHTML = `
      <p>${RECIPE_PRESENTATION_GRID_CONFIG.NO_RESULTS_MESSAGE}</p>
      <p class="suggestion">${RECIPE_PRESENTATION_GRID_CONFIG.NO_RESULTS_SUGGESTION}</p>
    `;

    container.appendChild(noResultsDiv);
  }

  /**
   * Render recipe cards for current page
   */
  async renderRecipeCards(container, recipes) {
    container.className = 'recipe-grid';

    const user = authService.getCurrentUser();
    const authenticated = !!user;
    let favoritesPromise;

    // PERFORMANCE: Fetch user favorites once for all cards (N+1 optimization)
    // Non-blocking fetch to avoid delaying render
    // Using cached user data from AuthService to prevent redundant network requests
    if (authenticated && this.showFavorites) {
      favoritesPromise = authService
        .getUserData()
        .then((userData) => userData?.favorites || [])
        .catch((error) => {
          console.error('Error pre-fetching favorites:', error);
          return null;
        });
    }

    // PERFORMANCE: Use DocumentFragment to batch DOM insertions (Layout thrashing optimization)
    const fragment = document.createDocumentFragment();
    const createdCards = [];

    for (const recipe of recipes) {
      const cardContainer = document.createElement('div');
      cardContainer.className = 'recipe-card-container';

      const recipeCard = document.createElement('recipe-card');
      recipeCard.setAttribute('recipe-id', recipe.id);
      recipeCard.setAttribute('layout', 'vertical');

      // PERFORMANCE: Pass recipe data directly to avoid N+1 fetches
      recipeCard.recipeData = recipe;

      if (authenticated && this.showFavorites) {
        recipeCard.setAttribute('show-favorites', 'true');
        // PERFORMANCE: Initialize as false to prevent card's internal fetch (N+1 prevention)
        // We will update it asynchronously once the bulk fetch completes
        recipeCard.isFavorite = false;
        createdCards.push(recipeCard);
      }

      if (authenticated && this.getAttribute('show-add-to-meal') !== 'false') {
        recipeCard.setAttribute('show-add-to-meal', 'true');
      }

      cardContainer.appendChild(recipeCard);
      fragment.appendChild(cardContainer);
    }

    container.appendChild(fragment);

    // Update favorites once data is available
    if (favoritesPromise) {
      favoritesPromise.then((favoriteList) => {
        if (favoriteList) {
          const favSet = new Set(favoriteList);
          createdCards.forEach((card) => {
            if (favSet.has(card.recipeId)) {
              card.isFavorite = true;
            }
          });
        }
      });
    }
  }

  /**
   * Handle recipe card click
   */
  handleRecipeCardOpen(event) {
    const { recipeId } = event.detail;
    const recipe = this.recipes.find((r) => r.id === recipeId);

    this.dispatchEvent(
      new CustomEvent('recipe-selected', {
        detail: { recipeId, recipe },
      }),
    );
  }

  /**
   * Handle favorite status change
   */
  handleFavoriteChanged(event) {
    this.dispatchEvent(
      new CustomEvent('favorite-changed', {
        detail: event.detail,
      }),
    );
  }

  /**
   * Handle pagination change
   */
  handlePaginationChange(event) {
    const { page } = event.detail;
    this.goToPage(page);
  }

  /**
   * Navigate to specific page
   */
  async goToPage(page) {
    if (page < 1 || page > this.totalPages) return;

    this.currentPage = page;
    await this.renderCurrentPage();

    this.dispatchEvent(
      new CustomEvent('page-changed', {
        detail: {
          page: this.currentPage,
          totalPages: this.totalPages,
        },
      }),
    );
  }

  /**
   * Update pagination component
   */
  updatePagination() {
    const pagination = this.shadowRoot.querySelector('recipe-pagination');
    if (pagination) {
      pagination.setCurrentPage(this.currentPage);
      pagination.setTotalPages(this.totalPages);
      pagination.setTotalItems(this.recipes.length);
    }
  }

  /**
   * Initialize pagination component
   */
  async initializePagination() {
    // Import pagination component if not already loaded
    if (!customElements.get('recipe-pagination')) {
      await import('../recipe-pagination/recipe-pagination.js');
    }
  }

  /**
   * Update pagination visibility
   */
  updatePaginationVisibility() {
    const paginationContainer = this.shadowRoot.querySelector('.pagination-container');
    if (paginationContainer) {
      paginationContainer.style.display = this.showPagination ? 'block' : 'none';
    }
  }

  /**
   * Show loading state
   */
  showLoading() {
    this.isLoading = true;
    const gridContainer = this.shadowRoot.querySelector('.recipe-grid');
    if (!gridContainer) return;
    const count = this.recipesPerPage || 8;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'recipe-card-container';
      const card = document.createElement('recipe-card');
      card.setAttribute('layout', 'vertical');
      wrapper.appendChild(card);
      fragment.appendChild(wrapper);
    }
    gridContainer.innerHTML = '';
    gridContainer.appendChild(fragment);
  }

  /**
   * Hide loading state
   */
  hideLoading() {
    this.isLoading = false;
  }

  /**
   * Public API methods
   */
  getRecipes() {
    return this.recipes;
  }

  getCurrentPage() {
    return this.currentPage;
  }

  getTotalPages() {
    return this.totalPages;
  }

  getRecipesPerPage() {
    return this.recipesPerPage;
  }

  /**
   * Visually removes a recipe card with an animation before grid re-render
   * @param {string} recipeId The ID of the recipe to remove
   */
  async removeRecipeAnimated(recipeId) {
    const gridContainer = this.shadowRoot.querySelector('.recipe-grid');
    if (!gridContainer) return;

    const cards = gridContainer.querySelectorAll('recipe-card');
    let targetContainer = null;

    for (const card of cards) {
      if (card.recipeId === recipeId) {
        targetContainer = card.closest('.recipe-card-container');
        break;
      }
    }

    if (targetContainer) {
      targetContainer.classList.add('removing');
      // Wait for the fade-out transition to finish
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Remove from DOM cleanly, use View Transitions api to smooth out the resulting layout gap shift
      if (document.startViewTransition) {
        const transition = document.startViewTransition(() => {
          if (targetContainer && targetContainer.isConnected) {
            targetContainer.remove();
          }
        });

        // Prevent Uncaught (in promise) AbortError when transition is skipped
        transition.ready.catch(() => {});
        transition.finished.catch(() => {});
        transition.updateCallbackDone.catch(() => {});
      } else {
        targetContainer.remove();
      }
    }
  }

  /**
   * Smoothly fill any gaps in the current page after an item was removed silently
   */
  async fillPageGap() {
    const gridContainer = this.shadowRoot.querySelector('.recipe-grid');
    if (!gridContainer) return;

    const currentPageRecipes = this.getCurrentPageRecipes();
    const existingCards = Array.from(gridContainer.querySelectorAll('recipe-card'));

    if (currentPageRecipes.length === 0 && this.recipes.length === 0) {
      // Nothing to show, render no results
      gridContainer.innerHTML = '';
      this.renderNoResults(gridContainer);
      return;
    }

    // Find recipes that should be here but aren't
    const newRecipes = currentPageRecipes.filter(
      (recipe) => !existingCards.some((card) => card.recipeId === recipe.id),
    );

    // Find any stragglers and remove them instantly
    const extraCards = existingCards.filter(
      (card) => !currentPageRecipes.some((recipe) => recipe.id === card.recipeId),
    );

    for (const card of extraCards) {
      const container = card.closest('.recipe-card-container');
      if (container) container.remove();
    }

    if (newRecipes.length > 0) {
      if (gridContainer.classList.contains('no-results')) {
        gridContainer.innerHTML = '';
        gridContainer.className = 'recipe-grid';
      }

      // Render new cards into a temporary container
      const tempContainer = document.createElement('div');
      await this.renderRecipeCards(tempContainer, newRecipes);

      const newCardContainers = Array.from(
        tempContainer.querySelectorAll('.recipe-card-container'),
      );
      for (const cardContainer of newCardContainers) {
        cardContainer.style.opacity = '0';
        cardContainer.style.transform = 'translateY(10px)';
        cardContainer.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';

        gridContainer.appendChild(cardContainer);

        // Trigger reflow
        cardContainer.offsetHeight;

        cardContainer.style.opacity = '1';
        cardContainer.style.transform = 'translateY(0)';

        // Clean up inline styles after transition
        setTimeout(() => {
          cardContainer.style.opacity = '';
          cardContainer.style.transform = '';
          cardContainer.style.transition = '';
        }, 400);
      }
    }
  }

  /**
   * Check if component is fully initialized and ready to use
   */
  isComponentReady() {
    return this.isReady && this.shadowRoot && this.shadowRoot.querySelector('.recipe-grid');
  }

  /**
   * Wait for component to be ready
   */
  async waitForReady(timeout = 5000) {
    const startTime = Date.now();
    while (!this.isComponentReady() && Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.isComponentReady();
  }
}

// Register the custom element
customElements.define('recipe-presentation-grid', RecipePresentationGrid);

export default RecipePresentationGrid;
