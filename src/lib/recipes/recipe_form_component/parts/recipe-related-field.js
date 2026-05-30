import { RecipeService } from '../../../../js/services/recipes/recipe-service.js';
import {
  formatRecipeData,
  getLocalizedCategoryName,
} from '../../../../js/utils/recipes/recipe-data-utils.js';
import styles from '../recipe_form_component.css?inline';
import { FormFieldMixin } from '../../../forms/form-field-base.js';

const MAX_RELATED = 4;
const SEARCH_DELAY_MS = 300;

class RecipeRelatedField extends FormFieldMixin(HTMLElement) {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._selected = []; // [{id, name}]
    this._searchTimeout = null;
    this._excludeId = null; // current recipe's own ID (set by parent)
    this._isDisabled = false; // form-level disabled state (persists across re-renders)
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <style>${this._ownStyles()}</style>
      <div class="related-field recipe-form__group">
        <p class="recipe-form__hint">ניתן לקשר עד ${MAX_RELATED} מתכונים</p>
        <div class="related-search">
          <input
            type="text"
            class="recipe-form__input related-search__input"
            placeholder="הקלד שם מתכון לחיפוש..."
            autocomplete="off"
            id="related-search-input"
          />
          <ul class="related-search__dropdown" id="related-dropdown" hidden></ul>
        </div>
        <div class="related-chips" id="related-chips"></div>
      </div>
    `;
    this._setupListeners();
  }

  _ownStyles() {
    return `
      .related-field { position: relative; }

      .related-search { position: relative; }

