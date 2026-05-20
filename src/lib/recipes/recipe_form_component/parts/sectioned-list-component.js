/**
 * SectionedListComponent Component
 * --------------------------------
 * Extends DynamicListComponent to provide functionality for managing lists that can be divided into sections.
 * This component handles the logic for switching between a simple list and a sectioned list,
 * and provides a framework for subclasses to implement the specific rendering and data handling for their items.
 */

import { DynamicListComponent } from './dynamic-list-component.js';

export class SectionedListComponent extends DynamicListComponent {
  constructor() {
    super();
    this.isSectionMode = false;
    this.sections = [];
    this.sectionTitlePrefix = 'קטגוריה';
    this.addSectionButtonText = 'הוסף קטגוריה';
    this.sectionNamePlaceholder = 'שם הקטגוריה';

    // Abstract configuration properties - can be overridden by subclasses
    this.sectionContainerSelector = '.recipe-form__ingredient-sections[data-section-index]';
    this.sectionNameInputSelector = '.recipe-form__input--section-name';
    this.sectionValidationErrorKey = 'sectionTitles';
    this.sectionValidationErrorMessage = 'חובה למלא לפחות 2 קטגוריות עם כותרת ומצרכים.';
  }

  /**
   * The main template for the component.
   */
  template() {
    return `
      <div class="${this.containerClass}">
        <label class="recipe-form__label">${this.listTitle}</label>
        <div id="items-container" class="recipe-form__items-list">
          ${this.createInitialItem()}
        </div>
        <button type="button" id="add-section" class="recipe-form__button recipe-form__button--add-section">${this.addSectionButtonText}</button>
      </div>
    `;
  }

  /**
   * Creates the initial item for the list.
   * @returns {string} The HTML for the initial item.
   */
  createInitialItem() {
    return this.createListItemHTML(this.getInitialItems()[0], false);
  }

  /**
   * Sets up the event listeners for the component.
   */
  setupEventListeners() {
    const container = this.shadowRoot.querySelector('#items-container');
    if (container) {
      this._itemsContainerHandler = (event) => {
        if (event.target.classList.contains(this.addButtonClass)) {
          this.addItem(event);
        } else if (event.target.classList.contains(this.removeButtonClass)) {
          this.removeItem(event);
        }
      };
      container.addEventListener('click', this._itemsContainerHandler);
    }

    this.shadowRoot.addEventListener('click', (event) => {
      if (event.target.id === 'add-section') {
        this.transformToSectionMode();
      } else if (event.target.classList.contains('recipe-form__button--remove-section')) {
        this.removeSection(event);
      }
    });
  }

  /**
   * Transforms the component to section mode.
   */
  transformToSectionMode() {
    if (this.isSectionMode) {
      this.updateSectionsFromDOM();
      this.sections.push({ title: '', items: this.getInitialItems() });
      this.renderSectionMode();
      this.dispatchChangeEvent('section-added');
      return;
    }

    const currentItems = this.getSimpleData();
    this.isSectionMode = true;
    const firstSectionItems = currentItems.length > 0 ? currentItems : this.getInitialItems();
    this.sections = [
      { title: '', items: firstSectionItems },
      { title: '', items: this.getInitialItems() },
    ];

    this.renderSectionMode();
    this.dispatchChangeEvent('transformed-to-section-mode');
  }

  /**
   * Transforms the component back to simple mode.
   */
  transformToSimpleMode() {
    if (!this.isSectionMode) return;

    this.updateSectionsFromDOM();
    const allItems = this.sections.flatMap((section) =>
      section.items.filter((item) => this.isItemPopulated(item)),
    );

    this.isSectionMode = false;
    this.sections = [];
    this.renderSimpleMode();

    if (allItems.length > 0) {
      this.populateSimpleData(allItems);
    }
  }

