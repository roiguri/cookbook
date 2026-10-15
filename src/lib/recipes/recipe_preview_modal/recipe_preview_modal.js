/**
 * Recipe Preview Modal Component
 *
 * This web component displays a recipe preview in a modal dialog. It combines the functionality
 * of the `recipe-component` to show recipe details and the `custom-modal` for the modal structure.
 *
 * Usage:
 *
 * 1. Include the `recipe-preview-modal.js` script in your HTML file.
 *
 * 2. Add the `<recipe-preview-modal>` element to your page.
 *
 * 3. Set the following attributes on the `<recipe-preview-modal>` element:
 *    - `recipe-id`: The ID of the recipe to preview.
 *    - `recipe-name`: The name of the recipe to display in the modal title.
 *    - `show-buttons`: (Optional) Set to 'true' to show Approve/Reject buttons.
 *
 * 4.  Get a reference to the `<recipe-preview-modal>` element in your JavaScript code.
 *
 * 5.  Call the `openModal()` method on the element to open the modal.
 *
 * Example:
 *
 * ```html
 * <recipe-preview-modal id="recipe-preview" recipe-id="recipe123" recipe-name="Delicious Cake" show-buttons="true"></recipe-preview-modal>
 * <button id="preview-button">Preview Recipe</button>
 * <script>
 *   const previewButton = document.getElementById('preview-button');
 *   const recipePreviewModal = document.getElementById('recipe-preview');
 *   previewButton.addEventListener('click', () => {
 *     recipePreviewModal.openModal();
 *   });
 * </script>
 * ```
 *
 * Events:
 *
 * The component dispatches the following custom events:
 *
 * - `recipe-approved`: Dispatched when the Approve button is clicked.
 * - `recipe-rejected`: Dispatched when the Reject button is clicked.
 *
 * Both events include an object with the `recipeId` in the `detail` property. You can listen
 * for these events on the `<recipe-preview-modal>` element to handle the approval or rejection
 * logic in your parent component.
 *
 * Dependencies:
 * - This component relies on the `custom-modal` and `recipe-component` components.
 */
import { RecipeSubmissionService } from '../../../js/services/recipes/recipe-submission-service.js';
import authService from '../../../js/services/auth/auth-service.js';
import { askRejectionNote, confirmDiscard } from '../rejection-note/rejection-note.js';

import '../recipe_component/recipe_component.js';
import '../../utilities/modal/modal.js';
import '../../utilities/loading-spinner/loading-spinner.js';

class RecipePreviewModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isLoading = false;
  }

  connectedCallback() {
    this.recipeId = this.getAttribute('recipe-id');
    this.showButtons = this.getAttribute('show-buttons') === 'true';
    this.recipeName = this.getAttribute('recipe-name');
    // Review context (manager queue): the author hadn't tried it yet; and whether a
    // rejection keeps the recipe with a note (family) or discards it (plain users).
    this.untested = this.hasAttribute('untested');
    this.sentBy = this.getAttribute('sent-by');
    this.sentDate = this.getAttribute('sent-date');
    this.rejectMode = this.getAttribute('reject-mode') === 'discard' ? 'discard' : 'note';
    this.render();
    this.modal = this.shadowRoot.querySelector('custom-modal');
    this.modal.setAttribute('modal-title', `Preview: ${this.recipeName}`);
    this.setupButtons();
    this.setResponsiveWidth();

    this.resizeHandler = () => this.setResponsiveWidth();
    window.addEventListener('resize', this.resizeHandler);
  }

  disconnectedCallback() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
  }

  setResponsiveWidth() {
    const modal = this.shadowRoot.querySelector('custom-modal');
    if (!modal) return;
    modal.setWidth(window.innerWidth <= 768 ? '100vw' : '60vw');
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${this.styles()}
      </style>
      ${this.template()}
    `;
  }

  styles() {
    return `
      .modal-buttons {
        display: flex;
        gap: 10px;
        padding: 12px 16px;
        direction: rtl;
      }

      .modal-buttons button {
        flex: 1;
        padding: 10px 20px;
        border-radius: var(--r-pill, 999px);
        font-family: var(--font-ui-he, sans-serif);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition:
          background var(--dur-1, 160ms),
          opacity var(--dur-1, 160ms),
          transform var(--dur-1, 160ms);
      }

      .modal-buttons button:active:not(:disabled) {
        transform: scale(var(--press-scale, 0.97));
      }

      .modal-buttons button#approve-button {
        background: var(--primary, #6a994e);
        color: #fff;
        border: none;
      }

      .modal-buttons button#approve-button:hover,
      .modal-buttons button#approve-button:active:not(:disabled) {
        background: var(--primary-dark, #4a7a32);
      }

      .modal-buttons button#reject-button {
        background: transparent;
        color: var(--secondary-dark, #bc4749);
        border: 1.5px solid var(--secondary-dark, #bc4749);
      }

      .modal-buttons button#reject-button:hover,
      .modal-buttons button#reject-button:active:not(:disabled) {
        background: rgba(188, 71, 73, 0.08);
      }

      .modal-buttons button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      /* Below the modal's close button, with room before the recipe */
      .review-banner {
        margin: 56px 16px 8px;
        padding: 10px 14px;
        border-radius: var(--r-md);
        background: var(--neutral);
        border: 1px solid var(--hairline-strong);
        font-family: var(--font-ui-he);
        font-size: 13px;
        line-height: 1.55;
        color: var(--ink-2);
        text-align: right;
      }

      .review-banner b {
        color: var(--ink);
      }

      .review-banner p {
        margin: 0;
      }

      .review-banner p + p {
        margin-top: 4px;
      }

      .review-note {
        margin: 0 16px;
        font-family: var(--font-ui-he);
        font-size: 12px;
        color: var(--ink-3);
        text-align: right;
      }

      .error-message {
        color: var(--secondary-dark, #bc4749);
        font-family: var(--font-ui-he, sans-serif);
        font-size: 13px;
        margin: 8px 16px;
        text-align: center;
        display: none;
      }
    `;
  }

  template() {
    return `
      <div class="recipe-preview-modal">
        <custom-modal height="90vh" width="90vw" fullscreen-mobile>
          <loading-spinner overlay border-radius="10px" style="z-index:1000; display:none;" id="modal-spinner"></loading-spinner>
          <div class="error-message"></div>
          ${this.reviewBanner()}
          <div class="modal-content">
            <recipe-component recipe-id="${this.recipeId}"></recipe-component>
          </div>
          ${
            this.showButtons
              ? '<p class="review-note" dir="rtl">באישור המתכון יתפרסם בספר המשפחתי, ויישאר גם בספרייה של מי ששלח אותו. מעכשיו שינויים בו עוברים דרך הצעות עריכה.</p>'
              : ''
          }
          <div class="modal-buttons" id="modal-buttons">
            <button id="reject-button">דחה</button>
            <button id="approve-button">אשר</button>
          </div>
        </custom-modal>
      </div>
    `;
  }

  /** Review context for the manager: who sent it, and whether it was tried. */
  reviewBanner() {
    const lines = [];
    if (this.sentBy) {
      const sent = document.createElement('p');
      sent.append('הוגש על ידי ');
      const who = document.createElement('b');
      who.textContent = this.sentBy;
      sent.append(who);
      if (this.sentDate) sent.append(` ב־${this.sentDate}`);
      lines.push(sent.outerHTML);
    }
    if (this.untested) {
      lines.push('<p><b>המתכון סומן ״עוד לא נוסה״.</b></p>');
    }
    return lines.length ? `<div class="review-banner" dir="rtl">${lines.join('')}</div>` : '';
  }

  setupButtons() {
    const buttonsContainer = this.shadowRoot.getElementById('modal-buttons');
    if (!this.showButtons) {
      buttonsContainer.style.display = 'none';
      return;
    }

    const approveButton = this.shadowRoot.getElementById('approve-button');
    const rejectButton = this.shadowRoot.getElementById('reject-button');

    approveButton.addEventListener('click', () => this.handleApproveClick());
    rejectButton.addEventListener('click', () => this.handleRejectClick());
  }

  setLoading(loading) {
    this.isLoading = loading;
    const spinner = this.shadowRoot.getElementById('modal-spinner');
    const approveButton = this.shadowRoot.getElementById('approve-button');
    const rejectButton = this.shadowRoot.getElementById('reject-button');

    if (loading) {
      spinner.setAttribute('active', '');
      spinner.style.display = 'flex';
      approveButton?.setAttribute('disabled', 'true');
      rejectButton?.setAttribute('disabled', 'true');
    } else {
      spinner.removeAttribute('active');
      spinner.style.display = 'none';
      approveButton?.removeAttribute('disabled');
      rejectButton?.removeAttribute('disabled');
    }
  }

  showError(message) {
    const errorElement = this.shadowRoot.querySelector('.error-message');
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    setTimeout(() => {
      errorElement.style.display = 'none';
    }, 5000);
  }

  async handleApproveClick() {
    if (this.isLoading) return;

    try {
      this.setLoading(true);
      await this.handleRecipeApproval(this.recipeId);
      this.dispatchEvent(
        new CustomEvent('recipe-approved', {
          detail: { recipeId: this.recipeId },
          bubbles: true,
          composed: true,
        }),
      );
      this.modal.close();
    } catch (error) {
      console.error('Error approving recipe:', error);
      this.showError('אירעה שגיאה באישור המתכון. אנא נסה שנית.');
      this.setLoading(false);
    }
  }

  async handleRejectClick() {
    if (this.isLoading) return;

    // Family members get a note and keep the recipe; plain users' proposals are
    // discarded (they have no library to see a note in).
    let note = null;
    if (this.rejectMode === 'note') {
      note = await askRejectionNote(this.recipeName);
      if (note === null) return;
    } else if (!(await confirmDiscard(this.recipeName))) {
      return;
    }

    try {
      this.setLoading(true);
      await this.handleRecipeRejection(this.recipeId, note);
      this.dispatchEvent(
        new CustomEvent('recipe-rejected', {
          detail: { recipeId: this.recipeId, mode: this.rejectMode },
          bubbles: true,
          composed: true,
        }),
      );
      this.modal.close();
    } catch (error) {
      console.error('Error rejecting recipe:', error);
      this.showError('אירעה שגיאה בדחיית המתכון. אנא נסה שנית.');
      this.setLoading(false);
    }
  }

  openModal() {
    this.modal.open();
  }

  closeModal() {
    this.modal.close();
  }

  async handleRecipeApproval(recipeId) {
    await RecipeSubmissionService.approve(recipeId, {
      reviewedBy: authService.getCurrentUser()?.uid,
    });
  }

  async handleRecipeRejection(recipeId, note) {
    try {
      if (this.rejectMode === 'note') {
        await RecipeSubmissionService.reject(recipeId, {
          note,
          reviewedBy: authService.getCurrentUser()?.uid,
        });
      } else {
        await RecipeSubmissionService.discard(recipeId);
      }
    } catch (error) {
      console.error('Error in handleRecipeRejection:', error);
      throw new Error('Failed to reject recipe: ' + error.message);
    }
  }
}

customElements.define('recipe-preview-modal', RecipePreviewModal);