      .related-search__dropdown {
        position: fixed;
        z-index: 9999;
        background: var(--surface-0, #fff);
        border: 1px solid var(--hairline, rgba(0,0,0,.12));
        border-radius: var(--r-md, 12px);
        box-shadow: var(--shadow-2);
        padding: 4px 0;
        list-style: none;
        margin: 0;
        max-height: 220px;
        overflow-y: auto;
      }

      .related-search__item {
        padding: 10px 16px;
        cursor: pointer;
        font-family: var(--font-ui);
        font-size: var(--step--1);
        color: var(--ink-1);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .related-search__item:hover,
      .related-search__item:focus {
        background: var(--surface-2, #f5f5f5);
        outline: none;
      }

      .related-search__item-cat {
        font-size: 11px;
        color: var(--ink-3);
        font-family: var(--font-mono);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .related-search__empty {
        padding: 10px 16px;
        font-size: var(--step--1);
        color: var(--ink-3);
        font-family: var(--font-ui);
      }

      .related-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px 4px 12px;
        background: var(--surface-2, #f5f5f5);
        border: 1px solid var(--hairline);
        border-radius: var(--r-pill, 999px);
        font-family: var(--font-ui);
        font-size: var(--step--1);
        color: var(--ink-1);
      }

      .chip__remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--ink-3);
        border-radius: 50%;
        padding: 0;
        font-size: 14px;
        line-height: 1;
        transition: background var(--dur-1, 160ms);
      }

      .chip__remove:hover {
        background: var(--hairline);
        color: var(--ink-1);
      }
    `;
  }

  _setupListeners() {
    const input = this.shadowRoot.getElementById('related-search-input');
    const dropdown = this.shadowRoot.getElementById('related-dropdown');

    input.addEventListener('input', () => {
      clearTimeout(this._searchTimeout);
      const term = input.value.trim();
      if (term.length < 2) {
        dropdown.hidden = true;
        return;
      }
      this._searchTimeout = setTimeout(() => this._search(term), SEARCH_DELAY_MS);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.hidden = true;
      }, 150);
    });

    input.addEventListener('focus', () => {
      if (!dropdown.hidden) this._positionDropdown();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdown.hidden = true;
        input.blur();
      }
    });

    // Reposition on scroll/resize so the fixed dropdown tracks the input
    this._reposition = () => {
      if (!dropdown.hidden) this._positionDropdown();
    };
    window.addEventListener('scroll', this._reposition, { passive: true, capture: true });
    window.addEventListener('resize', this._reposition, { passive: true });
  }

  disconnectedCallback() {
    if (this._reposition) {
      window.removeEventListener('scroll', this._reposition, { capture: true });
      window.removeEventListener('resize', this._reposition);
    }
  }

  async _search(term) {
    const dropdown = this.shadowRoot.getElementById('related-dropdown');
    const searchTerms = term.toLowerCase().trim().split(/\s+/);

    try {
      const results = await RecipeService.list({
        where: [['approved', '==', true]],
      });

      const filtered = results.filter((doc) => {
        if (doc.id === this._excludeId) return false;
        if (this._selected.some((s) => s.id === doc.id)) return false;
        const searchable = [doc.name, doc.category, ...(doc.tags || [])].join(' ').toLowerCase();
        return searchTerms.every((t) => searchable.includes(t));
      });

      this._renderDropdown(filtered.slice(0, 6));
    } catch {
      dropdown.hidden = true;
    }
  }

  _positionDropdown() {
    const input = this.shadowRoot.getElementById('related-search-input');
    const dropdown = this.shadowRoot.getElementById('related-dropdown');
    if (!input || !dropdown) return;

    const rect = input.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  _renderDropdown(recipes) {
    const dropdown = this.shadowRoot.getElementById('related-dropdown');
    dropdown.innerHTML = '';

    if (!recipes.length) {
      const empty = document.createElement('li');
      empty.className = 'related-search__empty';
      empty.textContent = 'לא נמצאו מתכונים';
      dropdown.appendChild(empty);
      this._positionDropdown();
      dropdown.hidden = false;
      return;
    }

    recipes.forEach((recipe) => {
      const li = document.createElement('li');
      li.className = 'related-search__item';
      li.setAttribute('tabindex', '0');
      li.innerHTML = `
        <span>${recipe.name}</span>
        <span class="related-search__item-cat">${getLocalizedCategoryName(recipe.category)}</span>
      `;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent input blur before selection
        this._select({ id: recipe.id, name: recipe.name });
      });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._select({ id: recipe.id, name: recipe.name });
      });
      dropdown.appendChild(li);
    });

    this._positionDropdown();
    dropdown.hidden = false;
  }

  _select(recipe) {
    if (this._selected.length >= MAX_RELATED) return;
    if (this._selected.some((s) => s.id === recipe.id)) return;

    this._selected.push(recipe);
    this._renderChips();
    this._dispatchChange();

    const input = this.shadowRoot.getElementById('related-search-input');
    const dropdown = this.shadowRoot.getElementById('related-dropdown');
    input.value = '';
    dropdown.hidden = true;
  }

  _remove(id) {
    this._selected = this._selected.filter((s) => s.id !== id);
    this._renderChips();
    this._dispatchChange();
  }

  _dispatchChange() {
    // Unified form-field contract events (replaces the legacy 'related-changed').
    this._emitValueChanged();
    this._emitDirtyChanged();
  }

  _renderChips() {
    const container = this.shadowRoot.getElementById('related-chips');
    container.innerHTML = '';
    this._selected.forEach(({ id, name }) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `
        ${name}
        <button type="button" class="chip__remove" aria-label="הסר ${name}" data-id="${id}">×</button>
      `;
      chip.querySelector('.chip__remove').addEventListener('click', () => this._remove(id));
      container.appendChild(chip);
    });

    // Disable search input when at max, or when the form is disabled.
    const input = this.shadowRoot.getElementById('related-search-input');
    const atMax = this._selected.length >= MAX_RELATED;
    input.disabled = this._isDisabled || atMax;
    input.placeholder = atMax ? `הגעת למקסימום (${MAX_RELATED})` : 'הקלד שם מתכון לחיפוש...';
  }

  // --- Unified form-field contract (see FormFieldMixin) ---

  /**
   * Returns the selected recipe IDs — the shape stored in recipeData.relatedRecipes.
   * @returns {string[]}
   */
  getValue() {
    return this._selected.map((s) => s.id);
  }

  /**
   * Populates the field from recipe IDs (or {id,name} objects) and resets the
   * pristine baseline once names have been resolved. Asynchronous because edit-mode
   * population fetches recipe names for chip display.
   * @param {Array<string|{id:string,name?:string}>|null} value
   * @returns {Promise<void>}
   */
  async setValue(value) {
    const ids = Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v : v && v.id)).filter(Boolean)
      : [];

    if (!ids.length) {
      this._selected = [];
      this._renderChips();
    } else {
      await this.populateData(ids);
    }
    this.markPristine();
  }

  /** @returns {Array} the empty value */
  _getEmptyValue() {
    return [];
  }

  /**
   * Clears all selected recipes, resets the search input, and resets the pristine
   * baseline (unified contract). Fires value-changed / dirty-changed so the form's
   * dirty state tracks the reset.
   */
  clear() {
    this._selected = [];
    this._renderChips();
    const input = this.shadowRoot.getElementById('related-search-input');
    const dropdown = this.shadowRoot.getElementById('related-dropdown');
    if (input) input.value = '';
    if (dropdown) dropdown.hidden = true;
    this.markPristine();
    this._emitValueChanged({ action: 'clear' });
    this._emitDirtyChanged();
  }

  /**
   * Enables/disables the search input and chip remove buttons. Persists across
   * re-renders so a later _renderChips() does not silently re-enable the input.
   * @param {boolean} disabled
   */
  setDisabled(disabled) {
    this._isDisabled = disabled;
    const input = this.shadowRoot.getElementById('related-search-input');
    if (input) input.disabled = disabled || this._selected.length >= MAX_RELATED;
    this.shadowRoot.querySelectorAll('.chip__remove').forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  /**
   * Reflects validation errors on the search input.
   * @param {Object} errors
   */
  setValidationState(errors = {}) {
    const input = this.shadowRoot.getElementById('related-search-input');
    if (!input) return;
    if (errors.relatedRecipes) {
      input.classList.add('recipe-form__input--invalid');
    } else {
      input.classList.remove('recipe-form__input--invalid');
    }
  }

  /**
   * Populate from existing recipe IDs (edit mode). Fetches recipe names for display.
   * Does not reset the pristine baseline — callers use setValue() for that.
   * @param {string[]} ids
   */
  async populateData(ids) {
    if (!Array.isArray(ids) || !ids.length) return;

    const fetched = await Promise.all(
      ids.map(async (id) => {
        const recipe = formatRecipeData(await RecipeService.get(id));
        return recipe ? { id, name: recipe.name } : null;
      }),
    );

    this._selected = fetched.filter(Boolean);
    this._renderChips();
  }

  /**
   * Set the current recipe ID to exclude it from search results.
   * @param {string} id
   */
  setExcludeId(id) {
    this._excludeId = id;
  }
}

customElements.define('recipe-related-field', RecipeRelatedField);