  /**
   * Renders the component in section mode.
   */
  renderSectionMode() {
    const itemsContainer = this.shadowRoot.querySelector('#items-container');
    const addSectionButton = this.shadowRoot.querySelector('#add-section');

    itemsContainer.innerHTML = '';
    this.sections.forEach((section, index) => {
      const sectionDiv = this.createSectionHTML(section, index);
      itemsContainer.insertAdjacentHTML('beforeend', sectionDiv);
    });

    addSectionButton.textContent = this.addSectionButtonText;
    this.setupSectionEventListeners();
  }

  /**
   * Renders the component in simple mode.
   */
  renderSimpleMode() {
    const itemsContainer = this.shadowRoot.querySelector('#items-container');
    const addSectionButton = this.shadowRoot.querySelector('#add-section');

    itemsContainer.innerHTML = this.createInitialItem();
    addSectionButton.textContent = this.addSectionButtonText;
    this.setupSimpleEventListeners();
  }

  /**
   * Creates the HTML for a single section.
   * @param {object} section - The section data.
   * @param {number} sectionIndex - The index of the section.
   * @returns {string} The HTML for the section.
   */
  createSectionHTML(section, sectionIndex) {
    const sectionNumber = sectionIndex + 1;
    const items = section.items || [];
    const itemHTMLs = items
      .map((item, index) => {
        const includeRemove = index > 0 || items.length > 1;
        return this.createListItemHTML(item, includeRemove);
      })
      .join('');
    const content = itemHTMLs || this.createListItemHTML(this.getInitialItems()[0], false);
    const removeSectionButton =
      this.sections.length > 1
        ? `<button type="button" class="recipe-form__button recipe-form__button--remove-section">-</button>`
        : '';
    const escapedSectionTitle = (section.title || '')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    return `
      <div class="recipe-form__ingredient-sections" data-section-index="${sectionIndex}">
        <div class="recipe-form__stage-header">
          <h3 class="recipe-form__stage-title">${this.sectionTitlePrefix} ${sectionNumber}</h3>
          ${removeSectionButton}
        </div>
        <input type="text" class="recipe-form__input recipe-form__input--section-name"
               placeholder="${this.sectionNamePlaceholder}" value="${escapedSectionTitle}">
        ${content}
      </div>
    `;
  }

  /**
   * Updates the sections data from the current DOM state.
   */
  updateSectionsFromDOM() {
    if (!this.isSectionMode) return;

    const sectionContainers = this.shadowRoot.querySelectorAll(this.sectionContainerSelector);
    sectionContainers.forEach((container) => {
      const sectionIndex = parseInt(container.dataset.sectionIndex, 10);
      if (this.sections[sectionIndex]) {
        const sectionNameInput = container.querySelector(this.sectionNameInputSelector);
        const sectionTitle = sectionNameInput ? sectionNameInput.value.trim() : '';
        const items = Array.from(container.querySelectorAll(`:scope > .${this.itemClass}`)).map(
          (item) => this.getItemData(item),
        );

        this.sections[sectionIndex] = {
          title: sectionTitle || this.sections[sectionIndex].title,
          items: items.length > 0 ? items : this.getInitialItems(),
        };
      }
    });
  }

  /**
   * Sets up the event listeners for section mode.
   */
  setupSectionEventListeners() {
    const itemsContainer = this.shadowRoot.querySelector('#items-container');
    if (itemsContainer) {
      if (this._itemsContainerHandler) {
        itemsContainer.removeEventListener('click', this._itemsContainerHandler);
      }
      this._itemsContainerHandler = (event) => {
        if (event.target.classList.contains(this.addButtonClass)) {
          this.addSectionItem(event);
        } else if (event.target.classList.contains(this.removeButtonClass)) {
          this.removeSectionItem(event);
        }
      };
      itemsContainer.addEventListener('click', this._itemsContainerHandler);
    }
  }

