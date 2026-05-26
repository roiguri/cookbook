/**
 * RecipeFilterComponent - Simplified
 * @class
 * @extends HTMLElement
 *
 * @description
 * A simplified custom web component that provides a modal interface for filtering recipes.
 * Uses provided recipes data and pure FilterUtils for filtering logic.
 * No Firebase dependencies - all data is provided externally.
 *
 * @dependencies
 * - Requires Modal component (`custom-modal`)
 * - FilterUtils for filtering logic
 * - Firebase Authentication only for user state (showing favorites filter)
 *
 * @example
 * // JavaScript usage
 * const filterComponent = document.querySelector('recipe-filter-component');
 *
 * // Set recipes data
 * filterComponent.setRecipes(recipesArray);
 *
 * // Set current filters
 * filterComponent.setCurrentFilters({
 *   cookingTime: '0-30',
 *   difficulty: 'קלה',
 *   tags: ['בריא', 'מהיר']
 * });
 *
 * // Open the filter modal
 * filterComponent.open();
 *
 * // Listen for filter events
 * filterComponent.addEventListener('filter-applied', (e) => {
 *   const { recipes, filters, count } = e.detail;
 *   // Handle filtered recipes
 * });
 *
 * @fires filter-applied - When filters are applied
 * @property {Array} detail.recipes - Filtered recipe objects
 * @property {Object} detail.filters - Applied filter values
 * @property {number} detail.count - Number of filtered recipes
 *
 * @fires filter-reset - When filters are reset
 * @property {Array} detail.recipes - All original recipes
 * @property {number} detail.count - Total number of recipes
 *
 * @methods
 * - setRecipes(recipes) - Set the recipes data to filter
 * - setCurrentFilters(filters) - Set current filter values
 * - getCurrentFilters() - Get current filter values
 * - getFilteredRecipes() - Get filtered recipes array
 * - open() - Opens the filter modal
 * - close() - Closes the filter modal
 */

import authService from '../../../js/services/auth/auth-service.js';
import favoritesService from '../../../js/services/users/favorites-service.js';
import { FilterUtils } from '../../../js/utils/filter-utils.js';

class RecipeFilterComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Initialize state - simplified
    this.recipes = []; // Provided externally
    this.filters = FilterUtils.createEmptyFilters();
    this.availableOptions = FilterUtils.extractFilterOptions([]);
    this.category = null;
    this.favoriteRecipeIds = []; // Cache for user's favorite recipe IDs
  }

  static get observedAttributes() {
    return [
      'category',
      'cooking-time-filter',
      'difficulty-filter',
      'ingredient-filter',
      'tags-filter',
      'favorites-filter',
      'current-filters',
      'recipes',
    ];
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.setupAuthObserver();
  }

  disconnectedCallback() {
    // Clean up auth observer
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
    }

    // Clean up timeouts
    if (this._filterChangeTimeout) {
      clearTimeout(this._filterChangeTimeout);
    }
  }

  setupAuthObserver() {
    // Listen for auth state changes to update UI accordingly
    this.authUnsubscribe = authService.addAuthObserver((authState) => {
      // Re-render to show/hide favorites filter based on auth state
      this.render();
      this.setupEventListeners();

      // If user logged out while modal is open, clear favorites filter and data
      if (!authState.user) {
        this.favoriteRecipeIds = [];
        if (this.filters.favoritesOnly) {
          this.filters.favoritesOnly = false;
          this.updateUI();
        }
      } else {
        // User logged in, clear cached favorites so they reload fresh
        this.favoriteRecipeIds = [];
      }
    });
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case 'category':
        this.category = newValue;
        break;
      case 'current-filters':
        if (newValue) {
          try {
            const filters = JSON.parse(newValue);
            this.filters = FilterUtils.validateFilters(filters);
            this.updateUI();
          } catch (error) {
            console.warn('Error parsing current-filters attribute:', error);
          }
        }
        break;
      case 'recipes':
        if (newValue) {
          try {
            const recipes = JSON.parse(newValue);
            this.setRecipes(recipes);
          } catch (error) {
            console.warn('Error parsing recipes attribute:', error);
          }
        }
        break;
      // Handle other attribute changes...
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${this.styles()}</style>
      <custom-modal height="auto" fullscreen-mobile>
        <div class="filter-container">
          ${this.renderHeader()}
          ${this.renderFilterGrid()}
          ${this.renderFooter()}
        </div>
      </custom-modal>
    `;
  }

  styles() {
    return `
      :host {
        --modal-max-width: 640px;
        --modal-mobile-width: 92vw;
        --modal-width: min(var(--modal-max-width), var(--modal-mobile-width));
      }

      custom-modal {
        width: var(--modal-width);
      }

      /* Modal wrapper — inherits shape from custom-modal */
      .filter-container {
        width: 100%;
        box-sizing: border-box;
      }

      /* Header — leave space for the close button (top-left in RTL) */
      .filter-header {
        padding: 24px 28px 0 68px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0;
      }

      .filter-header h2 {
        margin: 0 0 4px;
        font-family: var(--font-display-he, 'Noto Serif Hebrew', serif);
        font-style: italic;
        font-size: 28px;
        font-weight: 400;
        color: var(--ink-1, #1a1a1a);
        letter-spacing: -0.01em;
      }

      .results-counter {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-3, #7c7562);
        white-space: nowrap;
        margin-top: 2px;
      }

      /* Filter grid */
      .filter-grid {
        padding: 24px 28px;
        display: flex;
        flex-direction: column;
        gap: 24px;
        width: 100%;
        box-sizing: border-box;
      }

      /* Each filter group - no background, just label + content */
      .filter-section {
        width: 100%;
        min-width: 0;
      }

      .filter-section h3 {
        margin: 0 0 12px;
        font-family: var(--font-ui, system-ui, sans-serif);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-3, #7c7562);
      }

      .filter-content {
        width: 100%;
        box-sizing: border-box;
      }

      .searchable-select-container {
        width: 100%;
        box-sizing: border-box;
      }

      select, input[type="text"], input[list] {
        width: 100%;
        padding: 9px 14px;
        border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
        border-radius: var(--r-pill, 999px);
        background: var(--surface-0, #faf6ec);
        font-family: var(--font-ui, system-ui, sans-serif);
        font-size: 13px;
        color: var(--ink-1, #1a1a1a);
        margin: 0;
        box-sizing: border-box;
        outline: none;
        transition: border-color var(--dur-1, 160ms) ease, box-shadow var(--dur-1, 160ms) ease;
        appearance: none;
      }

      select {
        background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e");
        background-repeat: no-repeat;
        background-position: left 12px center;
        background-size: 16px;
        padding-left: 36px;
      }

      select:focus, input[type="text"]:focus, input[list]:focus {
        border-color: var(--primary, #6a994e);
        box-shadow: 0 0 0 3px rgba(106, 153, 78, 0.12);
      }

      .tags-container {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
        min-height: 28px;
      }

      .tag {
        background: var(--surface-0, #faf6ec);
        border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
        padding: 5px 10px 5px 12px;
        border-radius: var(--r-pill, 999px);
        font-family: var(--font-ui, system-ui, sans-serif);
        font-size: 12.5px;
        color: var(--ink-1, #1a1a1a);
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .tag-remove {
        cursor: pointer;
        color: var(--ink-3, #7c7562);
        font-size: 14px;
        line-height: 1;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        padding: 0;
      }

      .tag-remove:hover {
        background: var(--hairline, rgba(31, 29, 24, 0.12));
        color: var(--ink-1, #1a1a1a);
      }

      /* Footer */
      .filter-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 14px 28px;
        background: var(--surface-2, #f2e8cf);
        border-radius: var(--r-xl, 20px);
        flex-shrink: 0;
      }

      button {
        border: none;
        border-radius: var(--r-sm, 8px);
        cursor: pointer;
        font-weight: 500;
        font-family: var(--font-ui, system-ui, sans-serif);
        transition: opacity var(--dur-1, 160ms) ease, background var(--dur-1, 160ms) ease;
      }

      .apply-btn {
        background: var(--primary, #6a994e);
        color: white;
        padding: 11px 22px;
        font-size: 13.5px;
      }

      .apply-btn:hover:not(:disabled) {
        background: var(--primary-dark, #386641);
      }

      .apply-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .clear-btn {
        background: transparent;
        color: var(--ink-3, #7c7562);
        padding: 0;
        font-size: 13px;
        text-decoration: underline;
        text-underline-offset: 2px;
        border: none;
      }

      .clear-btn:hover {
        color: var(--ink-1, #1a1a1a);
      }

      .loading-text {
        padding: 8px;
        text-align: center;
        color: var(--ink-3, #7c7562);
        font-style: italic;
        font-size: 0.9rem;
      }

      .favorites-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-family: var(--font-ui, system-ui, sans-serif);
        font-size: 13px;
      }

      .favorites-checkbox input[type="checkbox"] {
        width: auto;
        margin: 0;
        accent-color: var(--primary, #6a994e);
      }

      .checkmark {
        display: none;
      }

      .checkbox-label {
        color: var(--ink-2, #3a3a3a);
      }

      /* Custom scrollbar */
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }

      ::-webkit-scrollbar-track {
        background: var(--surface-2, #f2e8cf);
      }

      ::-webkit-scrollbar-thumb {
        background: var(--hairline-strong, rgba(31, 29, 24, 0.2));
        border-radius: 3px;
      }

      ::-webkit-scrollbar-thumb:hover {
        background: var(--ink-3, #7c7562);
      }

      @media (max-width: 768px) {
        .filter-header {
          padding: 20px 20px 0;
        }

        .filter-header h2 {
          font-size: 24px;
        }

        .filter-grid {
          padding: 20px 20px;
          gap: 20px;
        }

        .filter-footer {
          padding: 14px 20px;
        }
      }
    `;
  }

  renderHeader() {
    const matchingCount = this.getMatchingCount();
    return `
      <div class="filter-header">
        <div>
          <p class="results-counter">${matchingCount} מתכונים תואמים</p>
          <h2>סינון מתכונים</h2>
        </div>
      </div>
    `;
  }

  renderFilterGrid() {
    const user = authService.getCurrentUser();
    return `
      <div class="filter-grid">
        ${this.getAttribute('cooking-time-filter') !== 'false' ? this.renderCookingTimeFilter() : ''}
        ${this.getAttribute('difficulty-filter') !== 'false' ? this.renderDifficultyFilter() : ''}
        ${this.getAttribute('ingredient-filter') !== 'false' ? this.renderIngredientFilter() : ''}
        ${this.getAttribute('tags-filter') !== 'false' ? this.renderTagsFilter() : ''}
        ${user && this.getAttribute('favorites-filter') !== 'false' ? this.renderFavoritesFilter() : ''}
      </div>
    `;
  }

  renderCookingTimeFilter() {
    return `
      <div class="filter-section">
        <h3>זמן הכנה</h3>
        <div class="filter-content">
          <select id="cooking-time">
            <option value="">הכל</option>
            <option value="0-30" ${this.filters.cookingTime === '0-30' ? 'selected' : ''}>0-30 דקות</option>
            <option value="31-60" ${this.filters.cookingTime === '31-60' ? 'selected' : ''}>31-60 דקות</option>
            <option value="61" ${this.filters.cookingTime === '61' ? 'selected' : ''}>מעל שעה</option>
          </select>
        </div>
      </div>
    `;
  }

  renderDifficultyFilter() {
    return `
      <div class="filter-section">
        <h3>רמת קושי</h3>
        <div class="filter-content">
          <select id="difficulty">
            <option value="">הכל</option>
            <option value="קלה" ${this.filters.difficulty === 'קלה' ? 'selected' : ''}>קלה</option>
            <option value="בינונית" ${this.filters.difficulty === 'בינונית' ? 'selected' : ''}>בינונית</option>
            <option value="קשה" ${this.filters.difficulty === 'קשה' ? 'selected' : ''}>קשה</option>
          </select>
        </div>
      </div>
    `;
  }

  renderIngredientFilter() {
    return `
      <div class="filter-section">
        <h3>מרכיב עיקרי</h3>
        <div class="filter-content">
          <select id="main-ingredient">
            <option value="">הכל</option>
            ${this.availableOptions.mainIngredients
              .map(
                (ingredient) =>
                  `<option value="${ingredient}" ${this.filters.mainIngredient === ingredient ? 'selected' : ''}>
                ${ingredient}
              </option>`,
              )
              .join('')}
          </select>
        </div>
      </div>
    `;
  }

  renderTagsFilter() {
    return `
      <div class="filter-section">
        <h3>תגיות</h3>
        <div class="filter-content">
          <div class="searchable-select-container">
            <input 
              list="tags-list" 
              id="tags-select" 
              placeholder="חפש והוסף תגיות..."
              autocomplete="off"
            >
            <datalist id="tags-list">
              ${this.availableOptions.tags
                .filter((tag) => !this.filters.tags.includes(tag))
                .map((tag) => `<option value="${tag}">`)
                .join('')}
            </datalist>
          </div>
          <div class="tags-container">
            ${this.filters.tags
              .map(
                (tag) => `
              <span class="tag">
                ${tag}
                <span class="tag-remove" data-tag="${tag}">×</span>
              </span>
            `,
              )
              .join('')}
          </div>
        </div>
      </div>
    `;
  }

  renderFavoritesFilter() {
    return `
      <div class="filter-section">
        <h3>מועדפים</h3>
        <div class="filter-content">
          <label class="favorites-checkbox">
            <input 
              type="checkbox" 
              id="favorites-only"
              ${this.filters.favoritesOnly ? 'checked' : ''}
            >
            <span class="checkmark"></span>
            <span class="checkbox-label">הצג רק מועדפים</span>
          </label>
        </div>
      </div>
    `;
  }

  renderFooter() {
    return `
      <div class="filter-footer">
        <button class="clear-btn">אפס הכל</button>
        <button class="apply-btn">הצג תוצאות</button>
      </div>
    `;
  }

  renderLoading() {
    return `<div class="loading-indicator"></div>`;
  }

  setupEventListeners() {
    const modal = this.shadowRoot.querySelector('custom-modal');

    // Filter change listeners
    ['cooking-time', 'difficulty', 'main-ingredient'].forEach((id) => {
      const select = this.shadowRoot.getElementById(id);
      if (select) {
        select.addEventListener('change', () => this.handleFilterChange());
      }
    });

    // Favorites checkbox listener
    const favoritesCheckbox = this.shadowRoot.getElementById('favorites-only');
    if (favoritesCheckbox) {
      favoritesCheckbox.addEventListener('change', () => this.handleFilterChange());
    }

    // Tags input handler
    const tagsSelect = this.shadowRoot.getElementById('tags-select');
    if (tagsSelect) {
      // Handle both input and change events for datalist
      tagsSelect.addEventListener('input', (e) => {
        const selectedTag = e.target.value.trim();
        if (
          selectedTag &&
          this.availableOptions.tags.includes(selectedTag) &&
          !this.filters.tags.includes(selectedTag)
        ) {
          this.addTag(selectedTag);
          e.target.value = ''; // Clear input after selection
        }
      });

      tagsSelect.addEventListener('change', (e) => {
        const selectedTag = e.target.value.trim();
        if (selectedTag && !this.filters.tags.includes(selectedTag)) {
          this.addTag(selectedTag);
          e.target.value = ''; // Clear input after selection
        }
      });

      // Handle Enter key
      tagsSelect.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const inputValue = e.target.value.trim();
          if (inputValue && !this.filters.tags.includes(inputValue)) {
            this.addTag(inputValue);
            e.target.value = ''; // Clear input after adding
          }
          e.preventDefault(); // Prevent form submission
        }
      });
    }

    // Tag removal
    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target.classList.contains('tag-remove')) {
        const tag = e.target.dataset.tag;
        this.removeTag(tag);
      }
    });

    // Button listeners
    const applyBtn = this.shadowRoot.querySelector('.apply-btn');
    const clearBtn = this.shadowRoot.querySelector('.clear-btn');

    if (applyBtn) {
      applyBtn.addEventListener('click', () => this.applyFilters());
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearFilters());
    }
  }

  addTag(tag) {
    if (!this.filters.tags.includes(tag)) {
      this.filters.tags.push(tag);
      this.updateTagsDisplay();
      this.handleFilterChange();
    }
  }

  removeTag(tag) {
    this.filters.tags = this.filters.tags.filter((t) => t !== tag);
    this.updateTagsDisplay();
    this.handleFilterChange();
  }

  // Simplified: Set recipes and extract filter options
  setRecipes(recipes) {
    this.recipes = recipes || [];
    this.availableOptions = FilterUtils.extractFilterOptions(this.recipes);
    this.updateUI();
  }

  handleFilterChange() {
    this.updateFilterState();
    // Use debouncing to prevent too many rapid updates
    if (this._filterChangeTimeout) {
      clearTimeout(this._filterChangeTimeout);
    }

    this._filterChangeTimeout = setTimeout(async () => {
      // If favorites filter is enabled, ensure we have favorites data
      if (this.filters.favoritesOnly && this.favoriteRecipeIds.length === 0) {
        this.favoriteRecipeIds = await favoritesService.getUserFavorites();
      }
      this.updateCounter();
    }, 300); // 300ms debounce
  }

  updateFilterState() {
    const cookingTime = this.shadowRoot.getElementById('cooking-time')?.value || '';
    const difficulty = this.shadowRoot.getElementById('difficulty')?.value || '';
    const mainIngredient = this.shadowRoot.getElementById('main-ingredient')?.value || '';
    const favoritesOnly = this.shadowRoot.getElementById('favorites-only')?.checked || false;

    this.filters = {
      ...this.filters,
      cookingTime,
      difficulty,
      mainIngredient,
      favoritesOnly,
    };
  }

  // Simplified: Calculate matching count from current recipes
  getMatchingCount() {
    if (!this.recipes || this.recipes.length === 0) {
      return 0;
    }
    return FilterUtils.applyFilters(this.recipes, this.filters, this.favoriteRecipeIds).length;
  }

  // Simplified: Use FilterUtils for filtering
  applyCurrentFilters() {
    return FilterUtils.applyFilters(this.recipes, this.filters, this.favoriteRecipeIds);
  }

  applyFilters() {
    const filteredRecipes = this.applyCurrentFilters();

    this.dispatchEvent(
      new CustomEvent('filter-applied', {
        bubbles: true,
        composed: true,
        detail: {
          recipes: filteredRecipes,
          filters: { ...this.filters, category: this.category },
          count: filteredRecipes.length,
        },
      }),
    );
    this.close();
  }

  clearFilters() {
    // Reset filter state
    this.filters = FilterUtils.createEmptyFilters();

    // Reset UI elements
    const selects = ['cooking-time', 'difficulty', 'main-ingredient'];
    selects.forEach((id) => {
      const select = this.shadowRoot.getElementById(id);
      if (select) select.value = '';
    });

    // Clear favorites checkbox
    const favoritesCheckbox = this.shadowRoot.getElementById('favorites-only');
    if (favoritesCheckbox) favoritesCheckbox.checked = false;

    // Clear tags input
    const tagsSelect = this.shadowRoot.getElementById('tags-select');
    if (tagsSelect) tagsSelect.value = '';

    // Close the modal to re-enable scrolling
    this.close();

    // Update UI
    this.updateUI();

    // Dispatch reset event with all recipes (unfiltered)
    this.dispatchEvent(
      new CustomEvent('filter-reset', {
        bubbles: true,
        composed: true,
        detail: {
          recipes: this.recipes,
          category: this.category,
          count: this.recipes.length,
        },
      }),
    );
  }

  updateUI() {
    // Simple UI update - just re-render
    this.render();
    this.setupEventListeners();
  }

  updateCounter() {
    const counter = this.shadowRoot.querySelector('.results-counter');
    if (counter) {
      const count = this.getMatchingCount();
      counter.textContent = `${count} מתכונים תואמים`;
    }
  }

  updateTagsDisplay() {
    const tagsContainer = this.shadowRoot.querySelector('.tags-container');
    if (tagsContainer) {
      tagsContainer.innerHTML = this.filters.tags
        .map(
          (tag) => `
        <span class="tag">
          ${tag}
          <span class="tag-remove" data-tag="${tag}">×</span>
        </span>
      `,
        )
        .join('');
    }

    // Update available options in datalist
    const datalist = this.shadowRoot.getElementById('tags-list');
    if (datalist) {
      datalist.innerHTML = this.availableOptions.tags
        .filter((tag) => !this.filters.tags.includes(tag))
        .map((tag) => `<option value="${tag}">`)
        .join('');
    }
  }

  // Public API methods for external control
  setCurrentFilters(filters) {
    this.filters = FilterUtils.validateFilters(filters);
    this.updateUI();
  }

  setCategory(category) {
    this.category = category;
  }

  getCurrentFilters() {
    return { ...this.filters };
  }

  getFilteredRecipes() {
    return this.applyCurrentFilters();
  }

  // Public methods
  async open() {
    // If favorites filter is enabled, ensure we have favorites data
    if (this.filters.favoritesOnly) {
      this.favoriteRecipeIds = await favoritesService.getUserFavorites();
      this.updateUI(); // Update counter after loading favorites
    }

    const modal = this.shadowRoot.querySelector('custom-modal');
    if (modal) modal.open();
  }

  close() {
    const modal = this.shadowRoot.querySelector('custom-modal');
    if (modal) modal.close();
  }
}

customElements.define('recipe-filter-component', RecipeFilterComponent);
