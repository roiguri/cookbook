import authService from '../../../js/services/auth/auth-service.js';
import favoritesService from '../../../js/services/users/favorites-service.js';
import { FilterUtils } from '../../../js/utils/filter-utils.js';
import { getErrorMessage, logError } from '../../../js/utils/error-handler.js';

const EMPTY_FILTERS = Object.freeze({
  cookingTime: '',
  difficulty: '',
  mainIngredient: '',
  tags: [],
  favoritesOnly: false,
});

/**
 * RecipeListController — the behaviour of a filterable recipe list page.
 *
 * Drives the shared component tree used by every recipe list (Categories,
 * My recipes): `<unified-recipe-filter>` (search, category chips, "more
 * filters") and `<recipe-presentation-grid>` (cards, pagination). Each page
 * supplies only what differs — where the recipes come from, and what to do
 * when the visible state changes (title, URL) — so search, filtering,
 * pagination and favourites behave identically everywhere.
 *
 * Usage:
 *   const list = new RecipeListController({
 *     loadRecipes: ({ category }) => RecipeService.listPublished(…),
 *     onStateChanged: (state) => updateTitle(state),
 *     onUrlChanged: (state) => updateUrl(state),
 *   });
 *   list.init({ category, searchQuery, favoritesOnly });
 *   await list.start();
 *   …
 *   list.stop();
 *
 * State (read-only for callers): currentCategory, currentSearchQuery,
 * activeFilters, hasActiveFilters, currentPage, allRecipes, displayedRecipes.
 */
export class RecipeListController {
  /**
   * @param {Object} options
   * @param {({ category: string, searchQuery: string }) => Promise<Array<Object>>} options.loadRecipes -
   *   Data source. Receives the current category ('all' for none) and search
   *   text (the list filters by it; a source may widen what it returns while
   *   searching, e.g. the reader's own private recipes).
   * @param {(state: RecipeListController) => void} [options.onStateChanged] -
   *   Called when the visible state changes (e.g. to update the page title).
   * @param {(state: RecipeListController) => void} [options.onUrlChanged] -
   *   Called when the state should be reflected in the URL.
   * @param {(state: RecipeListController) => void} [options.onRecipesLoaded] -
   *   Called after each load from the data source (e.g. to show an empty state).
   * @param {string} [options.gridId='recipe-presentation-grid']
   * @param {string} [options.filterId='unified-filter']
   * @param {number} [options.recipesPerPage=8]
   * @param {string} [options.context='Recipe list'] - Label for error logging.
   */
  constructor({
    loadRecipes,
    onStateChanged = () => {},
    onUrlChanged = () => {},
    onRecipesLoaded = () => {},
    gridId = 'recipe-presentation-grid',
    filterId = 'unified-filter',
    recipesPerPage = 8,
    context = 'Recipe list',
  } = {}) {
    if (typeof loadRecipes !== 'function') {
      throw new Error('RecipeListController: loadRecipes is required');
    }
    this.loadRecipes = loadRecipes;
    this.onStateChanged = onStateChanged;
    this.onUrlChanged = onUrlChanged;
    this.onRecipesLoaded = onRecipesLoaded;
    this.gridId = gridId;
    this.filterId = filterId;
    this.recipesPerPage = recipesPerPage;
    this.context = context;
    this.init();
  }

  get grid() {
    return document.getElementById(this.gridId);
  }

  get filter() {
    return document.getElementById(this.filterId);
  }

  /**
   * Set the initial state (before `start()`).
   * @param {Object} [state]
   * @param {string} [state.category='all']
   * @param {string} [state.searchQuery='']
   * @param {boolean} [state.favoritesOnly=false]
   */
  init({ category = 'all', searchQuery = '', favoritesOnly = false } = {}) {
    this.currentCategory = category || 'all';
    this.currentSearchQuery = searchQuery || '';
    this.currentPage = 1;
    this.displayedRecipes = [];
    this.allRecipes = [];
    this.currentUser = authService.getCurrentUser(); // Track current user for auth changes

    this.activeFilters = { ...EMPTY_FILTERS, tags: [], favoritesOnly: !!favoritesOnly };
    this.hasActiveFilters = FilterUtils.hasActiveFilters(this.activeFilters);
  }