  /**
   * Sets up the event listeners for simple mode.
   */
  setupSimpleEventListeners() {
    const itemsContainer = this.shadowRoot.querySelector('#items-container');
    if (itemsContainer) {
      if (this._itemsContainerHandler) {
        itemsContainer.removeEventListener('click', this._itemsContainerHandler);
      }
      this._itemsContainerHandler = (event) => {
        if (event.target.classList.contains(this.addButtonClass)) {
          this.addItem(event);
        } else if (event.target.classList.contains(this.removeButtonClass)) {
          this.removeItem(event);
        }
      };
      itemsContainer.addEventListener('click', this._itemsContainerHandler);
    }
  }

  /**
   * Adds an item to the list in simple mode.
   * @param {Event} event - The click event.
   */
  addItem(event) {
    const clickedButton = event.target;
    const currentItem = clickedButton.closest(`.${this.itemClass}`);
    const newItemHTML = this.createListItemHTML(this.getInitialItems()[0], true);
    const newItemDiv = document.createElement('div');
    newItemDiv.innerHTML = newItemHTML;
    const newItem = newItemDiv.firstElementChild;

    if (currentItem.nextSibling) {
      currentItem.parentNode.insertBefore(newItem, currentItem.nextSibling);
    } else {
      currentItem.parentNode.appendChild(newItem);
    }

    this.updateFirstItemRemoveButton();
    this.dispatchChangeEvent('item-added');
  }

  /**
   * Removes an item from the list in simple mode.
   * @param {Event} event - The click event.
   */
  removeItem(event) {
    const itemToRemove = event.target.closest(`.${this.itemClass}`);
    itemToRemove.remove();
    this.updateFirstItemRemoveButton();
    this.dispatchChangeEvent('item-removed');
  }

  /**
   * Adds an item to a section.
   * @param {Event} event - The click event.
   */
  addSectionItem(event) {
    const clickedButton = event.target;
    const currentItem = clickedButton.closest(`.${this.itemClass}`);
    const sectionContainer = clickedButton.closest('.recipe-form__ingredient-sections');
    const sectionIndex = parseInt(sectionContainer.dataset.sectionIndex, 10);
    const newItemHTML = this.createListItemHTML(this.getInitialItems()[0], true);
    const newItemDiv = document.createElement('div');
    newItemDiv.innerHTML = newItemHTML;
    const newItem = newItemDiv.firstElementChild;

    if (currentItem.nextSibling) {
      currentItem.parentNode.insertBefore(newItem, currentItem.nextSibling);
    } else {
      currentItem.parentNode.appendChild(newItem);
    }

    if (this.sections[sectionIndex]) {
      this.sections[sectionIndex].items.push(this.getInitialItems()[0]);
    }

    this.updateSectionFirstItemRemoveButton(sectionContainer);
    this.dispatchChangeEvent('section-item-added');
  }

  /**
   * Removes an item from a section.
   * @param {Event} event - The click event.
   */
  removeSectionItem(event) {
    const itemToRemove = event.target.closest(`.${this.itemClass}`);
    const sectionContainer = itemToRemove.closest('.recipe-form__ingredient-sections');
    const sectionIndex = parseInt(sectionContainer.dataset.sectionIndex, 10);
    const sectionItems = Array.from(sectionContainer.querySelectorAll(`.${this.itemClass}`));
    const itemIndex = sectionItems.indexOf(itemToRemove);

    itemToRemove.remove();

    if (this.sections[sectionIndex] && this.sections[sectionIndex].items[itemIndex] !== undefined) {
      this.sections[sectionIndex].items.splice(itemIndex, 1);
    }

    this.updateSectionFirstItemRemoveButton(sectionContainer);
    this.dispatchChangeEvent('section-item-removed');
  }

