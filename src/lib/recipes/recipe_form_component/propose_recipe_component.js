/**
 * ProposeRecipeComponent
 *
 * This component allows users to propose new recipes. It handles the submission of recipe data, including image uploads, and saves the data to Firestore.
 *
 * Dependencies:
 * - RecipeFormComponent: This component is responsible for displaying and handling the recipe form.
 * - Firebase: The component uses Firebase for image storage (Firebase Storage) and data persistence (Firestore).
 * - MessageModal: If you are using a modal for error handling and success messages, this component is required.
 *
 * Example Usage:
 *
 * <propose-recipe-component></propose-recipe-component>
 *
 */

import { RecipeService, VISIBILITY, STAGE } from '../../../js/services/recipes/recipe-service.js';
import { RecipeSubmissionService } from '../../../js/services/recipes/recipe-submission-service.js';
import authService from '../../../js/services/auth/auth-service.js';
import { logError, getErrorMessage } from '../../../js/utils/error-handler.js';
import { showToast } from '../../notifications/toast-notification/toast-notification.js';
import { askSaveChoice } from '../save-choice/save-choice.js';
import alertStyles from '../../../styles/components/alerts.css?inline';

import './recipe_form_component.js';
import '../../utilities/loading-spinner/loading-spinner.js';

class ProposeRecipeComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  setupEventListeners() {
    const formComponent = this.shadowRoot.querySelector('recipe-form-component');
    formComponent.addEventListener('recipe-data-collected', this.handleRecipeData.bind(this));
    formComponent.addEventListener('recipe-imported', () => this.setImported(true));
    formComponent.addEventListener('clear-button-clicked', () => this.setImported(false));
  }

  /** After an import the save choice defaults to "not cooked yet" (To try). */
  setImported(imported) {
    this.imported = imported;
    const alert = this.shadowRoot.querySelector('.import-alert');
    if (alert) alert.hidden = !imported || !authService.isApproved();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${alertStyles}
        .import-alert { font-family: var(--font-ui-he); font-size: 14px; margin-bottom: var(--sp-md); }
        .import-alert[hidden] { display: none; }
      </style>
      <loading-spinner overlay>
        <div class="propose-recipe-container">
          <div class="alert alert--ok import-alert" role="status" dir="rtl" hidden>
            <span class="alert__icon">✓</span>
            <div>
              <b>המתכון יובא.</b>
              עברו על הפרטים לפני השמירה. בשמירה הוא יסומן ״עוד לא בושל״ — אפשר לשנות.
            </div>
          </div>
          <recipe-form-component hide-actions></recipe-form-component>
        </div>
      </loading-spinner>
      `;
  }

  async handleRecipeData(event) {
    const recipeData = event.detail.recipeData;
    const spinner = this.shadowRoot.querySelector('loading-spinner');

    // Approved family choose: cooked yet? (library / To try) and private or
    // submitted. Plain users can only propose (tested, submitted).
    const choice = authService.isApproved()
      ? await askSaveChoice({ defaultStage: this.imported ? STAGE.TO_TRY : STAGE.TESTED })
      : { stage: STAGE.TESTED, submit: true };
    if (!choice) return;

    try {
      spinner.setAttribute('active', '');
      const user = authService.getCurrentUser();
      const uploadedBy = user?.uid || 'anonymous';
      const formComponent = this.shadowRoot.querySelector('recipe-form-component');

      const {
        images: formImages,
        mediaInstructions: _m,
        toDelete: _td,
        mediaToDelete: _mtd,
        ...baseFields
      } = recipeData;
      const imagesToUpload = (formImages || []).map(({ file, isPrimary }) => ({ file, isPrimary }));

      // Always a private recipe of the author's; optionally submitted to the
      // family book (the submission is written in the same batch).
      const recipeDataForFirestore = {
        ...baseFields,
        authorId: uploadedBy,
        visibility: VISIBILITY.PRIVATE,
        stage: choice.stage,
      };

      const mediaItemsOrdered = formComponent?.getAllMediaInOrder?.() || [];

      const { recipeId, mediaUploadResults } = await RecipeService.create({
        recipeData: recipeDataForFirestore,
        imagesToUpload,
        mediaItemsOrdered,
        uploadedBy,
        alsoWrite: choice.submit
          ? (id) => [
              RecipeSubmissionService.submissionWrite({ recipeId: id, authorId: uploadedBy }),
            ]
          : undefined,
      });

      this.clearForm();

      const savedMessage = choice.submit
        ? 'המתכון נשלח בהצלחה!'
        : choice.stage === STAGE.TO_TRY
          ? 'המתכון נשמר ב־״לנסות״'
          : 'המתכון נשמר ב־״הספרייה שלי״';
      if (mediaUploadResults.failedCount > 0) {
        showToast(
          `${savedMessage}\n\n` +
            `${mediaUploadResults.successCount} קבצי מדיה הועלו בהצלחה.\n` +
            `${mediaUploadResults.failedCount} קבצי מדיה נכשלו.\n\n` +
            `ניתן לראות את המתכון בלוח הבקרה ולערוך אותו כדי לנסות שוב.`,
          'warn',
          0,
        );
      } else {
        showToast(savedMessage, 'success');
      }
      spinner.removeAttribute('active');
      this.dispatchEvent(
        new CustomEvent('recipe-proposed-success', { bubbles: true, composed: true }),
      );
    } catch (error) {
      spinner.removeAttribute('active');
      this.showErrorMessage(error);
    }
  }

  showErrorMessage(error) {
    logError(error, 'Recipe proposal');
    showToast(getErrorMessage(error), 'error', 5000);
  }

  clearForm() {
    const formComponent = this.shadowRoot.querySelector('recipe-form-component');
    formComponent.clearForm();
    this.setImported(false);
  }

  setFormDisabled(isDisabled) {
    const recipeFormComponent = this.shadowRoot.querySelector('recipe-form-component');
    if (recipeFormComponent && typeof recipeFormComponent.setDisabled === 'function') {
      recipeFormComponent.setDisabled(isDisabled);
    }
  }

  submitForm() {
    const formComponent = this.shadowRoot.querySelector('recipe-form-component');
    if (formComponent) formComponent.submitForm();
  }

  requestClear() {
    const formComponent = this.shadowRoot.querySelector('recipe-form-component');
    if (formComponent) formComponent.requestClear();
  }

  openImportModal() {
    const formComponent = this.shadowRoot.querySelector('recipe-form-component');
    if (formComponent) formComponent.openImportModal();
  }
}

customElements.define('propose-recipe-component', ProposeRecipeComponent);