  /** Wire the components and load the first page. */
  async start() {
    this.setupAuthObserver();
    this.setupEventListeners();
    this.updateUI();
    this._loadAndDisplay().catch((err) => this.handleError(err, 'loadAndDisplay'));
  }

  /** Remove every listener added by `start()`. */
  stop() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
    if (this._boundFavoriteChanged) {
      document.removeEventListener('recipe-favorite-changed', this._boundFavoriteChanged);
      this._boundFavoriteChanged = null;
    }
  }

  async _loadAndDisplay() {
    const grid = this.grid;
    if (grid) {
      await grid.waitForReady(5000);
      grid.setAttribute('recipes-per-page', String(this.recipesPerPage));
      grid.showLoading();
    }
    await this.loadInitialRecipes();
    await this.displayCurrentPageRecipes();
  }

  /**
   * Apply state that arrived from outside (e.g. the URL) and reload if it changed.
   * @param {Object} state
   * @param {string} [state.category='all']
   * @param {string} [state.searchQuery='']
   * @param {boolean} [state.favoritesOnly=false] - Only turns favourites on, never off.
   */
  async applyState({ category = 'all', searchQuery = '', favoritesOnly = false } = {}) {
    let needsReload = false;

    if ((category || 'all') !== this.currentCategory) {
      this.currentCategory = category || 'all';
      needsReload = true;
    }

    if ((searchQuery || '') !== this.currentSearchQuery) {
      this.currentSearchQuery = searchQuery || '';
      needsReload = true;
    }

    // Only update favorites if it's explicitly set to true
    if (favoritesOnly && favoritesOnly !== this.activeFilters.favoritesOnly) {
      this.activeFilters.favoritesOnly = favoritesOnly;
      this.hasActiveFilters = FilterUtils.hasActiveFilters(this.activeFilters);
      needsReload = true;
    }

    if (needsReload) {
      this.filter?.setSearchQuery(this.currentSearchQuery);
      await this.loadInitialRecipes();
      this.updateUI();
      await this.displayCurrentPageRecipes();
    }
  }

  setupAuthObserver() {
    this.authUnsubscribe = authService.addAuthObserver(async (authState) => {
      const wasAuthenticated = !!this.currentUser;
      const isNowAuthenticated = !!authState.user;
      this.currentUser = authState.user;

      if (wasAuthenticated && !isNowAuthenticated && this.activeFilters.favoritesOnly) {
        this.activeFilters.favoritesOnly = false;
        this.hasActiveFilters = FilterUtils.hasActiveFilters(this.activeFilters);
        this.currentCategory = 'all';
        this.currentSearchQuery = '';

        const filterSearchBar = document.querySelector('filter-search-bar');
        if (filterSearchBar) {
          filterSearchBar.clear();
        }
      }

      const userChanged =
        wasAuthenticated !== isNowAuthenticated ||
        (isNowAuthenticated && this.currentUser?.uid !== authState.user?.uid);

      if (userChanged) {
        favoritesService.clearCache();
      }

      await this.loadInitialRecipes();
      this.updateUI();
      await this.displayCurrentPageRecipes();

      this.onUrlChanged(this);

      this.refreshFilterModalIfOpen();
    });
  }

  refreshFilterModalIfOpen() {
    const filterModal = document.getElementById('recipe-filter');
    if (filterModal) {
      const customModal = filterModal.shadowRoot?.querySelector('custom-modal');

      if (customModal?.isOpen) {
        filterModal.render();
        filterModal.setupEventListeners();
      }
    }
  }

  async loadInitialRecipes() {
    try {
      this.allRecipes = await this.loadRecipes({
        category: this.currentCategory,
        searchQuery: this.currentSearchQuery,
      });

      let filteredRecipes = [...this.allRecipes];

      if (this.currentSearchQuery) {
        filteredRecipes = FilterUtils.searchRecipes(filteredRecipes, this.currentSearchQuery);
      }

      if (this.hasActiveFilters) {
        filteredRecipes = await this.applyActiveFilters(filteredRecipes);
      }

      this.displayedRecipes = filteredRecipes;
      this.currentPage = 1;
      this.onRecipesLoaded(this);
    } catch (error) {
      console.error('Error loading recipes:', error);
      this.handleError(error, 'loading recipes');
    }
  }

  async applyActiveFilters(recipes) {
    if (!this.hasActiveFilters) {
      return recipes;
    }

    let favoriteRecipeIds = [];
    if (this.activeFilters.favoritesOnly) {
      favoriteRecipeIds = await favoritesService.getUserFavorites();
    }

    return FilterUtils.applyFilters(recipes, this.activeFilters, favoriteRecipeIds);
  }

  setupEventListeners() {
    const grid = this.grid;
    if (grid) {
      grid.addEventListener('page-changed', async (event) => {
        const { page } = event.detail;
        this.currentPage = page;
        await this.displayCurrentPageRecipes();
      });
      grid.addEventListener('recipe-selected', this.handleRecipeSelected.bind(this));
    }

    const unifiedFilter = this.filter;
    if (unifiedFilter) {
      unifiedFilter.addEventListener(
        'unified-search-changed',
        this.handleUnifiedSearchChanged.bind(this),
      );
      unifiedFilter.addEventListener(
        'unified-category-changed',
        this.handleUnifiedCategoryChanged.bind(this),
      );
      unifiedFilter.addEventListener(
        'unified-filters-changed',
        this.handleUnifiedFiltersChanged.bind(this),
      );
    }

    this._boundFavoriteChanged = async (event) => {
      const { recipeId, isFavorite } = event.detail;
      favoritesService.updateCache(recipeId, isFavorite);

      if (this.activeFilters.favoritesOnly && !isFavorite) {
        // Smoothly animate removal if we are looking at the favorites view
        const listGrid = this.grid;
        if (listGrid && typeof listGrid.removeRecipeAnimated === 'function') {
          await listGrid.removeRecipeAnimated(recipeId);

          // Silently update state locally to prevent full grid re-render twitch
          this.allRecipes = this.allRecipes.filter((r) => r.id !== recipeId);
          this.displayedRecipes = this.displayedRecipes.filter((r) => r.id !== recipeId);

          listGrid.recipes = this.displayedRecipes;
          listGrid.recalculatePages();
          listGrid.updatePagination();

          // Smoothly append any incoming cards to fill gaps
          if (typeof listGrid.fillPageGap === 'function') {
            await listGrid.fillPageGap();
          }
        } else {
          await this.loadInitialRecipes();
          await this.displayCurrentPageRecipes();
        }
      } else if (this.activeFilters.favoritesOnly) {
        await this.loadInitialRecipes();
        await this.displayCurrentPageRecipes();
      }
    };

    document.addEventListener('recipe-favorite-changed', this._boundFavoriteChanged);
  }

  updateUI() {
    this.updateUnifiedFilter();
    this.onStateChanged(this);
  }

  updateUnifiedFilter() {
    const unifiedFilter = this.filter;
    if (unifiedFilter) {
      // Set current state in unified component
      unifiedFilter.setState({
        currentCategory: this.currentCategory,
        searchQuery: this.currentSearchQuery,
        filters: this.activeFilters,
        hasActiveFilters: this.hasActiveFilters,
      });

      // Set base recipes for filtering
      unifiedFilter.setBaseRecipes(this.allRecipes || []);
    }
  }

  /**
   * Reset to a known state: all categories, no search, and either the
   * favourites view or no filters.
   * @param {Object} [options]
   * @param {boolean} [options.favoritesOnly=false]
   * @param {boolean} [options.resetFilters=false]
   */
  async setFilterState(options = {}) {
    const { favoritesOnly = false, resetFilters = false } = options;

    if (window.closeMobileDrawer) {
      window.closeMobileDrawer();
    }

    if (favoritesOnly) {
      const user = authService.getCurrentUser();
      if (!user) {
        return;
      }
    }

    if (resetFilters || favoritesOnly) {
      this.activeFilters = { ...EMPTY_FILTERS, tags: [], favoritesOnly };
    } else {
      this.activeFilters.favoritesOnly = favoritesOnly;
    }

    this.hasActiveFilters = FilterUtils.hasActiveFilters(this.activeFilters);
    this.currentCategory = 'all';
    this.currentSearchQuery = '';

    this.filter?.setSearchQuery('');

    await this.loadInitialRecipes();
    this.updateUI();
    await this.displayCurrentPageRecipes();

    if (window.updateActiveNavigation) {
      setTimeout(window.updateActiveNavigation, 0);
    }

    this.onUrlChanged(this);
  }

  async displayCurrentPageRecipes() {
    const grid = this.grid;
    if (!grid) {
      console.warn('Recipe presentation grid element not found');
      return;
    }

    const isReady = await grid.waitForReady(5000);
    if (!isReady) {
      console.error('Recipe presentation grid component failed to initialize within timeout');
      return;
    }

    const authenticated = authService.getCurrentUser();
    grid.setAttribute('show-favorites', authenticated ? 'true' : 'false');
    grid.setAttribute('recipes-per-page', String(this.recipesPerPage));
    grid.setAttribute('current-page', this.currentPage.toString());

    grid.setRecipes(this.displayedRecipes, false);
  }

  handleRecipeSelected(event) {
    const { recipeId } = event.detail;
    if (window.spa?.router) {
      window.spa.router.navigate(`/recipe/${recipeId}`);
      setTimeout(() => {
        if (typeof window.updateActiveNavigation === 'function') {
          window.updateActiveNavigation();
        }
      }, 100);
    } else {
      // Fallback to traditional navigation
      window.location.href = `${import.meta.env.BASE_URL}pages/recipe-page.html?id=${recipeId}`;
    }
  }

  async handleUnifiedSearchChanged(event) {
    const { searchQuery } = event.detail;

    if (this.currentSearchQuery !== searchQuery) {
      this.currentSearchQuery = searchQuery;

      await this.loadInitialRecipes();
      this.currentPage = 1;
      this.updateUI();
      await this.displayCurrentPageRecipes();

      this.onUrlChanged(this);
    }
  }

  async handleUnifiedCategoryChanged(event) {
    const { category } = event.detail;
    await this.updatePageState({ category });
    this.onUrlChanged(this);
  }

  async handleUnifiedFiltersChanged(event) {
    const { filters, filteredRecipes, hasActiveFilters } = event.detail;

    // Check if favorites filter changed from true to false
    const wasFavoritesOnly = this.activeFilters.favoritesOnly;
    const isFavoritesOnly = filters.favoritesOnly || false;
    const favoritesDisabled = wasFavoritesOnly && !isFavoritesOnly;

    this.activeFilters = {
      cookingTime: filters.cookingTime || '',
      difficulty: filters.difficulty || '',
      mainIngredient: filters.mainIngredient || '',
      tags: filters.tags || [],
      favoritesOnly: isFavoritesOnly,
    };

    this.hasActiveFilters = hasActiveFilters;

    // If favorites filter changed or was enabled, we need to reload from Firestore
    // because the unified component doesn't have access to user's favorites data
    const favoritesEnabled = !wasFavoritesOnly && isFavoritesOnly;

    if (favoritesDisabled || favoritesEnabled) {
      await this.loadInitialRecipes();
    } else {
      this.displayedRecipes = filteredRecipes;
    }

    this.currentPage = 1;
    this.onStateChanged(this);
    this.onUrlChanged(this);

    if (window.updateActiveNavigation) {
      setTimeout(window.updateActiveNavigation, 0);
    }

    await this.displayCurrentPageRecipes();
  }

  async updatePageState(updates = {}) {
    const { category, searchQuery } = updates;
    let hasChanges = false;

    if (category !== undefined && category !== this.currentCategory) {
      this.currentCategory = category;
      hasChanges = true;
    }

    if (searchQuery !== undefined && searchQuery !== this.currentSearchQuery) {
      this.currentSearchQuery = searchQuery;
      hasChanges = true;
    }

    if (!hasChanges) return;

    // Close mobile drawer immediately for consistent timing
    if (window.closeMobileDrawer) {
      window.closeMobileDrawer();
    }

    await this.reloadAndDisplay();
    this.onUrlChanged(this);
  }

  async reloadAndDisplay() {
    this.currentPage = 1;
    await this.loadInitialRecipes();
    this.updateUI();
    await this.displayCurrentPageRecipes();
  }

  handleError(error, context = 'unknown') {
    logError(error, `${this.context} - ${context}`);

    const errorMessage = getErrorMessage(error);
    const recipeGrid = this.grid;
    if (recipeGrid) {
      recipeGrid.innerHTML = `
        <div class="error-message">
          <p>${errorMessage}</p>
        </div>
      `;
    }
  }
}