  /**
   * Updates the remove button for the first item in a section.
   * @param {HTMLElement} sectionContainer - The container of the section.
   */
  updateSectionFirstItemRemoveButton(sectionContainer) {
    const items = sectionContainer.querySelectorAll(`.${this.itemClass}`);
    const firstItem = items[0];
    if (!firstItem) return;

    const removeButton = firstItem.querySelector(`.${this.removeButtonClass}`);
    if (!removeButton) return;

    if (items.length === 1) {
      removeButton.style.visibility = 'hidden';
      removeButton.style.pointerEvents = 'none';
    } else {
      removeButton.style.visibility = '';
      removeButton.style.pointerEvents = '';
    }
  }

  /**
   * Removes a section.
   * @param {Event} event - The click event.
   */
  removeSection(event) {
    this.updateSectionsFromDOM();
    const sectionDiv = event.target.closest('.recipe-form__ingredient-sections');
    const sectionIndex = parseInt(sectionDiv.dataset.sectionIndex, 10);

    if (this.sections.length <= 1) return;

    this.sections.splice(sectionIndex, 1);

    if (this.sections.length === 1) {
      this.transformToSimpleMode();
    } else {
      this.renderSectionMode();
    }

    this.dispatchChangeEvent('section-removed');
  }

  /**
   * Updates the remove button for the first item in the list.
   */
  updateFirstItemRemoveButton() {
    const container = this.shadowRoot.querySelector('#items-container');
    const items = container.querySelectorAll(`.${this.itemClass}`);
    const firstItem = items[0];
    if (!firstItem) return;

    const removeButton = firstItem.querySelector(`.${this.removeButtonClass}`);
    if (!removeButton) return;

    if (items.length === 1) {
      removeButton.style.visibility = 'hidden';
      removeButton.style.pointerEvents = 'none';
    } else {
      removeButton.style.visibility = '';
      removeButton.style.pointerEvents = '';
    }
  }

  /**
   * Dispatches a change event.
   * @param {string} action - The action that triggered the event.
   * @param {object} additionalData - Additional data to include in the event detail.
   */
  dispatchChangeEvent(action, additionalData = {}) {
    this.dispatchEvent(
      new CustomEvent('change', {
        bubbles: true,
        composed: true,
        detail: {
          action,
          data: this.getData(),
          isSectionMode: this.isSectionMode,
          ...additionalData,
        },
      }),
    );
  }

  /**
   * Gets the data for the component.
   * @returns {Array|object} The data for the component.
   */
  getData() {
    if (this.isSectionMode) {
      return this.getSectionsData();
    } else {
      return this.getSimpleData();
    }
  }

  /**
   * Populates the component with data.
   * @param {Array|object} data - The data to populate the component with.
   */
  populateData(data) {
    if (Array.isArray(data)) {
      this.populateSimpleData(data);
    } else if (data && data.sections) {
      this.populateSectionsData(data.sections);
    }
  }

  /**
   * Gets the data for the simple list.
   * @returns {Array} The data for the simple list.
   */
  getSimpleData() {
    const itemsContainer = this.shadowRoot.querySelector('#items-container');
    const items = itemsContainer.querySelectorAll(`.${this.itemClass}`);
    const data = [];
    items.forEach((item) => {
      const itemData = this.getItemData(item);
      if (this.isItemPopulated(itemData)) {
        data.push(itemData);
      }
    });
    return data;
  }

  /**
   * Gets the data for the sectioned list.
   * @returns {Array} The data for the sectioned list.
   */
  getSectionsData() {
    const sectionContainers = this.shadowRoot.querySelectorAll(this.sectionContainerSelector);
    const sections = [];
    sectionContainers.forEach((container) => {
      const sectionNameInput = container.querySelector(this.sectionNameInputSelector);
      const sectionTitle = sectionNameInput ? sectionNameInput.value.trim() : '';
      const items = Array.from(container.querySelectorAll(`:scope > .${this.itemClass}`))
        .map((item) => this.getItemData(item))
        .filter((item) => this.isItemPopulated(item));

      if (items.length > 0 || sectionTitle) {
        sections.push({ title: sectionTitle, items });
      }
    });
    return sections;
  }

