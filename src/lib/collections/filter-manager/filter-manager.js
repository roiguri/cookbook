/**
 * Filter Manager Web Component
 * Manages filter state, UI, and modal interactions for recipe filtering
 *
 * Architecture: Separated HTML, CSS, and JS files
 * - filter-manager.html: HTML template
 * - filter-manager-styles.js: Component styles
 * - filter-manager-config.js: Configuration constants
 * - filter-manager.js: Component logic (this file)
 *
 * @attributes
 * - current-filters: JSON string of current filter state
 * - has-active-filters: Boolean indicating if any filters are active
 * - show-badge: Boolean to show/hide the filter count badge
 * - disabled: Boolean to disable filter functionality
 *
 * @events
 * - filters-changed: Emitted when filter state changes
 *   detail: { filters: Object, hasActiveFilters: boolean }
 * - filter-modal-requested: Emitted when filter modal should open
 *   detail: { filters: Object, recipes: Array, category: string }
 *
 * @features
 * - Filter state management and persistence
 * - Filter badge with active filter count
 * - Integration with filter modal component
 * - Filter application logic for recipes
 * - URL parameter synchronization
 * - Authentication integration for favorites
 * - RTL support for Hebrew interface
 */

import { CONFIG, ATTRIBUTES } from './filter-manager-config.js';
import { styles } from './filter-manager-styles.js';

