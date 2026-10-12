/**
 * RecipeIngredientsList Component
 * -------------------------------
 * Specialized dynamic list component for managing recipe ingredients.
 * Extends SectionedListComponent to provide 3-field ingredients (quantity, unit, item).
 */

import { SectionedListComponent } from './sectioned-list-component.js';
import {
  parseAmount,
  formatIngredientAmount,
} from '../../../../js/utils/recipes/recipe-ingredients-utils.js';

class RecipeIngredientsList extends SectionedListComponent {
  constructor() {
    super();
    this.listTitle = this.getAttribute('title') || 'מצרכים:';
    this.requiredField = true;
    this.containerClass = 'recipe-form__ingredients';
    this.itemClass = 'recipe-form__ingredient-entry';
    this.addButtonClass = 'recipe-form__button--add-ingredient';
    this.removeButtonClass = 'recipe-form__button--remove-ingredient';

    // Override selector configuration for ingredients-specific DOM structure
    this.sectionContainerSelector = '.recipe-form__ingredient-sections[data-section-index]';
    this.sectionNameInputSelector = '.recipe-form__input--section-name';
    this.sectionValidationErrorKey = 'sectionTitles';
    this.sectionValidationErrorMessage = 'חובה למלא לפחות 2 קטגוריות עם כותרת ומצרכים.';

    this.sectionModeHint = 'במצב קטגוריות: לפחות 2 קטגוריות, לכל אחת כותרת ומצרך אחד לפחות.';
    this.problemListLabel = 'מצרכים';
    this.emptyListErrorKey = 'noIngredients';
    this.sectionCountRule = 'צריך לפחות 2 קטגוריות, לכל אחת כותרת ומצרך.';
  }

  /**
   * A wrong amount is grouped under one explanation and named by its item; a
   * missing item is named by its row.
   */
  describeInvalidInput(input, { row, rowNumber }) {
    if (input.classList.contains('recipe-form__input--quantity')) {
      const item = row.querySelector('.recipe-form__input--item')?.value.trim();
      return {
        kind: 'wrong',
        group: 'amount',
        groupLead: 'כמות ב־',
        label: item || `שורה ${rowNumber}`,
        explanation: 'צריכה להיות מספר, כמו 2 או 1/2 – או להישאר ריקה.',
        target: input,
      };
    }
    if (input.classList.contains('recipe-form__input--item')) {
      return { kind: 'missing', label: `פריט (שורה ${rowNumber})`, target: input };
    }
    return null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.setupInputListeners();
  }

  /**
   * Sets up input event listeners to clear errors on value change
   */
  setupInputListeners() {
    // Use event delegation since ingredient inputs are added dynamically
    this.shadowRoot.addEventListener('input', (event) => {
      const target = event.target;
      if (
        target.matches(
          '.recipe-form__input--quantity, .recipe-form__input--unit, .recipe-form__input--item, .recipe-form__input--section-name',
        )
      ) {
        // Clear error / blank-field highlighting when user changes the value
        target.classList.remove('recipe-form__input--invalid', 'recipe-form__input--warning');
      }
    });
  }