  /**
   * Populates the simple list with data.
   * @param {Array} data - The data to populate the list with.
   */
  populateSimpleData(data) {
    if (!Array.isArray(data) || data.length === 0) return;
    if (this.isSectionMode) {
      this.transformToSimpleMode();
    }
    const itemsContainer = this.shadowRoot.querySelector('#items-container');
    itemsContainer.innerHTML = '';
    data.forEach((item, index) => {
      const includeRemove = index > 0 || data.length > 1;
      const itemHTML = this.createListItemHTML(item, includeRemove);
      itemsContainer.insertAdjacentHTML('beforeend', itemHTML);
    });
  }

  /**
   * Populates the sectioned list with data.
   * @param {Array} sections - The data to populate the list with.
   */
  populateSectionsData(sections) {
    if (!Array.isArray(sections) || sections.length === 0) return;
    this.sections = sections.map((section) => ({
      title: section.title || '',
      items: section.items || [],
    }));
    this.isSectionMode = true;
    this.renderSectionMode();
  }

  /**
   * Clears the list.
   */
  clear() {
    this.isSectionMode = false;
    this.sections = [];
    this.renderSimpleMode();
    const inputs = this.shadowRoot.querySelectorAll('input[type="text"]');
    inputs.forEach((input) => {
      input.value = '';
    });
  }

  /**
   * Validates the component's data according to comprehensive rules.
   * @returns {Object} Validation result with isValid flag and detailed errors
   */
  validate() {
    const errors = {};
    let isValid = true;

    if (this.isSectionMode) {
      const validationResult = this.validateSectionMode();
      Object.assign(errors, validationResult.errors);
      isValid = validationResult.isValid;

      // Mode switching removed - component stays in user-selected mode
    } else {
      const validationResult = this.validateBasicMode();
      Object.assign(errors, validationResult.errors);
      isValid = validationResult.isValid;
    }

    return { isValid, errors };
  }

  /**
   * Validates section mode requirements
   * @returns {Object} Validation result
   */
  validateSectionMode() {
    this.updateSectionsFromDOM();
    const errors = {};
    let isValid = true;

    if (this.sections.length < 2) {
      errors.sections = 'חובה ליצור לפחות 2 קטגוריות במצב קטגוריות';
      isValid = false;
      return { isValid, errors };
    }

    let sectionsWithTitles = 0;
    let sectionsWithIngredients = 0;
    let totalIngredients = 0;

    // Count sections with filled titles and ingredients
    this.sections.forEach((section) => {
      const sectionTitle = section.title?.trim();

      if (sectionTitle) {
        sectionsWithTitles++;
      }

      const populatedItems = section.items.filter((item) => this.isItemPopulated(item));
      totalIngredients += populatedItems.length;

      if (populatedItems.length > 0) {
        sectionsWithIngredients++;
      }
    });

    // Granular validation: validate each of the first 2 sections individually
    // Check what's missing in each section and highlight only those specific fields
    let validSections = 0;

    for (let i = 0; i < Math.min(2, this.sections.length); i++) {
      const section = this.sections[i];
      const sectionTitle = section.title?.trim();
      const populatedItems = section.items.filter((item) => this.isItemPopulated(item));

      // Check if title is missing
      if (!sectionTitle) {
        errors[`sections[${i}].title`] = true;
      }

      // Check individual items for missing fields (granular validation)
      // Only highlight empty fields as errors if there are no populated items in this section
      if (populatedItems.length === 0) {
        // No populated items in section - highlight at least the first empty item as error
        const firstEmptyItem = section.items.find((item) => !this.isItemPopulated(item));
        if (firstEmptyItem) {
          const firstEmptyIndex = section.items.indexOf(firstEmptyItem);
          const fieldErrors = this.validateItemFields(firstEmptyItem);
          Object.keys(fieldErrors).forEach((field) => {
            errors[`sections[${i}].items[${firstEmptyIndex}].${field}`] = true;
          });
        }
      }
      // If there are populated items, don't highlight empty ones as errors (minimum requirement met)

      // A section is valid if it has both title and at least one item
      if (sectionTitle && populatedItems.length > 0) {
        validSections++;
      }
    }

    // We need at least 2 valid sections (with both title and content)
    if (validSections < 2) {
      errors[this.sectionValidationErrorKey] = this.sectionValidationErrorMessage;
      isValid = false;
    }

    // Validate individual fields for populated items (ingredients/instructions)
    const failedFields = new Set();
    this.sections.forEach((section, sectionIndex) => {
      section.items.forEach((item, itemIndex) => {
        if (this.isItemPopulated(item)) {
          const itemErrors = this.validateItemFields(item);
          if (Object.keys(itemErrors).length > 0) {
            Object.keys(itemErrors).forEach((field) => {
              errors[`sections[${sectionIndex}].items[${itemIndex}].${field}`] = true;
              failedFields.add(field);
            });
            isValid = false;
          }
        }
      });
    });
    if (failedFields.size > 0) {
      const message = this.buildItemErrorMessage(Array.from(failedFields));
      if (message) errors.invalidItem = message;
    }

    return { isValid, errors };
  }

