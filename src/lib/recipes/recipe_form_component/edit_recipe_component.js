// edit-recipe-component.js
import { RecipeService } from '../../../js/services/recipes/recipe-service.js';
import authService from '../../../js/services/auth/auth-service.js';

import '../../modals/message-modal/message-modal.js';
import '../../utilities/loading-spinner/loading-spinner.js';
import './recipe_form_component.js';

class EditRecipeComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.recipeId = this.getAttribute('recipe-id');
    this.render();
    this.formComponent = this.shadowRoot.querySelector('recipe-form-component');

    // Listen for form submission event from the base component
    this.formComponent.addEventListener('recipe-data-collected', this.handleRecipeData.bind(this));

    // Listen for clear button click event from the base component (you'll need to add this in the base component)
    this.formComponent.addEventListener(
      'clear-button-clicked',
      this.resetFormToCurrentData.bind(this),
    );
  }

  render() {
    this.shadowRoot.innerHTML = `
          <loading-spinner overlay border-radius="10px">
            <div class="edit-recipe-container">
                <recipe-form-component clear-button-text="איפוס" submit-button-text="שמור שינויים" recipe-id="${this.recipeId}" disable-form-protection ${this.hasAttribute('hide-form-actions') ? 'hide-actions' : ''}></recipe-form-component>
                <message-modal width="400px" height="auto"></message-modal>
            </div>
          </loading-spinner>
      `;
  }

  // TODO: scroll page to top after update
  async handleRecipeData(event) {
    const recipeData = event.detail.recipeData;
    const spinner = this.shadowRoot.querySelector('loading-spinner');
    try {
      spinner.setAttribute('active', '');
      const user = authService.getCurrentUser();
      const uploadedBy = user?.uid || 'anonymous';

      const {
        images: formImages = [],
        toDelete: imagesToDelete = [],
        mediaInstructions: _m,
        mediaToDelete = [],
        ...changes
      } = recipeData;

      const mediaItemsOrdered = this.formComponent?.getAllMediaInOrder?.() || [];

      // The dashboard's edits publish (`approve-on-save`: a pending recipe is
      // approved by saving it). Authors editing their own private recipe keep
      // its visibility as it is.
      const approveOnSave = this.hasAttribute('approve-on-save');
      const { mediaUploadResults } = await RecipeService.update(this.recipeId, {
        changes,
        images: formImages,
        imagesToDelete,
        mediaItemsOrdered,
        mediaToDelete,
        uploadedBy,
        ...(approveOnSave ? { publish: true } : {}),
      });

      const mediaEditor = this.formComponent?.shadowRoot?.getElementById(
        'media-instructions-editor',
      );
      mediaEditor?.applyUploadResults?.(mediaUploadResults);

      // Re-baseline dirty tracking so the save button disables after a clean save.
      this.formComponent?.markSaved?.();

      if (mediaUploadResults.failedCount > 0) {
        this.showWarningMessage(
          `המתכון עודכן בהצלחה!\n\n` +
            `${mediaUploadResults.successCount} קבצי מדיה הועלו בהצלחה.\n` +
            `${mediaUploadResults.failedCount} קבצי מדיה נכשלו בהעלאה.\n\n` +
            `הקבצים שנכשלו עדיין נראים בעורך. תוכל לנסות להעלות אותם שוב על ידי לחיצה על "עדכן מתכון".`,
        );
      } else {
        this.showSuccessMessage('המתכון עודכן בהצלחה!');
      }
      spinner.removeAttribute('active');

      // Dispatch recipe-updated event for dashboard refresh
      const updatedEvent = new CustomEvent('recipe-updated', {
        detail: { recipeId: this.recipeId },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(updatedEvent);
    } catch (error) {
      spinner.removeAttribute('active');
      this.showErrorMessage(`שגיאה בעדכון המתכון: ${error}`);
    }
  }

  showSuccessMessage(message) {
    const editRecipeModal = this.shadowRoot.querySelector('message-modal');

    editRecipeModal.addEventListener(
      'modal-closed',
      () => {
        const event = new CustomEvent('edit-success-modal-closed', {
          bubbles: true,
          composed: true,
        });
        this.dispatchEvent(event);
      },
      { once: true },
    );

    editRecipeModal.show(message);
  }

  showWarningMessage(message) {
    const editRecipeModal = this.shadowRoot.querySelector('message-modal');
    editRecipeModal.show(message);
  }

  showErrorMessage(message) {
    const editRecipeModal = this.shadowRoot.querySelector('message-modal');
    editRecipeModal.show(message);
  }

  resetFormToCurrentData() {
    // Reset the form to the current recipe data
    this.formComponent.setRecipeData(this.recipeId);
  }
}

customElements.define('edit-recipe-component', EditRecipeComponent);