  createListItemHTML(ingredient, includeRemove) {
    const escape = (v) => String(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    // Show the amount in readable form (number 0.5 → "1/2", legacy "1/2" →
    // "1/2"); getItemData re-parses it back to a number on collect.
    const escapedQuantity = escape(formatIngredientAmount(ingredient.amount));
    const escapedUnit = escape(ingredient.unit || '');
    const escapedItem = escape(ingredient.item || '');
    const removeButtonHTML = `<button type="button" class="recipe-form__button ${this.removeButtonClass}"${!includeRemove ? ' style="visibility:hidden;pointer-events:none"' : ''}>-</button>`;

    return `
      <div class="${this.itemClass}">
        <input type="text" class="recipe-form__input recipe-form__input--quantity"
               placeholder="כמות" name="quantity" value="${escapedQuantity}">
        <input type="text" class="recipe-form__input recipe-form__input--unit"
               placeholder="יחידה" name="unit" value="${escapedUnit}">
        <input type="text" class="recipe-form__input recipe-form__input--item"
               placeholder="פריט" name="item" value="${escapedItem}">
        ${removeButtonHTML}
        <button type="button" class="recipe-form__button ${this.addButtonClass}">+</button>
      </div>
    `;
  }

  getItemData(itemElement) {
    const quantityInput = itemElement.querySelector('.recipe-form__input--quantity');
    const unitInput = itemElement.querySelector('.recipe-form__input--unit');
    const itemInput = itemElement.querySelector('.recipe-form__input--item');

    return {
      // Canonical numeric amount (or null if empty / not a clean number).
      amount: quantityInput ? parseAmount(quantityInput.value) : null,
      unit: unitInput ? unitInput.value.trim() : '',
      item: itemInput ? itemInput.value.trim() : '',
    };
  }

  getInitialItems() {
    return [{ amount: null, unit: '', item: '' }];
  }

  isItemPopulated(itemData) {
    return (
      itemData.amount != null ||
      (itemData.unit && itemData.unit.trim()) ||
      (itemData.item && itemData.item.trim())
    );
  }

  /**
   * Only the item name is required. Amount and unit are optional so rows like
   * "מלח לפי הטעם" or "3 ביצים" are valid; an amount that is entered must
   * still be a positive number.
   * @param {Object} item - Ingredient item to validate
   * @returns {Object} Object with field names as keys for invalid fields
   */
  validateItemFields(item) {
    const errors = {};

    // amount is already parsed by getItemData (null when empty or unparseable;
    // unparseable text is caught in validate() from the DOM).
    if (item.amount !== null && !(item.amount > 0)) {
      errors.amount = true;
    }
    if (!item.item || !item.item.trim()) {
      errors.item = true;
    }

    return errors;
  }

  /**
   * Adds quantity text that does not parse as an amount ("abc", "2-3") to the
   * base validation. getItemData maps such text to null — the same as an empty
   * field — so it can only be detected from the inputs themselves.
   * @returns {Object} Validation result with isValid flag and detailed errors
   */
  validate() {
    const result = super.validate();
    const amountKeys = this.getUnparseableAmountErrorKeys();
    if (amountKeys.length === 0) return result;

    const errors = { ...result.errors };
    amountKeys.forEach((key) => {
      errors[key] = true;
    });

    if (!errors.noIngredients) {
      const failedFields = new Set(['amount']);
      Object.keys(errors).forEach((key) => {
        if (/items\[\d+\]\.item$/.test(key)) failedFields.add('item');
      });
      errors.invalidItem = this.buildItemErrorMessage(Array.from(failedFields));
    }

    return { isValid: false, errors };
  }

  /**
   * Error keys (in the format setValidationState understands) for every
   * quantity input holding text that is not a valid amount.
   * @returns {string[]}
   */
  getUnparseableAmountErrorKeys() {
    const isUnparseable = (row) => {
      const input = row.querySelector('.recipe-form__input--quantity');
      const text = input ? input.value.trim() : '';
      return text !== '' && parseAmount(text) === null;
    };
    const keys = [];

    if (this.isSectionMode) {
      this.shadowRoot.querySelectorAll(this.sectionContainerSelector).forEach((sectionEl) => {
        const sectionIndex = sectionEl.dataset.sectionIndex;
        sectionEl.querySelectorAll(`.${this.itemClass}`).forEach((row, itemIndex) => {
          if (isUnparseable(row)) keys.push(`sections[${sectionIndex}].items[${itemIndex}].amount`);
        });
      });
    } else {
      this.shadowRoot.querySelectorAll(`#items-container .${this.itemClass}`).forEach((row, i) => {
        if (isUnparseable(row)) keys.push(`items[${i}].amount`);
      });
    }

    return keys;
  }

  /**
   * Named rows whose amount and/or unit is blank. Both are optional, but a
   * blank is often an oversight, so the form asks before submitting.
   * Unparseable amount text is not "blank" — validate() blocks it instead.
   * @returns {{ id: string, item: string, fields: string[], inputs: HTMLInputElement[] }[]}
   */
  getBlankFieldRows() {
    const rows = [];
    this.shadowRoot.querySelectorAll(`.${this.itemClass}`).forEach((row) => {
      const itemInput = row.querySelector('.recipe-form__input--item');
      const item = itemInput ? itemInput.value.trim() : '';
      if (!item) return;

      const fields = [];
      const inputs = [];
      [
        ['amount', '.recipe-form__input--quantity'],
        ['unit', '.recipe-form__input--unit'],
      ].forEach(([field, selector]) => {
        const input = row.querySelector(selector);
        if (input && !input.value.trim()) {
          fields.push(field);
          inputs.push(input);
        }
      });

      if (fields.length > 0)
        rows.push({ id: `${item}::${fields.join(',')}`, item, fields, inputs });
    });
    return rows;
  }

  /**
   * Highlights the blank amount/unit inputs of `rows` (from getBlankFieldRows)
   * and, unless `scroll` is false, brings the first one into view. A highlight
   * clears once its input is edited.
   * @param {{ inputs: HTMLInputElement[] }[]} rows
   * @param {{ scroll?: boolean }} [options]
   */
  showBlankFieldWarnings(rows, { scroll = true } = {}) {
    this.clearBlankFieldWarnings();
    rows.forEach((row) => {
      row.inputs.forEach((input) => input.classList.add('recipe-form__input--warning'));
    });
    const first = rows[0]?.inputs[0];
    if (first && scroll) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first.focus({ preventScroll: true });
    }
  }

