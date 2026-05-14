import { RecipeService } from '../../../js/services/recipe-service.js';
import { getOptimizedImageUrl } from '../../../js/utils/recipes/recipe-image-utils.js';
import { showErrorModal, logError } from '../../../js/utils/error-handler.js';
import { validateRecipeForm } from '../../../js/utils/form/form-validation-utils.js';
import { collectRecipeFormData } from '../../../js/utils/form/form-data-collector.js';
import { clearForm, setFormDisabledState } from '../../../js/utils/form/form-state-manager.js';
import { formProtectionManager } from '../../../js/utils/form/form-protection-manager.js';

import '../../media/image-handler/image-handler.js';
import '../../modals/message-modal/message-modal.js';
import '../../modals/confirmation_modal/confirmation_modal.js';
import './parts/recipe-metadata-fields.js';
import './parts/form-button-group.js';
import './parts/recipe-ingredients-list.js';
import './parts/recipe-instructions-list.js';
import './parts/recipe-comments-list.js';
import './parts/recipe-related-field.js';
import '../../media/media-instructions-editor/media-instructions-editor.js';
import '../recipe_import_modal/recipe_import_modal.js';
import { mapExtractedDataToForm } from '../../../js/utils/recipe-extractor-utils.js';
import authService from '../../../js/services/auth-service.js';

import styles from './recipe_form_component.css?inline';
import baseButtonStyles from '../../../styles/components/base_button.css?inline';

class RecipeFormComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.recipeData = {}; // To store recipe data
    this.isProtectionEnabled = false;
    this.isDirty = false;

    this.clearButtonText = this.hasAttribute('clear-button-text')
      ? this.getAttribute('clear-button-text')
      : 'נקה';
    this.submitButtonText = this.hasAttribute('submit-button-text')
      ? this.getAttribute('submit-button-text')
      : 'שלח מתכון';
    this.formProtectionDisabled = this.hasAttribute('disable-form-protection');
  }

  async connectedCallback() {
    this.render();
    this.setupEventListeners();

    this.setupFormProtection();

    // Auth observer for dynamic button visibility
    this.handleAuthUpdate = this.handleAuthUpdate.bind(this);
    authService.addAuthObserver(this.handleAuthUpdate);

    const recipeId = this.getAttribute('recipe-id');
    if (recipeId) {
      await this.setRecipeData(recipeId);
    } else {
      setTimeout(() => {
        this.collectFormData();
        this.enableFormProtection(this.recipeData);
      }, 500);
    }
  }

  disconnectedCallback() {
    this.cleanupFormProtection();
    authService.removeAuthObserver(this.handleAuthUpdate);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${baseButtonStyles}
      </style>
      <style>
        ${styles}
      </style>
      ${this.template()}
    `;
  }

  template() {
    return `
      <div dir="rtl" class="recipe-form">

        <recipe-import-modal id="import-modal"></recipe-import-modal>

        <div class="recipe-form__error-message" style="display: none;">
          נא למלא את כל שדות החובה
        </div>

        <form id="recipe-form">

          <!-- 01 — פרטי המתכון -->
          <section class="recipe-sect" id="s-details">
            <header class="recipe-sect__header">
              <div>
                <span class="recipe-sect__n">01 — פרטי המתכון</span>
                <h2 class="recipe-sect__h">הכותרת <em>הראשית.</em></h2>
                <p class="recipe-sect__sub">שם, תיאור קצר, וקטגוריה.</p>
              </div>
            </header>
            <recipe-metadata-fields id="metadata-fields"></recipe-metadata-fields>
          </section>

          <!-- 02 — מצרכים -->
          <section class="recipe-sect" id="s-ingredients">
            <header class="recipe-sect__header">
              <div>
                <span class="recipe-sect__n">02 — מצרכים</span>
                <h2 class="recipe-sect__h">כמויות <em>ויחידות.</em></h2>
                <p class="recipe-sect__sub">קבץ מצרכים לקטגוריות אם זה עוזר — "לבצק", "לציפוי" וכדומה.</p>
              </div>
            </header>
            <recipe-ingredients-list id="ingredients-list"></recipe-ingredients-list>
          </section>

          <!-- 03 — הוראות הכנה -->
          <section class="recipe-sect" id="s-instructions">
            <header class="recipe-sect__header">
              <div>
                <span class="recipe-sect__n">03 — הוראות הכנה</span>
                <h2 class="recipe-sect__h">שלבים <em>ושלבי עבודה.</em></h2>
                <p class="recipe-sect__sub">חלק את השיטה לשלבים. הוסף תמונה לכל שלב אם זה עוזר.</p>
              </div>
            </header>
            <recipe-instructions-list id="instructions-list" mode="flat"></recipe-instructions-list>
          </section>

          <!-- 04 — תמונות ומדיה -->
          <section class="recipe-sect" id="s-cover">
            <header class="recipe-sect__header">
              <div>
                <span class="recipe-sect__n">04 — תמונות ומדיה</span>
                <h2 class="recipe-sect__h">התמונה <em>הסופית.</em></h2>
                <p class="recipe-sect__sub">תמונה ראשית בולטת, ותמונות נוספות של המתכון לפי רצונך.</p>
              </div>
              <span class="recipe-sect__meta">JPG, PNG · עד 20MB</span>
            </header>
            <div class="recipe-form__group">
              <image-handler id="recipe-images"></image-handler>
            </div>
            <div class="recipe-form__group" style="margin-top: 20px;">
              <label class="recipe-form__label">הוראות מצולמות</label>
              <p class="recipe-form__help-text">הוסף תמונות או סרטונים המדגימים שלבי הכנה</p>
              <media-instructions-editor
                id="media-instructions-editor"
                media-data='[]'
                recipe-id="">
              </media-instructions-editor>
            </div>
          </section>

          <!-- 05 — הערות משפחה -->
          <section class="recipe-sect" id="s-notes">
            <header class="recipe-sect__header">
              <div>
                <span class="recipe-sect__n">05 — הערות משפחה</span>
                <h2 class="recipe-sect__h">טיפים <em>ווריאציות.</em></h2>
                <p class="recipe-sect__sub">דברים שהיית אומר למישהו שמבשל את זה בפעם הראשונה.</p>
              </div>
              <span class="recipe-sect__meta">אופציונלי</span>
            </header>
            <div class="recipe-form__group">
              <recipe-comments-list id="comments-list"></recipe-comments-list>
            </div>
          </section>

          <!-- 06 — קרדיט -->
          <section class="recipe-sect" id="s-attr">
            <header class="recipe-sect__header">
              <div>
                <span class="recipe-sect__n">06 — קרדיט</span>
                <h2 class="recipe-sect__h">של מי <em>המתכון הזה?</em></h2>
                <p class="recipe-sect__sub">קרדיט לטבח המקורי — שם, קישור, או שניהם.</p>
              </div>
              <span class="recipe-sect__meta">אופציונלי</span>
            </header>
            <div class="recipe-form__group">
              <label for="attribution" class="recipe-form__label">קרדיט</label>
              <input type="text" id="attribution" name="attribution" class="recipe-form__input"
                placeholder='סבתא רות · או https://...' />
              <span class="recipe-form__hint">שם, קישור, או שניהם. יוצג בדף המתכון.</span>
            </div>
          </section>

          <!-- 07 — מתכונים קשורים -->
          <section class="recipe-sect" id="s-related">
            <header class="recipe-sect__header">
              <div>
                <span class="recipe-sect__n">07 — מתכונים קשורים</span>
                <h2 class="recipe-sect__h">מתכונים <em>משלימים.</em></h2>
                <p class="recipe-sect__sub">מתכונים שמשתלבים יחד — רוטב לסלט, ציפוי לעוגה, ותוספת לעיקרית.</p>
              </div>
              <span class="recipe-sect__meta">אופציונלי</span>
            </header>
            <recipe-related-field id="related-field"></recipe-related-field>
          </section>

          <form-button-group
            id="form-buttons"
            clear-text="${this.clearButtonText}"
            submit-text="${this.submitButtonText}"
            ${this.hasAttribute('hide-actions') ? 'style="display:none"' : ''}>
          </form-button-group>

        </form>
      </div>
      <message-modal></message-modal>
    `;
  }

  setupEventListeners() {
    // Add event listener for Instructions List component
    const instructionsList = this.shadowRoot.getElementById('instructions-list');
    instructionsList.addEventListener('instructions-changed', () => {
      // No validation on every change - only on submit like before
    });

    // Add event listener to show image preview
    const imageHandler = this.shadowRoot.getElementById('recipe-images');

    imageHandler.addEventListener('primary-image-changed', (e) => {
      // Update internal state when primary image changes
      this.recipeData.primaryImageId = e.detail.imageId;
    });

    // Add event listener for media instructions editor
    const mediaEditor = this.shadowRoot.getElementById('media-instructions-editor');
    if (mediaEditor) {
      mediaEditor.addEventListener('media-changed', (e) => {
        this.recipeData.mediaInstructions = e.detail.mediaInstructions;
      });
    }

    // Import modal
    const importModal = this.shadowRoot.getElementById('import-modal');
    if (importModal) {
      importModal.addEventListener('recipe-extracted', (e) => {
        this.handleRecipeExtracted(e.detail.data, e.detail.sourceUrl);
      });
    }

    // Add event listeners for form button group events
    const buttonGroup = this.shadowRoot.getElementById('form-buttons');
    buttonGroup.addEventListener('clear-clicked', () => {
      this.handleClearForm();
    });
    buttonGroup.addEventListener('submit-clicked', () => {
      this.handleFormSubmit();
    });

    // Add event listener for comments list
    const commentsList = this.shadowRoot.getElementById('comments-list');
    if (commentsList) {
      commentsList.addEventListener('list-changed', () => {
        // No validation on every change
      });
    }
  }

  /**
   * Validate form using form validation utilities
   */
  validateForm() {
    this.collectFormData();
    return validateRecipeForm(this.recipeData, this.shadowRoot);
  }

  collectFormData() {
    this.recipeData = collectRecipeFormData(this.shadowRoot);
  }

  dispatchRecipeData() {
    const recipeDataEvent = new CustomEvent('recipe-data-collected', {
      detail: { recipeData: this.recipeData },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(recipeDataEvent);
  }

  handleFormSubmit() {
    if (this.validateForm()) {
      this.collectFormData();

      if (this.isProtectionEnabled) {
        formProtectionManager.temporaryDisable();
      }

      this.dispatchRecipeData();

      if (this.isProtectionEnabled) {
        formProtectionManager.enable();
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async handleClearForm() {
    if (this.isDirty) {
      const shouldClear = await this.confirmClearForm();
      if (!shouldClear) {
        return;
      }
    }

    this.clearForm();

    if (this.isProtectionEnabled) {
      formProtectionManager.cleanup();
      this.isProtectionEnabled = false;

      // Wait for form clear to complete, then collect the empty state
      setTimeout(() => {
        this.collectFormData(); // Collect the now-empty form data
        this.enableFormProtection(this.recipeData);
        this.isDirty = false; // Ensure internal dirty state is reset
        this.updateDirtyStateIndicators(false); // Update UI indicators
      }, 200);
    }

    // Dispatch the clear button click event
    this.dispatchEvent(
      new CustomEvent('clear-button-clicked', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Shows confirmation dialog for clearing dirty form
   * @returns {Promise<boolean>} True if user confirms clear action
   */
  confirmClearForm() {
    return new Promise((resolve) => {
      // Create a simple confirmation modal
      const modal = document.createElement('confirmation-modal');
      document.body.appendChild(modal);

      // Set up event listeners
      const handleApproved = () => {
        document.body.removeChild(modal);
        resolve(true);
        modal.removeEventListener('confirm-approved', handleApproved);
        modal.removeEventListener('confirm-rejected', handleRejected);
      };

      const handleRejected = () => {
        document.body.removeChild(modal);
        resolve(false);
        modal.removeEventListener('confirm-approved', handleApproved);
        modal.removeEventListener('confirm-rejected', handleRejected);
      };

      modal.addEventListener('confirm-approved', handleApproved);
      modal.addEventListener('confirm-rejected', handleRejected);

      modal.confirm(
        'יש לך שינויים שלא נשמרו שיאבדו. האם אתה בטוח שברצונך לנקות את הטופס?',
        'נקה טופס',
        'נקה טופס',
        'ביטול',
      );
    });
  }

  clearForm() {
    clearForm(this.shadowRoot);

    if (this.isProtectionEnabled) {
      this.collectFormData();
      formProtectionManager.initialize(this.shadowRoot, this.recipeData);
    }
  }

  submitForm() {
    this.handleFormSubmit();
  }

  requestClear() {
    this.handleClearForm();
  }

  openImportModal() {
    const importModal = this.shadowRoot.getElementById('import-modal');
    if (importModal) importModal.open();
  }

  async setRecipeData(recipeId) {
    try {
      const data = await RecipeService.get(recipeId);

      if (data) {
        this.recipeData = data;
        await this.populateFromData(data, recipeId);
      } else {
        console.warn('No such document!');
      }

      // Re-collect from the form so the dirty-state baseline matches
      // the shape produced by subsequent captures (Firestore-raw and
      // form-collected shapes diverge — e.g. source:'existing' on
      // images, instruction string normalization).
      setTimeout(() => {
        this.collectFormData();
        this.enableFormProtection(this.recipeData);
      }, 500);
    } catch (error) {
      console.error('Error fetching recipe:', error);
      setTimeout(() => {
        this.collectFormData();
        this.enableFormProtection(this.recipeData);
      }, 500);
    }
  }

  async populateFromData(data, recipeId = null) {
    const metadataFields = this.shadowRoot.getElementById('metadata-fields');
    if (metadataFields) {
      metadataFields.populateFields(data);
    }

    const commentsList = this.shadowRoot.getElementById('comments-list');
    if (commentsList) {
      commentsList.populateData(data.comments);
    }

    const attributionField = this.shadowRoot.getElementById('attribution');
    if (attributionField && data.attribution) {
      attributionField.value = data.attribution;
    }

    const ingredientsList = this.shadowRoot.getElementById('ingredients-list');
    if (ingredientsList) {
      if (data.ingredientSections && data.ingredientSections.length > 0) {
        ingredientsList.populateData({ sections: data.ingredientSections });
      } else if (data.ingredients) {
        ingredientsList.populateData(data.ingredients);
      }
    }

    const instructionsList = this.shadowRoot.getElementById('instructions-list');
    if (instructionsList) {
      if (data.stages && data.stages.length > 0) {
        instructionsList.populateInstructions({ stages: data.stages });
      } else if (data.instructions && data.instructions.length > 0) {
        // For flat instructions, ensure it's an array of strings
        instructionsList.populateInstructions(data.instructions);
      }
    }

    if (data.images) {
      await this.populateImages(data.images);
    }

    // Populate media instructions if present
    const mediaEditor = this.shadowRoot.getElementById('media-instructions-editor');
    if (mediaEditor) {
      if (data.mediaInstructions) {
        mediaEditor.setAttribute('media-data', JSON.stringify(data.mediaInstructions));
      }
      if (recipeId) {
        mediaEditor.setAttribute('recipe-id', recipeId);
      }
    }

    // Populate related recipes (edit mode)
    const relatedField = this.shadowRoot.getElementById('related-field');
    if (relatedField) {
      if (recipeId) relatedField.setExcludeId(recipeId);
      if (Array.isArray(data.relatedRecipes) && data.relatedRecipes.length) {
        await relatedField.populateData(data.relatedRecipes);
      }
    }
  }

  /**
   * Updates UI based on authentication state
   * @param {Object} state - Auth state object
   */
  handleAuthUpdate(_state) {}

  handleRecipeExtracted(extractedData, sourceUrl = null) {
    console.log('Extracted data:', extractedData);
    const mappedData = mapExtractedDataToForm(extractedData);

    this.populateFromData(mappedData);

    // If extracted from a URL and the attribution field is still empty, fill it in
    if (sourceUrl) {
      const attributionField = this.shadowRoot.getElementById('attribution');
      if (attributionField && !attributionField.value.trim()) {
        attributionField.value = sourceUrl;
      }
    }

    this.collectFormData(); // Update internal state
    this.isDirty = true;
    this.updateDirtyStateIndicators(true);
  }

  // FIXME: create file object before re-uploading images
  async populateImages(images) {
    const imageHandler = this.shadowRoot.getElementById('recipe-images');

    for (const image of images) {
      try {
        const previewUrl = await getOptimizedImageUrl(image, '400x400');
        if (previewUrl) {
          // Spread the full image object so persistent fields (e.g. aiEnhanced)
          // survive the edit round-trip. Transient form fields are layered on top.
          imageHandler.addImage({
            ...image,
            file: null,
            preview: previewUrl,
            source: 'existing',
          });
        }
      } catch (error) {
        console.error('Error loading image:', error);
      }
    }
  }

  /**
   * Sets up form protection event listeners
   */
  setupFormProtection() {
    // Listen for form protection events
    this.addEventListener('form-dirty-state-changed', this.handleDirtyStateChange.bind(this));

    // Add change detection to form fields
    this.setupChangeDetection();
  }

  /**
   * Sets up change detection for form fields
   */
  setupChangeDetection() {
    // Use a debounced function to check dirty state
    let checkDirtyStateTimeout;

    const debouncedDirtyCheck = () => {
      clearTimeout(checkDirtyStateTimeout);
      checkDirtyStateTimeout = setTimeout(() => {
        formProtectionManager.checkDirtyState();
      }, 300);
    };

    // Listen to various change events including keyup for delete detection
    const eventTypes = ['input', 'change', 'paste', 'keyup'];
    eventTypes.forEach((eventType) => {
      this.shadowRoot.addEventListener(eventType, debouncedDirtyCheck);
    });

    // Listen to component-specific events
    this.addEventListener('ingredients-changed', debouncedDirtyCheck);
    this.addEventListener('instructions-changed', debouncedDirtyCheck);
    this.addEventListener('images-changed', debouncedDirtyCheck);
    this.addEventListener('media-changed', debouncedDirtyCheck);
    this.addEventListener('related-changed', debouncedDirtyCheck);

    // Also listen for cut events (when users delete content with Ctrl+X)
    this.shadowRoot.addEventListener('cut', debouncedDirtyCheck);
  }

  /**
   * Enables form protection
   * @param {Object} initialData - Initial form data (optional)
   */
  enableFormProtection(initialData = null) {
    if (this.isProtectionEnabled) return;

    const dataToUse = initialData || this.recipeData;
    formProtectionManager.initialize(this.shadowRoot, dataToUse);
    this.isProtectionEnabled = true;

    // disable-form-protection silences nav-away prompts but keeps
    // dirty-state events flowing for save-button gating.
    if (this.formProtectionDisabled) {
      formProtectionManager.temporaryDisable();
    }
  }

  /**
   * Disables form protection temporarily
   */
  disableFormProtection() {
    if (!this.isProtectionEnabled) return;

    formProtectionManager.temporaryDisable();
    this.isProtectionEnabled = false;
  }

  /**
   * Cleans up form protection
   */
  cleanupFormProtection() {
    if (this.isProtectionEnabled) {
      formProtectionManager.cleanup();
      this.isProtectionEnabled = false;
    }
  }

  /**
   * Handles dirty state changes
   * @param {CustomEvent} event - Dirty state change event
   */
  handleDirtyStateChange(event) {
    this.isDirty = event.detail.isDirty;

    // Update visual indicators
    this.updateDirtyStateIndicators(this.isDirty);

    // Dispatch event for parent components
    this.dispatchEvent(
      new CustomEvent('form-dirty-changed', {
        detail: { isDirty: this.isDirty },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Updates visual indicators for dirty state
   * @param {boolean} isDirty - Whether form is dirty
   */
  updateDirtyStateIndicators(isDirty) {
    // Add/remove dirty class to form
    const form = this.shadowRoot.getElementById('recipe-form');
    if (form) {
      if (isDirty) {
        form.classList.add('form-dirty');
      } else {
        form.classList.remove('form-dirty');
      }
    }

    // Update header to show unsaved changes indicator via CSS pseudo-element
    const header = this.shadowRoot.querySelector('.recipe-form__header');
    if (header) {
      if (isDirty) {
        header.classList.add('unsaved-changes');
      } else {
        header.classList.remove('unsaved-changes');
      }
    }
  }

  showErrorMessage(error) {
    const messageModal = this.shadowRoot.querySelector('message-modal');
    logError(error, 'Recipe form');
    showErrorModal(messageModal, error);
  }

  setDisabled(isDisabled) {
    setFormDisabledState(this.shadowRoot, isDisabled);
  }

  /**
   * Public API: Get all media in order (both uploaded and pending)
   * Delegates to the media-instructions-editor component without exposing internal structure
   * @returns {Array} Array of media items with position tracking
   */
  getAllMediaInOrder() {
    const mediaEditor = this.shadowRoot.getElementById('media-instructions-editor');
    if (!mediaEditor || typeof mediaEditor.getAllMediaInOrder !== 'function') {
      return [];
    }
    return mediaEditor.getAllMediaInOrder();
  }
}

customElements.define('recipe-form-component', RecipeFormComponent);
