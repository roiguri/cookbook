/**
 * Unified Recipe Filter Web Component
 * Consolidates search, category navigation, and filter management into a single component
 *
 * Architecture: Separated HTML, CSS, and JS files
 * - unified-recipe-filter.html: HTML template
 * - unified-recipe-filter-styles.js: Component styles
 * - unified-recipe-filter-config.js: Configuration constants
 * - unified-recipe-filter.js: Component logic (this file)
 *
 * @attributes
 * - current-category: Currently selected category (default: 'all')
 * - search-query: Current search query string
 * - current-filters: JSON string of current filter state
 * - has-active-filters: Boolean indicating if any filters are active
 * - layout-mode: Layout mode ('full' or 'compact', default: 'full')
 * - categories: JSON string of categories array (optional, uses defaults)
 * - base-recipes: JSON string of recipes for filtering (optional)
 * - disabled: Boolean to disable entire component
 *
 * @events
 * - unified-filters-changed: Emitted when any filter state changes
 *   detail: { searchQuery, category, filters, hasActiveFilters, filteredRecipes }
 * - unified-search-changed: Emitted when search query changes
 *   detail: { searchQuery, category, filters }
 * - unified-category-changed: Emitted when category selection changes
 *   detail: { category, categoryData, searchQuery, filters }
 * - unified-state-changed: Emitted when any state changes
 *   detail: { searchQuery, category, filters, hasActiveFilters }
 *
 * @features
 * - Unified state management for all filter operations
 * - Integration with existing filter components
 * - Responsive layout with multiple breakpoints
 * - Clean event API for parent components
 * - RTL support for Hebrew interface
 * - Accessibility features and keyboard navigation
 * - Error handling and loading states
 */

import { CONFIG, ATTRIBUTES, DEFAULT_CATEGORIES } from './unified-recipe-filter-config.js';
import { styles } from './unified-recipe-filter-styles.js';
import { FilterUtils } from '../../../js/utils/filter-utils.js';