  clearBlankFieldWarnings() {
    this.shadowRoot.querySelectorAll('.recipe-form__input--warning').forEach((input) => {
      input.classList.remove('recipe-form__input--warning');
    });
  }

  /**
   * Ingredient-specific banner message for invalid rows.
   * @param {string[]} failedFields
   * @returns {string}
   */
  buildItemErrorMessage(failedFields) {
    const fields = new Set(failedFields);
    const amountMessage = 'כמות שהוזנה חייבת להיות מספר, כמו 2 או 1/2 — או להישאר ריקה.';
    const itemMessage = 'חובה למלא שם פריט לכל מרכיב.';
    if (fields.has('amount') && fields.has('item')) return `${itemMessage} ${amountMessage}`;
    if (fields.has('amount')) return amountMessage;
    return itemMessage;
  }

  setValidationState(errors) {
    // Clear all existing error states including section name inputs
    this.shadowRoot.querySelectorAll('.recipe-form__input--invalid').forEach((input) => {
      input.classList.remove('recipe-form__input--invalid');
    });

    if (!errors || Object.keys(errors).length === 0) return;

    const fieldMapping = { amount: 'quantity', unit: 'unit', item: 'item' };

    Object.keys(errors).forEach((key) => {
      // Handle section mode validation errors
      if (key.startsWith('sections[')) {
        this.handleSectionValidationError(key, errors[key]);
      }
      // Handle basic mode validation errors
      else if (key.startsWith('items[')) {
        this.handleBasicModeValidationError(key, errors[key], fieldMapping);
      }
      // Handle legacy ingredient format errors for backward compatibility
      else if (key.startsWith('ingredients[')) {
        this.handleLegacyIngredientError(key, errors[key], fieldMapping);
      }
    });
  }

