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

import { RecipeService } from '../../../js/services/recipe-service.js';
import { Timestamp } from 'firebase/firestore';
import authService from '../../../js/services/auth-service.js';
import { logError, getErrorMessage } from '../../../js/utils/error-handler.js';
import { showToast } from '../../notifications/toast-notification/toast-notification.js';

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
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>

      </style>
      <loading-spinner overlay>
        <div class="propose-recipe-container">
          <recipe-form-component hide-actions></recipe-form-component>
        </div>
      </loading-spinner>
      `;
  }

  async handleRecipeData(event) {
    const recipeData = event.detail.recipeData;
    const spinner = this.shadowRoot.querySelector('loading-spinner');
    try {
      spinner.setAttribute('active', '');
      const user = authService.getCurrentUser();
      const uploadedBy = user?.uid || 'anonymous';
      const formComponent = this.shadowRoot.querySelector('recipe-form-component');

      const {
        images: formImages,
        mediaInstructions: _m,
        toDelete: _td,
        ...baseFields
      } = recipeData;
      const imagesToUpload = (formImages || []).map(({ file, isPrimary }) => ({ file, isPrimary }));

      const recipeDataForFirestore = {
        ...baseFields,
        creationTime: Timestamp.now(),
        userId: uploadedBy,
        approved: false,
      };

      const mediaItemsOrdered = formComponent?.getAllMediaInOrder?.() || [];

      const { mediaUploadResults } = await RecipeService.create({
        recipeData: recipeDataForFirestore,
        imagesToUpload,
        mediaItemsOrdered,
        uploadedBy,
      });

      this.clearForm();

      if (mediaUploadResults.failedCount > 0) {
        showToast(
          `המתכון נשלח בהצלחה!\n\n` +
            `${mediaUploadResults.successCount} קבצי מדיה הועלו בהצלחה.\n` +
            `${mediaUploadResults.failedCount} קבצי מדיה נכשלו.\n\n` +
            `ניתן לראות את המתכון בלוח הבקרה ולערוך אותו כדי לנסות שוב.`,
          'warn',
          0,
        );
      } else {
        this.showSuccessMessage();
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

  showSuccessMessage() {
    showToast('המתכון נשלח בהצלחה!', 'success');
  }

  showErrorMessage(error) {
    logError(error, 'Recipe proposal');
    showToast(getErrorMessage(error), 'error', 5000);
  }

  clearForm() {
    const formComponent = this.shadowRoot.querySelector('recipe-form-component');
    formComponent.clearForm();
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
