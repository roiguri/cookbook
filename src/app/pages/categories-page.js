import authService from '../../js/services/auth-service.js';
import { RecipeService } from '../../js/services/recipe-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import { FilterUtils } from '../../js/utils/filter-utils.js';
import { getLocalizedCategoryName } from '../../js/utils/recipes/recipe-data-utils.js';
import { getErrorMessage, logError } from '../../js/utils/error-handler.js';
import favoritesService from '../../js/services/favorites-service.js';
import '../../styles/pages/categories-spa.css';

// TODO: implement recipe-per-page change on screen resize
export default {
  async render() {
    try {
      // Resolve relative to this module so it works no matter where the SPA is mounted
      const response = await fetch(new URL('./categories-page.html', import.meta.url));
      if (!response.ok) {
        throw new Error(`Failed to load categories template: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      console.error('Error loading categories page template:', error);
      throw error;
    }
  },

  async mount(_container, params) {
    try {
      await this.importComponents();
      this.initializeState(params);
      this.setupAuthObserver();
      this.setupEventListeners();
      this.updateUI();
      this._loadAndDisplay().catch((err) => this.handleError(err, 'loadAndDisplay'));
    } catch (error) {
      console.error('Error mounting categories page:', error);
      this.handleError(error, 'mount');
    }
  },

  async _loadAndDisplay() {
    const grid = document.getElementById('recipe-presentation-grid');
    if (grid) {
      await grid.waitForReady(5000);
      grid.setAttribute('recipes-per-page', '8');
      grid.showLoading();
    }
    await this.loadInitialRecipes();
    await this.displayCurrentPageRecipes();
  },

  async waitForReady(container) {
    const filter = container.querySelector('#unified-filter');
    if (filter?.waitForReady) await filter.waitForReady();
  },

  async unmount() {
    try {
      if (this.authUnsubscribe) {
        this.authUnsubscribe();
      }
      this.removeEventListeners();
    } catch (error) {
      console.error('Error unmounting categories page:', error);
    }
  },

  getTitle(params) {
    const category = params?.category;
    if (category && category !== 'all') {
      return AppConfig.getPageTitle(getLocalizedCategoryName(category));
    }
    return AppConfig.getPageTitle('מתכונים');
  },

  getMeta(params) {
    const category = params?.category;
    const searchQuery = params?.q;

    let description = 'Browse our collection of delicious recipes';
    if (category && category !== 'all') {
      description = `Discover ${getLocalizedCategoryName(category)} recipes`;
    }
    if (searchQuery) {
      description += ` matching "${searchQuery}"`;
    }

    return {
      description,
      keywords: 'recipes, cooking, categories, search, food, kitchen',
    };
  },

  async handleRouteChange(params) {
    const newCategory = params?.category || 'all';
    const newSearchQuery = params?.q || '';
    const favoritesOnly = params?.favorites === 'true';

    let needsReload = false;

    if (newCategory !== this.currentCategory) {
      this.currentCategory = newCategory;
      needsReload = true;
    }

    if (newSearchQuery !== this.currentSearchQuery) {
      this.currentSearchQuery = newSearchQuery;
      needsReload = true;
    }

    // Only update favorites if it's explicitly set to true in URL params
    if (favoritesOnly && favoritesOnly !== this.activeFilters.favoritesOnly) {
      this.activeFilters.favoritesOnly = favoritesOnly;
      this.hasActiveFilters = FilterUtils.hasActiveFilters(this.activeFilters);
      needsReload = true;
    }

    if (needsReload) {
      // Update unified filter with new search query
      const unifiedFilter = document.getElementById('unified-filter');
      if (unifiedFilter) {
        unifiedFilter.setSearchQuery(this.currentSearchQuery);
      }

      await this.loadInitialRecipes();
      this.updateUI();
      await this.displayCurrentPageRecipes();
    }
  },

  initializeState(params) {
    this.currentCategory = params?.category || 'all';
    this.currentSearchQuery = params?.q || '';
    this.currentPage = 1;
    this.displayedRecipes = [];
    this.allRecipes = [];
    this.currentUser = authService.getCurrentUser(); // Track current user for auth changes

    this.activeFilters = {
      cookingTime: '',
      difficulty: '',
      mainIngredient: '',
      tags: [],
      favoritesOnly: params?.favorites === 'true' || false,
    };
    this.hasActiveFilters = FilterUtils.hasActiveFilters(this.activeFilters);
  },

  async importComponents() {
    try {
      await Promise.all([
        import('../../lib/recipes/recipe-card/recipe-card.js'),
        import('../../lib/search/search-service/search-service.js'),
        import('../../lib/collections/unified-recipe-filter/unified-recipe-filter.js'),
        import('../../lib/collections/recipe-grid/recipe-presentation-grid.js'),
      ]);
    } catch (error) {
      console.error('Error importing categories page components:', error);
    }
  },

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

      this.updateURL(true);

      this.refreshFilterModalIfOpen();
    });
  },

  refreshFilterModalIfOpen() {
    const filterModal = document.getElementById('recipe-filter');
    if (filterModal) {
      const customModal = filterModal.shadowRoot?.querySelector('custom-modal');

      if (customModal?.isOpen) {
        filterModal.render();
        filterModal.setupEventListeners();
      }
    }
  },

  async loadInitialRecipes() {
    try {
      let queryParams = { where: [['approved', '==', true]] };

      if (this.currentCategory !== 'all') {
        queryParams.where.push(['category', '==', this.currentCategory]);
      }

      this.allRecipes = await RecipeService.list(queryParams);

      let filteredRecipes = [...this.allRecipes];

      if (this.currentSearchQuery) {
        filteredRecipes = FilterUtils.searchRecipes(filteredRecipes, this.currentSearchQuery);
      }

      if (this.hasActiveFilters) {
        filteredRecipes = await this.applyActiveFilters(filteredRecipes);
      }

      this.displayedRecipes = filteredRecipes;
      this.currentPage = 1;
    } catch (error) {
      console.error('Error loading recipes:', error);
      this.handleError(error, 'loading recipes');
    }
  },

  async applyActiveFilters(recipes) {
    if (!this.hasActiveFilters) {
      return recipes;
    }

    let favoriteRecipeIds = [];
    if (this.activeFilters.favoritesOnly) {
      favoriteRecipeIds = await favoritesService.getUserFavorites();
    }

    return FilterUtils.applyFilters(recipes, this.activeFilters, favoriteRecipeIds);
  },

  setupEventListeners() {
    const recipePresentationGrid = document.getElementById('recipe-presentation-grid');
    if (recipePresentationGrid) {
      recipePresentationGrid.addEventListener('page-changed', async (event) => {
        const { page } = event.detail;
        this.currentPage = page;
        await this.displayCurrentPageRecipes();
      });
      recipePresentationGrid.addEventListener(
        'recipe-selected',
        this.handleRecipeSelected.bind(this),
      );
    }

    const unifiedFilter = document.getElementById('unified-filter');
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
        const grid = document.getElementById('recipe-presentation-grid');
        if (grid && typeof grid.removeRecipeAnimated === 'function') {
          await grid.removeRecipeAnimated(recipeId);

          // Silently update state locally to prevent full grid re-render twitch
          this.allRecipes = this.allRecipes.filter((r) => r.id !== recipeId);
          this.displayedRecipes = this.displayedRecipes.filter((r) => r.id !== recipeId);

          grid.recipes = this.displayedRecipes;
          grid.recalculatePages();
          grid.updatePagination();

          // Smoothly append any incoming cards to fill gaps
          if (typeof grid.fillPageGap === 'function') {
            await grid.fillPageGap();
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

    this.setupNavigationInterception();
  },

  removeEventListeners() {
    this.removeNavigationInterception();
    if (this._boundFavoriteChanged) {
      document.removeEventListener('recipe-favorite-changed', this._boundFavoriteChanged);
    }
  },

  updateUI() {
    this.updateUnifiedFilter();
    this.updatePageTitle();
  },

  updateUnifiedFilter() {
    const unifiedFilter = document.getElementById('unified-filter');
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
  },

  updatePageTitle() {
    const pageTitle = document.querySelector('#category-header');
    if (pageTitle) {
      if (this.activeFilters.favoritesOnly) {
        pageTitle.textContent = 'מועדפים';
      } else if (this.currentSearchQuery) {
        pageTitle.textContent = `תוצאות חיפוש: "${this.currentSearchQuery}"`;
      } else if (this.currentCategory !== 'all') {
        pageTitle.textContent = getLocalizedCategoryName(this.currentCategory);
      } else {
        pageTitle.textContent = 'מתכונים';
      }
    }
  },

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
      this.activeFilters = {
        cookingTime: '',
        difficulty: '',
        mainIngredient: '',
        tags: [],
        favoritesOnly,
      };
    } else {
      this.activeFilters.favoritesOnly = favoritesOnly;
    }

    this.hasActiveFilters = FilterUtils.hasActiveFilters(this.activeFilters);
    this.currentCategory = 'all';
    this.currentSearchQuery = '';

    const unifiedFilter = document.getElementById('unified-filter');
    if (unifiedFilter) {
      unifiedFilter.setSearchQuery('');
    }

    await this.loadInitialRecipes();
    this.updateUI();
    await this.displayCurrentPageRecipes();

    if (window.updateActiveNavigation) {
      setTimeout(window.updateActiveNavigation, 0);
    }

    this.updateURL(true);
  },

  async activateFavoritesFilter() {
    await this.setFilterState({ favoritesOnly: true });
  },

  async resetToAllCategories() {
    await this.setFilterState({ resetFilters: true });
  },

  setupNavigationInterception() {
    if (window.NavigationInterceptor) {
      this.navigationInterceptor = new window.NavigationInterceptor();

      this.navigationInterceptor.addHandler('a[href="/categories?favorites=true"]', () => {
        this.activateFavoritesFilter();
      });

      this.navigationInterceptor.addHandler('a[href="/categories"]', () => {
        this.resetToAllCategories();
      });
    }
  },

  removeNavigationInterception() {
    if (this.navigationInterceptor) {
      this.navigationInterceptor.removeAllHandlers();
      this.navigationInterceptor = null;
    }
  },

  async displayCurrentPageRecipes() {
    const recipePresentationGrid = document.getElementById('recipe-presentation-grid');
    if (!recipePresentationGrid) {
      console.warn('Recipe presentation grid element not found');
      return;
    }

    const isReady = await recipePresentationGrid.waitForReady(5000);
    if (!isReady) {
      console.error('Recipe presentation grid component failed to initialize within timeout');
      return;
    }

    const authenticated = authService.getCurrentUser();
    recipePresentationGrid.setAttribute('show-favorites', authenticated ? 'true' : 'false');
    recipePresentationGrid.setAttribute('recipes-per-page', '8');
    recipePresentationGrid.setAttribute('current-page', this.currentPage.toString());

    recipePresentationGrid.setRecipes(this.displayedRecipes, false);
  },

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
  },

  async handleUnifiedSearchChanged(event) {
    const { searchQuery } = event.detail;

    if (this.currentSearchQuery !== searchQuery) {
      this.currentSearchQuery = searchQuery;

      await this.loadInitialRecipes();
      this.currentPage = 1;
      this.updateUI();
      await this.displayCurrentPageRecipes();

      this.updateURL(true);
    }
  },

  async handleUnifiedCategoryChanged(event) {
    const { category } = event.detail;
    await this.changeCategory(category);
    this.updateURL(true);
  },

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
    this.updatePageTitle();
    this.updateURL(true);

    if (window.updateActiveNavigation) {
      setTimeout(window.updateActiveNavigation, 0);
    }

    await this.displayCurrentPageRecipes();
  },

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
    this.updateURL(true);
  },

  async changeCategory(category) {
    await this.updatePageState({ category });
  },

  async changeSearch(searchQuery) {
    await this.updatePageState({ searchQuery });
  },

  async reloadAndDisplay() {
    this.currentPage = 1;
    await this.loadInitialRecipes();
    this.updateUI();
    await this.displayCurrentPageRecipes();
  },

  updateURL(silently = false) {
    if (window.spa?.router) {
      if (silently) {
        window.spa.router.updateCategoriesParams(
          this.currentCategory,
          this.currentSearchQuery,
          this.activeFilters,
        );
      } else {
        window.spa.router.navigateToCategoriesWithParams(
          this.currentCategory,
          this.currentSearchQuery,
          this.activeFilters,
        );
      }
    }
  },

  handleError(error, context = 'unknown') {
    logError(error, `Categories page - ${context}`);

    const errorMessage = getErrorMessage(error);
    const recipeGrid = document.getElementById('recipe-presentation-grid');
    if (recipeGrid) {
      recipeGrid.innerHTML = `
        <div class="error-message">
          <p>${errorMessage}</p>
        </div>
      `;
    }
  },
};