  /**
   * Handles validation errors for section mode
   * @param {string} key - Error key (e.g., "sections[0].title" or "sections[0].items[1].amount")
   * @param {*} errorValue - Error value (usually true)
   */
  handleSectionValidationError(key, errorValue) {
    const sectionMatch = key.match(/sections\[(\d+)\]\.(.+)/);
    if (!sectionMatch) return;

    const sectionIndex = parseInt(sectionMatch[1], 10);
    const remainder = sectionMatch[2];

    const sectionElement = this.shadowRoot.querySelector(`[data-section-index="${sectionIndex}"]`);
    if (!sectionElement) return;

    if (remainder === 'title') {
      // Highlight section title input
      const titleInput = sectionElement.querySelector('.recipe-form__input--section-name');
      if (titleInput) {
        titleInput.classList.add('recipe-form__input--invalid');
      }
    } else if (remainder.startsWith('items[')) {
      // Handle item-specific errors within a section
      const itemMatch = remainder.match(/items\[(\d+)\]\.(\w+)/);
      if (itemMatch) {
        const itemIndex = parseInt(itemMatch[1], 10);
        const field = itemMatch[2];

        const itemElements = sectionElement.querySelectorAll(`.${this.itemClass}`);
        const itemElement = itemElements[itemIndex];
        if (!itemElement) return;

        const cssClass = { amount: 'quantity', unit: 'unit', item: 'item' }[field] || field;
        const input = itemElement.querySelector(`.recipe-form__input--${cssClass}`);
        if (input) input.classList.add('recipe-form__input--invalid');
      }
    }
  }

  /**
   * Handles validation errors for basic mode
   * @param {string} key - Error key (e.g., "items[0].amount")
   * @param {*} errorValue - Error value
   * @param {Object} fieldMapping - Field name mapping
   */
  handleBasicModeValidationError(key, errorValue, fieldMapping) {
    const itemMatch = key.match(/items\[(\d+)\]\.(\w+)/);
    if (!itemMatch) return;

    const itemIndex = parseInt(itemMatch[1], 10);
    const field = itemMatch[2];

    const itemElements = this.shadowRoot.querySelectorAll(`.${this.itemClass}`);
    const itemElement = itemElements[itemIndex];
    if (!itemElement) return;

    const cssClass = fieldMapping[field] || field;
    const input = itemElement.querySelector(`.recipe-form__input--${cssClass}`);
    if (input) input.classList.add('recipe-form__input--invalid');
  }

  /**
   * Handles legacy ingredient validation errors for backward compatibility
   * @param {string} key - Error key (e.g., "ingredients[0].amount")
   * @param {*} errorValue - Error value
   * @param {Object} fieldMapping - Field name mapping
   */
  handleLegacyIngredientError(key, errorValue, fieldMapping) {
    const allItemElements = [];
    if (this.isSectionMode) {
      const sectionElements = this.shadowRoot.querySelectorAll('[data-section-index]');
      Array.from(sectionElements)
        .sort((a, b) => a.dataset.sectionIndex - b.dataset.sectionIndex)
        .forEach((sectionEl) => {
          sectionEl.querySelectorAll(`.${this.itemClass}`).forEach((itemEl) => {
            allItemElements.push(itemEl);
          });
        });
    } else {
      this.shadowRoot.querySelectorAll(`.${this.itemClass}`).forEach((itemEl) => {
        allItemElements.push(itemEl);
      });
    }

    const match = key.match(/ingredients\[(\d+)\]\.?(\w+)?/);
    if (match) {
      const itemIndex = parseInt(match[1], 10);
      const field = match[2];

      const itemEl = allItemElements[itemIndex];
      if (!itemEl) return;

      if (field) {
        const cssClass = fieldMapping[field] || field;
        const input = itemEl.querySelector(`.recipe-form__input--${cssClass}`);
        if (input) input.classList.add('recipe-form__input--invalid');
      } else {
        itemEl.querySelectorAll('input').forEach((input) => {
          input.classList.add('recipe-form__input--invalid');
        });
      }
    }
  }
}

customElements.define('recipe-ingredients-list', RecipeIngredientsList);