class FilterManager extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // State
    this.activeFilters = { ...CONFIG.DEFAULT_FILTERS };
    this.hasActiveFilters = false;
    this.isDisabled = false;
    this.baseRecipes = [];
    this.filteredRecipes = [];
    this.currentCategory = 'all';
    this.currentSearchQuery = '';

    // Bindings
    this.handleFilterButtonClick = this.handleFilterButtonClick.bind(this);
    this.handleFilterModalApplied = this.handleFilterModalApplied.bind(this);
    this.handleFilterModalReset = this.handleFilterModalReset.bind(this);
  }

  async importModalComponent() {
    try {
      await import('../../../lib/modals/filter_modal/filter_modal.js');
    } catch (error) {
      console.error('Error importing filter modal component:', error);
    }
  }

  static get observedAttributes() {
    return [
      ATTRIBUTES.currentFilters,
      ATTRIBUTES.hasActiveFilters,
      ATTRIBUTES.showBadge,
      ATTRIBUTES.disabled,
    ];
  }

  async connectedCallback() {
    let resolveReady;
    this._readyPromise = new Promise((resolve) => (resolveReady = resolve));
    await this.importModalComponent();
    await this.render();
    this.setupEventListeners();
    this.updateUI();
    resolveReady();
  }

  disconnectedCallback() {
    this.removeEventListeners();
  }

  waitForReady() {
    return this._readyPromise ?? Promise.resolve();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case ATTRIBUTES.currentFilters:
        try {
          if (newValue) {
            this.activeFilters = JSON.parse(newValue);
          } else {
            this.activeFilters = { ...CONFIG.DEFAULT_FILTERS };
          }
          this.hasActiveFilters = this.checkHasActiveFilters();
          if (this.shadowRoot.innerHTML) {
            this.updateBadge();
          }
        } catch (error) {
          console.error('Error parsing filter data:', error);
        }
        break;
      case ATTRIBUTES.hasActiveFilters:
        this.hasActiveFilters = newValue === 'true';
        if (this.shadowRoot.innerHTML) {
          this.updateBadge();
        }
        break;
      case ATTRIBUTES.showBadge:
        if (this.shadowRoot.innerHTML) {
          this.updateBadge();
        }
        break;
      case ATTRIBUTES.disabled:
        this.isDisabled = newValue === 'true';
        if (this.shadowRoot.innerHTML) {
          this.updateButtonState();
        }
        break;
    }
  }

  async render() {
    try {
      // Load template
      const templateResponse = await fetch(new URL('./filter-manager.html', import.meta.url));
      if (!templateResponse.ok) {
        throw new Error(`Failed to load template: ${templateResponse.status}`);
      }
      const template = await templateResponse.text();

      // Create complete HTML with styles
      this.shadowRoot.innerHTML = `
        <style>${styles}</style>
        ${template}
      `;
      if (this.getAttribute('favorites-filter') === 'false') {
        this.shadowRoot.querySelector('.filter-modal')?.setAttribute('favorites-filter', 'false');
      }

      this.updateUI();
    } catch (error) {
      console.error('Error rendering filter manager:', error);
      this.shadowRoot.innerHTML = `
        <style>${styles}</style>
        <div class="filter-manager">
          <div class="error">${CONFIG.ERROR_MESSAGES.modalNotFound}</div>
        </div>
      `;
    }
  }

  updateUI() {
    this.updateBadge();
    this.updateButtonState();
  }

  updateBadge() {
    const badge = this.shadowRoot.querySelector('.filter-badge');
    if (!badge) return;

    const showBadge = this.getAttribute(ATTRIBUTES.showBadge) !== 'false';
    const activeCount = this.countActiveFilters();

    if (showBadge && activeCount > 0) {
      badge.textContent = activeCount.toString();
      badge.classList.add('visible');
      badge.setAttribute('aria-label', `${activeCount} מסננים פעילים`);
    } else {
      badge.classList.remove('visible');
      badge.removeAttribute('aria-label');
    }
  }

  updateButtonState() {
    const button = this.shadowRoot.querySelector('.filter-button');
    if (!button) return;

    button.disabled = this.isDisabled;

    if (this.isDisabled) {
      button.setAttribute('aria-disabled', 'true');
    } else {
      button.removeAttribute('aria-disabled');
    }
  }

  setupEventListeners() {
    const filterButton = this.shadowRoot.querySelector('.filter-button');
    if (filterButton) {
      filterButton.addEventListener('click', this.handleFilterButtonClick);
    }

    const filterModal = this.shadowRoot.querySelector('.filter-modal');
    if (filterModal) {
      filterModal.addEventListener('filter-applied', this.handleFilterModalApplied);
      filterModal.addEventListener('filter-reset', this.handleFilterModalReset);
    }
  }

  removeEventListeners() {
    const filterButton = this.shadowRoot.querySelector('.filter-button');
    if (filterButton) {
      filterButton.removeEventListener('click', this.handleFilterButtonClick);
    }

    const filterModal = this.shadowRoot.querySelector('.filter-modal');
    if (filterModal) {
      filterModal.removeEventListener('filter-applied', this.handleFilterModalApplied);
      filterModal.removeEventListener('filter-reset', this.handleFilterModalReset);
    }
  }

  handleFilterButtonClick(event) {
    event.preventDefault();

    if (this.isDisabled) return;

    this.openFilterModal();
  }

  openFilterModal() {
    const filterModal = this.shadowRoot.querySelector('.filter-modal');
    if (!filterModal) {
      console.error('Filter modal not found in shadow DOM');
      return;
    }

    if (this.hasActiveFilters) {
      filterModal.setAttribute('current-filters', JSON.stringify(this.activeFilters));
    } else {
      filterModal.removeAttribute('current-filters');
    }

    // Use filtered recipes if available, otherwise fall back to base recipes
    const recipesToUse = this.filteredRecipes.length > 0 ? this.filteredRecipes : this.baseRecipes;
    if (recipesToUse.length > 0) {
      filterModal.setAttribute('recipes', JSON.stringify(recipesToUse));
    }

    if (this.currentCategory !== 'all') {
      filterModal.setAttribute('category', this.currentCategory);
    } else {
      filterModal.removeAttribute('category');
    }

    if (typeof filterModal.open === 'function') {
      filterModal.open();
    }

    this.dispatchEvent(
      new CustomEvent(CONFIG.EVENTS.filterModalRequested, {
        detail: {
          filters: this.activeFilters,
          recipes: this.baseRecipes,
          category: this.currentCategory,
        },
        bubbles: true,
      }),
    );
  }

  handleFilterModalApplied(event) {
    const { recipes, filters } = event.detail;
    this.setFiltersInternal(filters);

    this.dispatchEvent(
      new CustomEvent(CONFIG.EVENTS.filterApplied, {
        detail: { recipes, filters, hasActiveFilters: this.hasActiveFilters },
        bubbles: true,
      }),
    );
  }

  handleFilterModalReset() {
    this.setFiltersInternal({});

    this.dispatchEvent(
      new CustomEvent(CONFIG.EVENTS.filterReset, {
        detail: { filters: this.activeFilters, hasActiveFilters: false },
        bubbles: true,
      }),
    );
  }

  // Filter state management methods
  checkHasActiveFilters() {
    return !!(
      this.activeFilters.cookingTime ||
      this.activeFilters.difficulty ||
      this.activeFilters.mainIngredient ||
      (this.activeFilters.tags && this.activeFilters.tags.length > 0) ||
      this.activeFilters.favoritesOnly
    );
  }

  countActiveFilters() {
    let count = 0;
    if (this.activeFilters.cookingTime) count++;
    if (this.activeFilters.difficulty) count++;
    if (this.activeFilters.mainIngredient) count++;
    if (this.activeFilters.tags && this.activeFilters.tags.length > 0) count++;
    if (this.activeFilters.favoritesOnly) count++;
    return count;
  }

  // Filter application logic
  applyFilters(recipes, userFavorites = []) {
    if (!this.hasActiveFilters) {
      return recipes;
    }

    const { cookingTime, difficulty, mainIngredient, tags, favoritesOnly } = this.activeFilters;

    let filteredRecipes = recipes.filter((recipe) => {
      // Cooking time filter
      if (cookingTime) {
        const totalTime = (recipe.prepTime || 0) + (recipe.waitTime || 0);
        const range = CONFIG.COOKING_TIME_RANGES[cookingTime];
        if (range && (totalTime < range.min || totalTime > range.max)) {
          return false;
        }
      }

      // Difficulty filter
      if (difficulty && recipe.difficulty !== difficulty) {
        return false;
      }

      // Main ingredient filter
      if (mainIngredient && recipe.mainIngredient !== mainIngredient) {
        return false;
      }

      // Tags filter (must match all selected tags)
      if (tags && tags.length > 0) {
        const recipeTags = recipe.tags || [];
        if (!tags.every((tag) => recipeTags.includes(tag))) {
          return false;
        }
      }

      return true;
    });

    // Favorites filter
    if (favoritesOnly && userFavorites.length > 0) {
      filteredRecipes = filteredRecipes.filter((recipe) => userFavorites.includes(recipe.id));
    }

    return filteredRecipes;
  }

  // Public API methods
  getFilters() {
    return { ...this.activeFilters };
  }

  setFiltersInternal(filters) {
    this.activeFilters = { ...CONFIG.DEFAULT_FILTERS, ...filters };
    this.hasActiveFilters = this.checkHasActiveFilters();
    this.updateUI();

    // Update attribute for external synchronization
    this.setAttribute(ATTRIBUTES.currentFilters, JSON.stringify(this.activeFilters));
    this.setAttribute(ATTRIBUTES.hasActiveFilters, this.hasActiveFilters.toString());
  }

  setFilters(filters) {
    this.setFiltersInternal(filters);

    // Emit change event
    this.dispatchEvent(
      new CustomEvent(CONFIG.EVENTS.filtersChanged, {
        detail: { filters: this.activeFilters, hasActiveFilters: this.hasActiveFilters },
        bubbles: true,
      }),
    );
  }

  resetFilters() {
    this.setFilters({});
  }

  setBaseRecipes(recipes) {
    this.baseRecipes = Array.isArray(recipes) ? recipes : [];
  }

  setFilteredRecipes(recipes) {
    this.filteredRecipes = Array.isArray(recipes) ? recipes : [];
  }

  setCurrentCategory(category) {
    this.currentCategory = category || 'all';
  }

  setCurrentSearchQuery(query) {
    this.currentSearchQuery = query || '';
  }

  activateFavoritesFilter() {
    this.setFilters({ ...this.activeFilters, favoritesOnly: true });
  }

  hasAnyActiveFilters() {
    return this.hasActiveFilters;
  }

  getActiveFilterCount() {
    return this.countActiveFilters();
  }

  isFilterActive(filterType) {
    switch (filterType) {
      case CONFIG.FILTER_TYPES.cookingTime:
        return !!this.activeFilters.cookingTime;
      case CONFIG.FILTER_TYPES.difficulty:
        return !!this.activeFilters.difficulty;
      case CONFIG.FILTER_TYPES.mainIngredient:
        return !!this.activeFilters.mainIngredient;
      case CONFIG.FILTER_TYPES.tags:
        return this.activeFilters.tags && this.activeFilters.tags.length > 0;
      case CONFIG.FILTER_TYPES.favoritesOnly:
        return !!this.activeFilters.favoritesOnly;
      default:
        return false;
    }
  }
}

// Register the custom element
customElements.define(CONFIG.COMPONENT_TAG, FilterManager);

export default FilterManager;
