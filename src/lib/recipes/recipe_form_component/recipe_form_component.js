import { RecipeService } from '../../../js/services/recipes/recipe-service.js';
import { RecipeImageService } from '../../../js/services/recipes/recipe-image-service.js';
import { showErrorModal, logError } from '../../../js/utils/error-handler.js';
import { deepEqual } from '../../forms/form-field-base.js';

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
import authService from '../../../js/services/auth/auth-service.js';

import styles from './recipe_form_component.css?inline';
import baseButtonStyles from '../../../styles/components/base_button.css?inline';

class RecipeFormComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.recipeData = {}; // Last collected recipe data (submit payload)
    this.isDirty = false;

    // Dirty-tracking baseline (snapshot of the collected form data). Compared via
    // deepEqual on every change. Replaces the former FormProtectionManager singleton.
    this._baseline = null;
    this._baselineReady = false;
    // disable-form-protection silences nav-away prompts but keeps dirty-state
    // events flowing (used by the edit flow for save-button gating).
    this._navGuardEnabled = !this.hasAttribute('disable-form-protection');

    this.clearButtonText = this.hasAttribute('clear-button-text')
      ? this.getAttribute('clear-button-text')
      : 'נקה';
    this.submitButtonText = this.hasAttribute('submit-button-text')
      ? this.getAttribute('submit-button-text')
      : 'שלח מתכון';
  }

  async connectedCallback() {
    this.render();
    this.collectFieldRefs();
    this.setupEventListeners();
    this.setupChangeDetection();
    this.setupNavGuard();

    // Auth observer for dynamic button visibility
    this.handleAuthUpdate = this.handleAuthUpdate.bind(this);
    authService.addAuthObserver(this.handleAuthUpdate);

    const recipeId = this.getAttribute('recipe-id');
    if (recipeId) {
      await this.setRecipeData(recipeId);
    } else {
      // Fresh form — baseline is the empty state. Children upgrade synchronously
      // during render(), so refs are ready; defer to a microtask to be safe.
      queueMicrotask(() => this.captureBaseline());
    }
  }

  disconnectedCallback() {
    this.teardownNavGuard();
    authService.removeAuthObserver(this.handleAuthUpdate);
  }

  /**
   * Collects references to all form-field sub-components once, keyed by logical
   * name. The orchestrator fans the unified contract out over this map.
   */
  collectFieldRefs() {
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._fields = {
      metadata: $('metadata-fields'),
      ingredients: $('ingredients-list'),
      instructions: $('instructions-list'),
      images: $('recipe-images'),
      media: $('media-instructions-editor'),
      comments: $('comments-list'),
      related: $('related-field'),
    };
    this._attributionInput = $('attribution');
  }

  /** @returns {Array} the field components that are present */
  get _fieldList() {
    return Object.values(this._fields || {}).filter(Boolean);
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
    // Import modal
    const importModal = this.shadowRoot.getElementById('import-modal');
    if (importModal) {
      importModal.addEventListener('recipe-extracted', (e) => {
        this.handleRecipeExtracted(e.detail.data, e.detail.sourceUrl);
      });
    }

    // Form button group events
    const buttonGroup = this.shadowRoot.getElementById('form-buttons');
    buttonGroup.addEventListener('clear-clicked', () => this.handleClearForm());
    buttonGroup.addEventListener('submit-clicked', () => this.handleFormSubmit());
  }

  /**
   * Validates the form by collecting data, fanning validate() out over the
   * fields, aggregating errors, reflecting them per-field, and toggling the
   * error banner.
   * @returns {boolean} whether the form is valid
   */
  validateForm() {
    this.collectFormData();

    let allErrors = {};
    let isValid = true;
    for (const field of this._fieldList) {
      if (typeof field.validate !== 'function') continue;
      const result = field.validate();
      if (!result.isValid) isValid = false;
      Object.assign(allErrors, result.errors);
    }

    // Reflect errors back into each field (each picks out the keys it owns and
    // clears the rest).
    for (const field of this._fieldList) {
      if (typeof field.setValidationState === 'function') field.setValidationState(allErrors);
    }

    const errorMessage = this.shadowRoot.querySelector('.recipe-form__error-message');
    if (errorMessage) {
      if (isValid) {
        errorMessage.style.display = 'none';
      } else {
        const messages = Object.values(allErrors).filter((e) => typeof e === 'string');
        errorMessage.textContent = messages.length
          ? messages.join(' ')
          : 'ישנם שגיאות בטופס. אנא תקן אותן.';
        errorMessage.style.display = 'block';
      }
    }

    return isValid;
  }

  /** Collects the current form data into this.recipeData (submit payload). */
  collectFormData() {
    this.recipeData = this.buildRecipeData();
  }

  /**
   * Public API: returns the current form data without mutating internal state.
   * Used by host pages (e.g. the propose-page preview) instead of reaching into
   * the shadow DOM.
   * @returns {Object}
   */
  getRecipeData() {
    return this.buildRecipeData();
  }

  /**
   * Builds a recipe-data object from the fields' getValue() output, applying the
   * per-field shape transformations the persistence layer expects.
   * @returns {Object}
   */
  buildRecipeData() {
    const f = this._fields;
    const recipeData = { ...f.metadata.getValue() };

    // Ingredients: flat array, or sectioned array (items carry a title).
    const ingredients = f.ingredients.getValue();
    if (Array.isArray(ingredients) && ingredients.length > 0 && ingredients[0].title) {
      recipeData.ingredientSections = ingredients;
    } else if (Array.isArray(ingredients)) {
      recipeData.ingredients = ingredients;
    }

    // Instructions: flat array of {text}, or staged sections.
    const instructions = f.instructions.getValue();
    if (Array.isArray(instructions) && instructions.length > 0 && instructions[0]?.title) {
      recipeData.stages = instructions.map((stage) => ({
        title: stage.title,
        instructions: stage.items ? stage.items.map((item) => item.text || '') : [],
      }));
    } else if (Array.isArray(instructions)) {
      recipeData.instructions = instructions.map((item) =>
        typeof item === 'string' ? item : item.text || '',
      );
    }

    // Images: { images, removed }. New images carry a File; existing ones keep
    // their persisted metadata.
    const { images = [], removed = [] } = f.images.getValue();
    recipeData.images = images.map((img) => {
      if (img.file) {
        return {
          file: img.file,
          preview: img.preview,
          isPrimary: img.isPrimary ?? false,
          access: 'public',
          uploadedBy: authService.getCurrentUser()?.uid || 'anonymous',
          source: 'new',
        };
      }
      const { file: _f, preview: _p, source: _s, ...rest } = img;
      const existing = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      existing.isPrimary = img.isPrimary ?? false;
      existing.source = 'existing';
      return existing;
    });
    recipeData.toDelete = removed;

    // Media instructions: map the ordered list to the stored shape, plus the
    // storage paths queued for deletion on save (deferred-delete contract).
    const { all: media = [], removed: mediaRemoved = [] } = f.media.getValue();
    if (media.length > 0) {
      recipeData.mediaInstructions = media.map((item) => ({
        id: item.id,
        path: item.path || item.preview,
        caption: item.caption,
        type: item.type,
        order: item.position,
        pending: !!item.file,
      }));
    }
    recipeData.mediaToDelete = mediaRemoved;

    // Comments (optional).
    const comments = f.comments.getValue();
    if (comments && comments.length) recipeData.comments = comments;

    // Attribution (bare input on the orchestrator).
    if (this._attributionInput) {
      const attribution = this._attributionInput.value.trim();
      if (attribution) recipeData.attribution = attribution;
    }

    // Related recipes (array of IDs).
    recipeData.relatedRecipes = f.related.getValue();

    return recipeData;
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
    // validateForm() already collected the data; no second collection needed.
    if (this.validateForm()) {
      this.dispatchRecipeData();
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

  /**
   * Resets every field to its empty value and re-baselines dirty tracking, so a
   * cleared form is considered clean.
   */
  clearForm() {
    for (const field of this._fieldList) {
      if (typeof field.clear === 'function') field.clear();
    }
    if (this._attributionInput) {
      this._attributionInput.value = '';
      this._attributionInput.classList.remove('recipe-form__input--invalid');
    }

    const form = this.shadowRoot.getElementById('recipe-form');
    if (form) form.reset();

    const errorMessage = this.shadowRoot.querySelector('.recipe-form__error-message');
    if (errorMessage) errorMessage.style.display = 'none';

    this.captureBaseline();
    this.recomputeDirty();
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
    } catch (error) {
      console.error('Error fetching recipe:', error);
    }

    // Capture the baseline AFTER all (async) population completes, so the
    // dirty-state baseline reflects the form-collected shape rather than the
    // raw Firestore shape. Replaces the former fragile 500ms setTimeout.
    this.captureBaseline();
  }

  async populateFromData(data, recipeId = null) {
    const f = this._fields;

    if (f.metadata) f.metadata.setValue(data);
    if (f.comments) f.comments.setValue(data.comments || []);

    if (this._attributionInput && data.attribution) {
      this._attributionInput.value = data.attribution;
    }

    if (f.ingredients) {
      if (data.ingredientSections && data.ingredientSections.length > 0) {
        f.ingredients.setValue({ sections: data.ingredientSections });
      } else if (data.ingredients) {
        f.ingredients.setValue(data.ingredients);
      }
    }

    if (f.instructions) {
      if (data.stages && data.stages.length > 0) {
        f.instructions.setValue({ stages: data.stages });
      } else if (data.instructions && data.instructions.length > 0) {
        f.instructions.setValue(data.instructions);
      }
    }

    if (data.images) {
      await this.populateImages(data.images);
    }

    if (f.media) {
      f.media.setValue({ mediaData: data.mediaInstructions || [], recipeId: recipeId || '' });
    }

    // Related recipes (edit mode) — async name resolution.
    if (f.related) {
      if (recipeId) f.related.setExcludeId(recipeId);
      if (Array.isArray(data.relatedRecipes) && data.relatedRecipes.length) {
        await f.related.setValue(data.relatedRecipes);
      }
    }
  }

  /**
   * Updates UI based on authentication state
   * @param {Object} state - Auth state object
   */
  handleAuthUpdate(_state) {}

  async handleRecipeExtracted(extractedData, sourceUrl = null) {
    const mappedData = mapExtractedDataToForm(extractedData);

    await this.populateFromData(mappedData);

    // If extracted from a URL and the attribution field is still empty, fill it in
    if (sourceUrl && this._attributionInput && !this._attributionInput.value.trim()) {
      this._attributionInput.value = sourceUrl;
    }

    // Imported content is unsaved relative to the baseline — recompute so the
    // form is flagged dirty (the baseline is unchanged by populateFromData).
    this.recomputeDirty();
  }

  // FIXME: create file object before re-uploading images
  async populateImages(images) {
    const imageHandler = this.shadowRoot.getElementById('recipe-images');

    for (const image of images) {
      try {
        const previewUrl = await RecipeImageService.getOptimizedUrl(image, '400x400');
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

  // --- Dirty tracking & navigation protection (per-instance) ---

  /**
   * Wires change detection. Any field mutation (the unified value-changed event
   * bubbles up) or native edit on the orchestrator's own inputs triggers a
   * debounced dirty recheck against the baseline.
   */
  setupChangeDetection() {
    let timeout;
    const debounced = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => this.recomputeDirty(), 300);
    };

    // Native edits on orchestrator-owned inputs (e.g. attribution).
    ['input', 'change', 'paste', 'keyup', 'cut'].forEach((type) => {
      this.shadowRoot.addEventListener(type, debounced);
    });

    // Unified contract events bubbling from every field sub-component.
    this.addEventListener('value-changed', debounced);
    this.addEventListener('dirty-changed', debounced);
  }

  /**
   * Snapshots the current collected form data as the clean baseline and resets
   * the dirty flag. Called once population/clearing settles. If the form was
   * previously dirty, emits form-dirty-changed(false) so external listeners
   * (e.g. the edit-modal save-button gating) learn the form is clean again.
   */
  captureBaseline() {
    this._baseline = this.buildRecipeData();
    this._baselineReady = true;
    const wasDirty = this.isDirty;
    this.isDirty = false;
    this.updateDirtyStateIndicators(false);
    if (wasDirty) {
      this.dispatchEvent(
        new CustomEvent('form-dirty-changed', {
          detail: { isDirty: false },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** @returns {boolean} whether the form differs from the baseline */
  isFormDirty() {
    if (!this._baselineReady) return false;
    return !deepEqual(this._baseline, this.buildRecipeData());
  }

  /**
   * Recomputes dirty state and, when it changes, updates indicators and emits
   * form-dirty-changed for parent components (e.g. edit-modal save-button gating).
   */
  recomputeDirty() {
    const dirty = this.isFormDirty();
    if (dirty === this.isDirty) return;
    this.isDirty = dirty;
    this.updateDirtyStateIndicators(dirty);
    this.dispatchEvent(
      new CustomEvent('form-dirty-changed', {
        detail: { isDirty: dirty },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Marks the form as saved: re-baselines to the current data. captureBaseline()
   * emits form-dirty-changed(false) when the form was dirty, which disables save
   * buttons after a save.
   */
  markSaved() {
    this.captureBaseline();
  }

  /** Registers the beforeunload listener and router navigation guard. */
  setupNavGuard() {
    this._onBeforeUnload = (event) => {
      if (!this._navGuardEnabled || !this.isFormDirty()) return undefined;
      const message = 'You have unsaved changes. Are you sure you want to leave?';
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', this._onBeforeUnload);

    const router = window.spa?.router;
    if (router && typeof router.addNavigationGuard === 'function') {
      this._navGuardId = 'form-protection';
      router.addNavigationGuard(this._navGuardId, this.checkNavGuard.bind(this));
    }
  }

  /** Removes the beforeunload listener and router navigation guard. */
  teardownNavGuard() {
    if (this._onBeforeUnload) {
      window.removeEventListener('beforeunload', this._onBeforeUnload);
      this._onBeforeUnload = null;
    }
    const router = window.spa?.router;
    if (this._navGuardId && router && typeof router.removeNavigationGuard === 'function') {
      router.removeNavigationGuard(this._navGuardId);
      this._navGuardId = null;
    }
  }

  /**
   * Router navigation guard — prompts before leaving a dirty form.
   * @returns {boolean|Promise<boolean>} true to allow navigation
   */
  checkNavGuard() {
    if (!this._navGuardEnabled || !this.isFormDirty()) return true;
    return new Promise((resolve) => this.showLeaveConfirmation(resolve));
  }

  /**
   * Shows the unsaved-changes confirmation modal.
   * @param {(allow: boolean) => void} resolve
   */
  showLeaveConfirmation(resolve) {
    let modal = document.querySelector('confirmation-modal');
    if (!modal) {
      modal = document.createElement('confirmation-modal');
      document.body.appendChild(modal);
    }

    const cleanup = () => {
      modal.removeEventListener('confirm-approved', onApprove);
      modal.removeEventListener('confirm-rejected', onReject);
    };
    const onApprove = () => {
      cleanup();
      // Allow navigation; suppress further prompts for this transition.
      this.isDirty = false;
      resolve(true);
    };
    const onReject = () => {
      cleanup();
      resolve(false);
    };

    modal.addEventListener('confirm-approved', onApprove);
    modal.addEventListener('confirm-rejected', onReject);
    modal.confirm(
      'יש לך שינויים שלא נשמרו שיאבדו. האם אתה בטוח שברצונך לעזוב את הדף?',
      'שינויים לא נשמרו',
      'המשך בכל זאת',
      'ביטול',
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

  /**
   * Enables/disables the whole form by fanning setDisabled() out over the fields,
   * plus the button group and the orchestrator's own attribution input.
   * @param {boolean} isDisabled
   */
  setDisabled(isDisabled) {
    for (const field of this._fieldList) {
      if (typeof field.setDisabled === 'function') field.setDisabled(isDisabled);
    }
    const buttonGroup = this.shadowRoot.getElementById('form-buttons');
    if (buttonGroup && typeof buttonGroup.setDisabled === 'function') {
      buttonGroup.setDisabled(isDisabled);
    }
    if (this._attributionInput) this._attributionInput.disabled = isDisabled;
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