class UnifiedRecipeFilter extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // State management
    this.state = { ...CONFIG.DEFAULT_STATE };
    this.categories = DEFAULT_CATEGORIES;
    this.baseRecipes = [];
    this.userFavorites = [];
    this.layoutMode = CONFIG.LAYOUT_MODES.categoriesPage;
    this.isDisabled = false;

    // Component references
    this.searchBar = null;
    this.categoryNav = null;
    this.filterManager = null;

    // Bindings
    this.handleSearchInput = this.handleSearchInput.bind(this);
    this.handleCategoryChanged = this.handleCategoryChanged.bind(this);
    this.handleFilterApplied = this.handleFilterApplied.bind(this);
    this.handleFilterReset = this.handleFilterReset.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  static get observedAttributes() {
    return [
      ATTRIBUTES.currentCategory,
      ATTRIBUTES.searchQuery,
      ATTRIBUTES.currentFilters,
      ATTRIBUTES.hasActiveFilters,
      ATTRIBUTES.layoutMode,
      ATTRIBUTES.categories,
      ATTRIBUTES.baseRecipes,
      ATTRIBUTES.disabled,
      ATTRIBUTES.userFavorites,
    ];
  }

  async connectedCallback() {
    let resolveReady;
    this._readyPromise = new Promise((resolve) => (resolveReady = resolve));
    await this.importDependencies();
    await this.render();
    this.setupEventListeners();
    this.updateLayout();
    resolveReady();
  }

  disconnectedCallback() {
    this.removeEventListeners();
  }

  async waitForReady() {
    await (this._readyPromise ?? Promise.resolve());
    await Promise.all([
      this.categoryNav?.waitForReady?.() ?? Promise.resolve(),
      this.filterManager?.waitForReady?.() ?? Promise.resolve(),
    ]);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case ATTRIBUTES.currentCategory:
        this.state.currentCategory = newValue || 'all';
        this.updateCategoryNavigation();
        break;
      case ATTRIBUTES.searchQuery:
        this.state.searchQuery = newValue || '';
        this.updateSearchBar();
        break;
      case ATTRIBUTES.currentFilters:
        try {
          this.state.filters = newValue
            ? JSON.parse(newValue)
            : { ...CONFIG.DEFAULT_STATE.filters };
          this.state.hasActiveFilters = this.checkHasActiveFilters();
          this.updateFilterManager();
        } catch (error) {
          console.error('Error parsing filter data:', error);
        }
        break;
      case ATTRIBUTES.hasActiveFilters:
        this.state.hasActiveFilters = newValue === 'true';
        break;
      case ATTRIBUTES.layoutMode:
        this.layoutMode = newValue || CONFIG.LAYOUT_MODES.categoriesPage;
        this.updateLayout();
        break;
      case ATTRIBUTES.categories:
        try {
          this.categories = newValue ? JSON.parse(newValue) : DEFAULT_CATEGORIES;
          this.updateCategoryNavigation();
        } catch (error) {
          console.warn('Invalid categories JSON, using defaults:', error);
          this.categories = DEFAULT_CATEGORIES;
        }
        break;
      case ATTRIBUTES.baseRecipes:
        try {
          this.baseRecipes = newValue ? JSON.parse(newValue) : [];
          this.updateFilterManager();
        } catch (error) {
          console.warn('Invalid recipes JSON:', error);
          this.baseRecipes = [];
        }
        break;
      case ATTRIBUTES.disabled:
        this.isDisabled = newValue === 'true';
        this.updateDisabledState();
        break;
      case ATTRIBUTES.userFavorites:
        try {
          this.userFavorites = newValue ? JSON.parse(newValue) : [];
        } catch (error) {
          console.warn('Invalid user favorites JSON:', error);
          this.userFavorites = [];
        }
        break;
    }
  }

  async importDependencies() {
    try {
      // Import all required components
      await Promise.all([
        import('../../search/filter-search-bar/filter-search-bar.js'),
        import('../category-navigation/category-navigation.js'),
        import('../filter-manager/filter-manager.js'),
      ]);
    } catch (error) {
      console.error('Error importing dependencies:', error);
    }
  }

  async render() {
    try {
      // Load template
      const templateResponse = await fetch(
        new URL('./unified-recipe-filter.html', import.meta.url),
      );
      if (!templateResponse.ok) {
        throw new Error(`Failed to load template: ${templateResponse.status}`);
      }
      const template = await templateResponse.text();

      // Create complete HTML with styles
      this.shadowRoot.innerHTML = `
        <style>${styles}</style>
        ${template}
      `;

      // Get component references
      this.searchBar = this.shadowRoot.querySelector('filter-search-bar');
      this.categoryNav = this.shadowRoot.querySelector('category-navigation');
      this.filterManager = this.shadowRoot.querySelector('filter-manager');

      // Initialize component states
      this.initializeComponents();
      this.updateLayout();
    } catch (error) {
      console.error('Error rendering unified recipe filter:', error);
      this.shadowRoot.innerHTML = `
        <style>${styles}</style>
        <div class="unified-recipe-filter">
          <div class="error">${CONFIG.ERROR_MESSAGES.templateNotFound}</div>
        </div>
      `;
    }
  }

  initializeComponents() {
    // Initialize search bar
    if (this.searchBar) {
      this.searchBar.setValue(this.state.searchQuery);
    }

    // Initialize category navigation
    if (this.categoryNav) {
      this.categoryNav.setAttribute('current-category', this.state.currentCategory);
      this.categoryNav.setAttribute('categories', JSON.stringify(this.categories));
    }

    // Initialize filter manager
    if (this.filterManager) {
      this.filterManager.setAttribute('current-filters', JSON.stringify(this.state.filters));
      this.filterManager.setAttribute('has-active-filters', this.state.hasActiveFilters.toString());
      if (this.baseRecipes.length > 0) {
        this.filterManager.setBaseRecipes(this.baseRecipes);
      }
      this.filterManager.setCurrentCategory(this.state.currentCategory);
    }
  }

  setupEventListeners() {
    // Search bar events
    if (this.searchBar) {
      this.searchBar.addEventListener('search-input', this.handleSearchInput);
    }

    // Category navigation events
    if (this.categoryNav) {
      this.categoryNav.addEventListener('category-changed', this.handleCategoryChanged);
    }

    // Filter manager events
    if (this.filterManager) {
      this.filterManager.addEventListener('filter-applied', this.handleFilterApplied);
      this.filterManager.addEventListener('filter-reset', this.handleFilterReset);
    }

    // Window resize for responsive behavior
    window.addEventListener('resize', this.handleResize);
  }

  removeEventListeners() {
    if (this.searchBar) {
      this.searchBar.removeEventListener('search-input', this.handleSearchInput);
    }

    if (this.categoryNav) {
      this.categoryNav.removeEventListener('category-changed', this.handleCategoryChanged);
    }

    if (this.filterManager) {
      this.filterManager.removeEventListener('filter-applied', this.handleFilterApplied);
      this.filterManager.removeEventListener('filter-reset', this.handleFilterReset);
    }

    window.removeEventListener('resize', this.handleResize);
  }

  // Event handlers
  handleSearchInput(event) {
    const { searchText } = event.detail;
    const oldQuery = this.state.searchQuery;
    this.state.searchQuery = searchText;

    this.updateFilterManager();

    this.emitSearchChanged(oldQuery);
    this.emitStateChanged();
    this.emitFiltersChanged();
  }

  handleCategoryChanged(event) {
    const { category, categoryData, previousCategory } = event.detail;
    this.state.currentCategory = category;

    this.updateFilterManager();

    this.emitCategoryChanged(categoryData, previousCategory);
    this.emitStateChanged();
    this.emitFiltersChanged();
  }

  handleFilterApplied(event) {
    const { filters } = event.detail;
    this.state.filters = { ...filters };
    this.state.hasActiveFilters = this.checkHasActiveFilters();

    this.emitStateChanged();
    this.emitFiltersChanged();
  }

  handleFilterReset(event) {
    this.state.filters = { ...CONFIG.DEFAULT_STATE.filters };
    this.state.hasActiveFilters = false;

    this.emitStateChanged();
    this.emitFiltersChanged();
  }

  handleResize() {
    // Handle responsive behavior if needed
    this.updateLayout();
  }

  // State management methods
  checkHasActiveFilters() {
    const { filters } = this.state;
    return !!(
      filters.cookingTime ||
      filters.difficulty ||
      filters.mainIngredient ||
      (filters.tags && filters.tags.length > 0) ||
      filters.favoritesOnly
    );
  }

  applyAllFilters(recipes) {
    let filteredRecipes = [...recipes];

    // Apply search filter using shared optimized util
    if (this.state.searchQuery.trim()) {
      filteredRecipes = FilterUtils.searchRecipes(filteredRecipes, this.state.searchQuery);
    }

    // Apply category filter
    if (this.state.currentCategory && this.state.currentCategory !== 'all') {
      filteredRecipes = filteredRecipes.filter(
        (recipe) => recipe.category === this.state.currentCategory,
      );
    }

    // Apply advanced filters through filter manager
    if (this.filterManager && this.state.hasActiveFilters) {
      filteredRecipes = this.filterManager.applyFilters(filteredRecipes, this.userFavorites);
    }

    return filteredRecipes;
  }

  // Update methods
  updateSearchBar() {
    if (this.searchBar) {
      this.searchBar.setValue(this.state.searchQuery);
    }
  }

  updateCategoryNavigation() {
    if (this.categoryNav) {
      this.categoryNav.setAttribute('current-category', this.state.currentCategory);
      this.categoryNav.setAttribute('categories', JSON.stringify(this.categories));
    }
  }

  updateFilterManager() {
    if (this.filterManager) {
      this.filterManager.setAttribute('current-filters', JSON.stringify(this.state.filters));
      this.filterManager.setAttribute('has-active-filters', this.state.hasActiveFilters.toString());

      if (this.baseRecipes.length > 0) {
        this.filterManager.setBaseRecipes(this.baseRecipes);
      }

      const filteredRecipes = this.applyAllFilters(this.baseRecipes);
      this.filterManager.setFilteredRecipes(filteredRecipes);
    }
  }

  updateLayout() {
    const container = this.shadowRoot.querySelector('.unified-recipe-filter');
    if (!container) return;

    // Remove existing layout classes
    container.classList.remove('compact-layout', 'full-layout');

    // Add current layout class
    container.classList.add(`${this.layoutMode}-layout`);
  }

  updateDisabledState() {
    const container = this.shadowRoot.querySelector('.unified-recipe-filter');
    if (!container) return;

    if (this.isDisabled) {
      container.classList.add('disabled');
    } else {
      container.classList.remove('disabled');
    }

    // Update child components
    if (this.searchBar) {
      this.searchBar.disabled = this.isDisabled;
    }
    if (this.filterManager) {
      this.filterManager.setAttribute('disabled', this.isDisabled.toString());
    }
  }

  // Event emitters
  emitSearchChanged(previousQuery) {
    this.dispatchEvent(
      new CustomEvent(CONFIG.EVENTS.searchChanged, {
        detail: {
          searchQuery: this.state.searchQuery,
          previousQuery,
          category: this.state.currentCategory,
          filters: this.state.filters,
        },
        bubbles: true,
      }),
    );
  }

  emitCategoryChanged(categoryData, previousCategory) {
    this.dispatchEvent(
      new CustomEvent(CONFIG.EVENTS.categoryChanged, {
        detail: {
          category: this.state.currentCategory,
          categoryData,
          previousCategory,
          searchQuery: this.state.searchQuery,
          filters: this.state.filters,
        },
        bubbles: true,
      }),
    );
  }

  emitStateChanged() {
    this.dispatchEvent(
      new CustomEvent(CONFIG.EVENTS.stateChanged, {
        detail: {
          searchQuery: this.state.searchQuery,
          category: this.state.currentCategory,
          filters: this.state.filters,
          hasActiveFilters: this.state.hasActiveFilters,
        },
        bubbles: true,
      }),
    );
  }

  emitFiltersChanged() {
    const filteredRecipes =
      this.baseRecipes.length > 0 ? this.applyAllFilters(this.baseRecipes) : [];

    this.dispatchEvent(
      new CustomEvent(CONFIG.EVENTS.filtersChanged, {
        detail: {
          searchQuery: this.state.searchQuery,
          category: this.state.currentCategory,
          filters: this.state.filters,
          hasActiveFilters: this.state.hasActiveFilters,
          filteredRecipes,
        },
        bubbles: true,
      }),
    );
  }

  // Public API methods
  getState() {
    return { ...this.state };
  }

  setState(newState) {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...newState };

    // Update attributes to trigger change detection
    this.setAttribute(ATTRIBUTES.currentCategory, this.state.currentCategory);
    this.setAttribute(ATTRIBUTES.searchQuery, this.state.searchQuery);
    this.setAttribute(ATTRIBUTES.currentFilters, JSON.stringify(this.state.filters));
    this.setAttribute(ATTRIBUTES.hasActiveFilters, this.state.hasActiveFilters.toString());

    this.emitStateChanged();
  }

  getSearchQuery() {
    return this.state.searchQuery;
  }

  setSearchQuery(query) {
    this.setState({ searchQuery: query || '' });
  }

  getCurrentCategory() {
    return this.state.currentCategory;
  }

  setCurrentCategory(category) {
    this.setState({ currentCategory: category || 'all' });
  }

  getFilters() {
    return { ...this.state.filters };
  }

  setFilters(filters) {
    const newFilters = { ...CONFIG.DEFAULT_STATE.filters, ...filters };
    const hasActiveFilters = this.checkHasActiveFilters();
    this.setState({
      filters: newFilters,
      hasActiveFilters,
    });
  }

  resetAllFilters() {
    this.setState({
      searchQuery: '',
      currentCategory: 'all',
      filters: { ...CONFIG.DEFAULT_STATE.filters },
      hasActiveFilters: false,
    });
  }

  setBaseRecipes(recipes) {
    this.baseRecipes = Array.isArray(recipes) ? recipes : [];
    this.setAttribute(ATTRIBUTES.baseRecipes, JSON.stringify(this.baseRecipes));
  }

  getBaseRecipes() {
    return [...this.baseRecipes];
  }

  applyFilters(recipes = null) {
    const recipesToFilter = recipes || this.baseRecipes;
    return this.applyAllFilters(recipesToFilter);
  }

  setLayoutMode(mode) {
    if (Object.values(CONFIG.LAYOUT_MODES).includes(mode)) {
      this.layoutMode = mode;
      this.setAttribute(ATTRIBUTES.layoutMode, mode);
    }
  }

  getLayoutMode() {
    return this.layoutMode;
  }
}

// Register the custom element
customElements.define(CONFIG.COMPONENT_TAG, UnifiedRecipeFilter);

export default UnifiedRecipeFilter;
