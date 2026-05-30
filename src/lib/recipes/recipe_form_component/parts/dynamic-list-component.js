/**
 * DynamicListComponent - Base Class
 * ---------------------------------
 * Reusable base component for managing dynamic lists of form items.
 * Provides common functionality for add/remove operations, button state management,
 * and data collection that can be extended by specific list types.
 *
 * Used by:
 * - RecipeIngredientsList (3 fields per line)
 * - RecipeInstructionsList (1 field per line)
 */

import styles from '../recipe_form_component.css?inline';
import { FormFieldMixin } from '../../../forms/form-field-base.js';

export class DynamicListComponent extends FormFieldMixin(HTMLElement) {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Configuration properties (to be set by extending classes)
    this.listTitle = this.getAttribute('title') || 'List Items';
    this.itemFields = []; // Array of field definitions: { placeholder, className, name }
    this.containerClass = 'dynamic-list';
    this.itemClass = 'dynamic-list-item';
    this.addButtonClass = 'dynamic-list-add-button';
    this.removeButtonClass = 'dynamic-list-remove-button';
    this.requiredField = false; // subclasses set true to render a required asterisk
  }

  /** Required-field asterisk markup for the list label (empty when optional). */
  requiredMark() {
    return this.requiredField ? ' <span class="recipe-form__req">*</span>' : '';
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${this.template()}
    `;
  }

  template() {
    return `
      <div class="${this.containerClass}">
        <label class="recipe-form__label">${this.listTitle}${this.requiredMark()}</label>
        <div class="list-items-container">
          ${this.createInitialItem()}
        </div>
        ${this.createAdditionalControls()}
      </div>
    `;
  }

  /**
   * Creates the initial list item HTML
   * To be implemented by extending classes
   */
  createInitialItem() {
    throw new Error('createInitialItem() must be implemented by extending class');
  }

  /**
   * Creates additional controls (like "Add Stage" button for instructions)
   * Can be overridden by extending classes
   */
  createAdditionalControls() {
    return '';
  }

  /**
   * Creates a new list item with the specified fields
   * @param {boolean} includeRemoveButton - Whether to include remove button
   */
  createListItem(includeRemoveButton = true) {
    const fieldsHTML = this.itemFields
      .map(
        (field) =>
          `<input type="text" class="recipe-form__input ${field.className || ''}" 
              placeholder="${field.placeholder}" name="${field.name || ''}">`,
      )
      .join('');

    const removeButtonHTML = includeRemoveButton
      ? `<button type="button" class="recipe-form__button ${this.removeButtonClass}">-</button>`
      : '';

    return `
      <div class="${this.itemClass}">
        ${fieldsHTML}
        <button type="button" class="recipe-form__button ${this.addButtonClass}">+</button>
        ${removeButtonHTML}
      </div>
    `;
  }

  setupEventListeners() {
    const container = this.shadowRoot.querySelector('.list-items-container');

    // Handle add/remove button clicks
    container.addEventListener('click', (event) => {
      if (event.target.classList.contains(this.addButtonClass)) {
        this.addListItem(event);
      } else if (event.target.classList.contains(this.removeButtonClass)) {
        this.removeListItem(event);
      }
    });

    // Handle additional control events (to be extended)
    this.setupAdditionalEventListeners();
  }

  /**
   * Additional event listeners for extending classes
   * Can be overridden by extending classes
   */
  setupAdditionalEventListeners() {
    // Override in extending classes if needed
  }

  /**
   * Adds a new list item
   * @param {Event} event - Click event from add button
   */
  addListItem(event) {
    const container = this.shadowRoot.querySelector('.list-items-container');
    const clickedButton = event.target;
    const currentItem = clickedButton.closest(`.${this.itemClass}`);

    // Create new item with remove button
    const newItemDiv = document.createElement('div');
    newItemDiv.innerHTML = this.createListItem(true);
    const newItem = newItemDiv.firstElementChild;

    // Insert after current item
    container.insertBefore(newItem, currentItem.nextSibling);

    // Add remove button to first item if it doesn't have one
    this.updateFirstItemRemoveButton();

    // Dispatch change event
    this.dispatchChangeEvent('item-added');
  }

  /**
   * Removes a list item
   * @param {Event} event - Click event from remove button
   */
  removeListItem(event) {
    const itemToRemove = event.target.closest(`.${this.itemClass}`);

    itemToRemove.remove();

    // Remove remove button from first item if only one remains
    this.updateFirstItemRemoveButton();

    // Dispatch change event
    this.dispatchChangeEvent('item-removed');
  }

  /**
   * Updates the first item's remove button based on total count
   */
  updateFirstItemRemoveButton() {
    const container = this.shadowRoot.querySelector('.list-items-container');
    const items = container.querySelectorAll(`.${this.itemClass}`);
    const firstItem = items[0];

    if (items.length === 1) {
      // Remove the remove button from first item
      const removeButton = firstItem.querySelector(`.${this.removeButtonClass}`);
      if (removeButton) removeButton.remove();
    } else if (items.length > 1) {
      // Add remove button to first item if it doesn't have one
      const removeButton = firstItem.querySelector(`.${this.removeButtonClass}`);
      if (!removeButton) {
        const newRemoveButton = document.createElement('button');
        newRemoveButton.type = 'button';
        newRemoveButton.className = `recipe-form__button ${this.removeButtonClass}`;
        newRemoveButton.textContent = '-';
        firstItem.appendChild(newRemoveButton);
      }
    }
  }

  /**
   * Dispatches the unified form-field contract events for the orchestrator.
   * @param {string} action - The action that occurred ('item-added', 'item-removed', etc.)
   */
  dispatchChangeEvent(action) {
    this._emitValueChanged({ action });
    this._emitDirtyChanged();
  }

  /**
   * Gets all data from the list
   * To be implemented by extending classes
   */
  getData() {
    throw new Error('getData() must be implemented by extending class');
  }

  // --- Unified form-field contract (see FormFieldMixin) ---

  /** @returns {*} the list's data; alias for getData() */
  getValue() {
    return this.getData();
  }

  /**
   * Populates the list and resets the pristine baseline.
   * @param {*} value
   */
  setValue(value) {
    this.populateData(value);
    this.markPristine();
  }

  /** @returns {Array} the empty value for a list */
  _getEmptyValue() {
    return [];
  }

  /**
   * Populates the list with data
   * To be implemented by extending classes
   */
  populateData(_data) {
    throw new Error('populateData() must be implemented by extending class');
  }

  /**
   * Clears all list items and resets to initial state
   */
  clearList() {
    const container = this.shadowRoot.querySelector('.list-items-container');
    const items = container.querySelectorAll(`.${this.itemClass}`);

    // Remove all items except the first
    items.forEach((item, index) => {
      if (index > 0) item.remove();
    });

    // Clear the first item's inputs
    const firstItem = items[0];
    if (firstItem) {
      const inputs = firstItem.querySelectorAll('input');
      inputs.forEach((input) => {
        input.value = '';
        input.classList.remove('recipe-form__input--invalid');
      });

      // Remove the remove button from first item
      const removeButton = firstItem.querySelector(`.${this.removeButtonClass}`);
      if (removeButton) removeButton.remove();
    }

    // Dispatch change event
    this.dispatchChangeEvent('list-cleared');
  }

  /**
   * Sets disabled state for all inputs and buttons
   * @param {boolean} disabled - Whether to disable the list
   */
  setDisabled(disabled) {
    const inputs = this.shadowRoot.querySelectorAll('input, button');
    inputs.forEach((input) => {
      input.disabled = disabled;
    });
  }

  /**
   * Validates the component data
   * Base implementation returns valid - extending classes should override
   * @returns {Object} Validation result with isValid flag and error messages
   */
  validate() {
    return { isValid: true, errors: {} };
  }

  /**
   * Sets validation state for list items
   * @param {Object} _errors - Validation errors object (unused in base class)
   */
  setValidationState(_errors) {
    // Default implementation - can be overridden by extending classes
    const inputs = this.shadowRoot.querySelectorAll('input');
    inputs.forEach((input) => {
      input.classList.remove('recipe-form__input--invalid');
    });

    // Apply errors if provided - extending classes should override this method
    // for specific error handling logic
  }
}