  /**
   * Validates basic mode requirements
   * @returns {Object} Validation result
   */
  validateBasicMode() {
    const errors = {};
    let isValid = true;

    const container = this.shadowRoot.querySelector('#items-container');
    const itemElements = container.querySelectorAll(`.${this.itemClass}`);
    const allItems = Array.from(itemElements).map((element) => this.getItemData(element));
    const populatedItems = allItems.filter((item) => this.isItemPopulated(item));

    // If no ingredients filled at all, highlight ALL visible ingredient fields
    if (populatedItems.length === 0) {
      allItems.forEach((item, index) => {
        const fieldNames = Object.keys(item);
        fieldNames.forEach((field) => {
          errors[`items[${index}].${field}`] = true;
        });
      });
      errors.noIngredients = 'חובה למלא לפחות מרכיב אחד.';
      isValid = false;
    } else {
      // Validate only populated items - check for missing fields in partially filled ingredients
      const failedFields = new Set();
      allItems.forEach((item, index) => {
        if (this.isItemPopulated(item)) {
          const itemErrors = this.validateItemFields(item);
          if (Object.keys(itemErrors).length > 0) {
            Object.keys(itemErrors).forEach((field) => {
              errors[`items[${index}].${field}`] = true;
              failedFields.add(field);
            });
            isValid = false;
          }
        }
      });
      if (failedFields.size > 0) {
        const message = this.buildItemErrorMessage(Array.from(failedFields));
        if (message) errors.invalidItem = message;
      }
    }

    return { isValid, errors };
  }

  /**
   * Validates individual item fields (to be overridden by subclasses)
   * @param {Object} item - Item to validate
   * @returns {Object} Object with field names as keys for invalid fields
   */
  validateItemFields(_item) {
    return {};
  }

  /**
   * Optional: subclasses return a specific Hebrew banner string for the set of
   * fields that failed across populated items (e.g. "כמות לא תקינה…"). Default
   * returns null, in which case the form falls back to its generic banner.
   * @param {string[]} _failedFields
   * @returns {string|null}
   */
  buildItemErrorMessage(_failedFields) {
    return null;
  }

  // Abstract methods to be implemented by subclasses
  createListItemHTML(_item, _includeRemove) {
    throw new Error('createListItemHTML must be implemented by subclass');
  }

  getItemData(_itemElement) {
    throw new Error('getItemData must be implemented by subclass');
  }

  getInitialItems() {
    throw new Error('getInitialItems must be implemented by subclass');
  }

  isItemPopulated(_itemData) {
    throw new Error('isItemPopulated must be implemented by subclass');
  }
}
