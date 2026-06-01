/**
 * SuggestEditModal Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * A modal that lets any signed-in user suggest an edit to an existing recipe.
 * Wraps `recipe-form-component` (seeded with the live recipe) but, instead of
 * writing to the recipe like the manager edit flow, submits the collected form
 * state to `RecipeEditSuggestionService.create()` as a pending suggestion. The
 * live recipe is untouched until a manager approves the suggestion.
 *
 * @example
 * // HTML
 * <suggest-edit-modal></suggest-edit-modal>
 *
 * // JavaScript
 * const modal = document.querySelector('suggest-edit-modal');
 * modal.openForRecipe('recipe-123');
 *
 * @fires edit-suggested - When a suggestion is successfully submitted.
 */
import authService from '../../../js/services/auth/auth-service.js';
import { RecipeEditSuggestionService } from '../../../js/services/recipes/recipe-edit-suggestion-service.js';
import { logError, getErrorMessage } from '../../../js/utils/error-handler.js';

import '../recipe_form_component/recipe_form_component.js';
import '../../utilities/modal/modal.js';
import '../../utilities/loading-spinner/loading-spinner.js';
import '../../modals/message-modal/message-modal.js';

class SuggestEditModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.recipeId = null;
  }

  connectedCallback() {
    this.render();
    this.form = this.shadowRoot.querySelector('recipe-form-component');
    this.modal = this.shadowRoot.querySelector('custom-modal');
    this.setupEventListeners();

    this._handleResize = this.handleResize.bind(this);
    this._handleResize();
    window.addEventListener('resize', this._handleResize);
  }

  disconnectedCallback() {
    if (this._handleResize) window.removeEventListener('resize', this._handleResize);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .suggest-wrap {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          font-family: var(--font-ui-he, sans-serif);
        }
        .suggest-header {
          flex-shrink: 0;
          text-align: center;
          margin-bottom: 14px;
        }
        .suggest-header h2 {
          font-family: var(--font-display, serif);
          font-size: 22px;
          color: var(--ink, #1f1d18);
          margin: 0 0 4px;
        }
        .suggest-header p {
          font-size: 13px;
          color: var(--ink-3, rgba(31, 29, 24, 0.55));
          margin: 0;
        }
        .suggest-body {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }
        .note-group {
          margin-bottom: 16px;
        }
        .note-group label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--ink, #1f1d18);
          margin-bottom: 6px;
        }
        .note-group textarea {
          width: 100%;
          box-sizing: border-box;
          min-height: 56px;
          resize: vertical;
          padding: 10px 12px;
          border: 1.5px solid var(--hairline-strong, rgba(31, 29, 24, 0.15));
          border-radius: var(--r-sm, 10px);
          font-family: var(--font-ui-he, sans-serif);
          font-size: 14px;
          color: var(--ink, #1f1d18);
          background: var(--surface-0, #fafaf8);
        }
        .note-group textarea:focus {
          outline: none;
          border-color: var(--primary, #6a994e);
        }
      </style>

      <loading-spinner overlay border-radius="10px" size="60px" color="#ffffff">
        <custom-modal height="90vh" width="60vw" fullscreen-mobile>
          <div class="suggest-wrap" dir="rtl">
            <div class="suggest-header">
              <h2>הצע עריכה למתכון</h2>
              <p>השינויים שלך יישלחו לאישור מנהל לפני שיופיעו במתכון.</p>
            </div>
            <div class="suggest-body">
              <div class="note-group">
                <label for="suggest-note">הערה למנהל (אופציונלי)</label>
                <textarea id="suggest-note" placeholder="למשל: תיקנתי כמות בשלב 3"></textarea>
              </div>
              <recipe-form-component
                disable-form-protection
                clear-button-text="איפוס"
                submit-button-text="שלח לאישור">
              </recipe-form-component>
            </div>
          </div>
        </custom-modal>
      </loading-spinner>
      <message-modal></message-modal>
    `;
  }

  setupEventListeners() {
    this.form.addEventListener('recipe-data-collected', this.handleRecipeData.bind(this));
    // Clear resets the form back to the recipe's current data (not empty).
    this.form.addEventListener('clear-button-clicked', () => {
      if (this.recipeId) this.form.setRecipeData(this.recipeId);
    });
  }

  /**
   * Open the modal for a given recipe, seeding the form with its current data.
   * Resets first so reopening doesn't append images onto the previous load
   * (the form/image-handler is created once and reused).
   * @param {string} recipeId
   */
  openForRecipe(recipeId) {
    this.recipeId = recipeId;
    this.reset();
    this.form.setRecipeData(recipeId);
    this.modal.open();
  }

  close() {
    this.modal.close();
    this.reset();
  }

  /** Clear the form fields (incl. images) and the note, releasing the seeded state. */
  reset() {
    this.form?.clearForm?.();
    const note = this.shadowRoot.getElementById('suggest-note');
    if (note) note.value = '';
  }

  async handleRecipeData(event) {
    const recipeData = event.detail.recipeData;
    const spinner = this.shadowRoot.querySelector('loading-spinner');
    try {
      const user = authService.getCurrentUser();
      if (!user) throw new Error('עליך להתחבר כדי להציע עריכה');

      spinner.setAttribute('active', '');

      const mediaItemsOrdered = this.form?.getAllMediaInOrder?.() || [];
      const note = this.shadowRoot.getElementById('suggest-note')?.value.trim() || '';

      await RecipeEditSuggestionService.create({
        recipeId: this.recipeId,
        suggestedBy: user.uid,
        proposedChanges: recipeData,
        mediaItemsOrdered,
        note,
      });

      spinner.removeAttribute('active');
      this.close();
      this.dispatchEvent(
        new CustomEvent('edit-suggested', {
          detail: { recipeId: this.recipeId },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      spinner.removeAttribute('active');
      logError(error, 'Suggest edit');
      const messageModal = this.shadowRoot.querySelector('message-modal');
      messageModal?.show(getErrorMessage(error), 'שגיאה');
    }
  }

  handleResize() {
    if (window.innerWidth < 768) {
      this.modal.setHeight('100vh');
      this.modal.setWidth('100vw');
    } else {
      this.modal.setHeight('90vh');
      this.modal.setWidth('60vw');
    }
  }
}

customElements.define('suggest-edit-modal', SuggestEditModal);
