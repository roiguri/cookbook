/**
 * EditSuggestionReview Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * Manager-facing review modal for a pending recipe edit suggestion (Milestone 1:
 * display-only). Shows a full-recipe contextual diff of the live recipe vs the
 * suggested state, with Approve (applies the suggestion as-is via RecipeService.update) and
 * Reject (with an optional reason). Editing a suggestion before applying is a
 * later milestone.
 *
 * @example
 * const review = document.createElement('edit-suggestion-review');
 * container.appendChild(review);
 * review.openForSuggestion(suggestion); // suggestion doc from listPending()
 *
 * @fires suggestion-approved
 * @fires suggestion-rejected
 */
import authService from '../../../js/services/auth/auth-service.js';
import { RecipeService } from '../../../js/services/recipes/recipe-service.js';
import { RecipeEditSuggestionService } from '../../../js/services/recipes/recipe-edit-suggestion-service.js';
import { buildApplyPayload } from '../../../js/utils/recipes/recipe-diff-utils.js';
import { logError, getErrorMessage } from '../../../js/utils/error-handler.js';

import './suggestion-diff-view.js';
import '../../utilities/modal/modal.js';
import '../../utilities/loading-spinner/loading-spinner.js';
import '../../modals/message-modal/message-modal.js';

class EditSuggestionReview extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.suggestion = null;
    this.currentRecipe = null;
  }

  connectedCallback() {
    this.render();
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
        .review-wrap { display:flex; flex-direction:column; flex:1; min-height:0; font-family:var(--font-ui-he,sans-serif); }
        .review-body { flex:1; overflow-y:auto; min-height:0; }
        .review-header { flex-shrink:0; margin-bottom:12px; }
        .review-header h2 { font-family:var(--font-display,serif); font-size:22px; color:var(--ink,#1f1d18); margin:0 0 4px; }
        .review-meta { font-size:13px; color:var(--ink-3,rgba(31,29,24,0.55)); }
        .review-note { margin-top:8px; padding:8px 12px; background:var(--surface-2,#f0ede6); border-radius:var(--r-sm,10px); font-size:13px; color:var(--ink,#1f1d18); }


        .review-toolbar { flex-shrink:0; display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; margin-top:16px; padding:12px 14px; background:var(--surface-0,#fafaf8); border:1px solid var(--hairline,rgba(31,29,24,0.08)); border-radius:var(--r-lg,16px); }
        .btn { font-family:var(--font-ui-he,sans-serif); font-size:13.5px; font-weight:500; padding:10px 22px; border-radius:var(--r-sm,8px); cursor:pointer; border:1px solid transparent; }
        .btn-reject { background:transparent; color:var(--secondary-dark,#bc4749); border-color:var(--secondary-dark,#bc4749); }
        .btn-reject:hover { background:rgba(188,71,73,0.08); }
        .btn-approve { background:var(--primary,#6a994e); color:#fff; }
        .btn-approve:hover { background:var(--primary-dark,#386641); }
      </style>

      <loading-spinner overlay border-radius="10px" size="60px" color="var(--primary, #6a994e)">
        <custom-modal height="80vh" width="50vw" fullscreen-mobile>
          <div class="review-wrap" dir="rtl">
            <div class="review-header">
              <h2>סקירת הצעת עריכה</h2>
              <div class="review-meta" id="review-meta"></div>
              <div class="review-note" id="review-note" hidden></div>
            </div>
            <div class="review-body">
              <suggestion-diff-view id="diff-view"></suggestion-diff-view>
            </div>
            <div class="review-toolbar">
              <button class="btn btn-reject" id="reject-btn">דחה</button>
              <button class="btn btn-approve" id="approve-btn">אשר והחל</button>
            </div>
          </div>
        </custom-modal>
      </loading-spinner>
      <message-modal></message-modal>
    `;
  }

  setupEventListeners() {
    this.shadowRoot
      .getElementById('approve-btn')
      .addEventListener('click', () => this.handleApprove());
    this.shadowRoot
      .getElementById('reject-btn')
      .addEventListener('click', () => this.handleReject());
  }

  /**
   * Open the review modal for a pending suggestion document (from listPending()).
   * @param {Object} suggestion
   */
  async openForSuggestion(suggestion) {
    this.suggestion = suggestion;
    const spinner = this.shadowRoot.querySelector('loading-spinner');
    spinner.setAttribute('active', '');
    this.modal.open();
    try {
      this.currentRecipe = await RecipeService.get(suggestion.recipeId);
      this.renderMeta();
      await this.shadowRoot
        .getElementById('diff-view')
        .render(this.currentRecipe || {}, this.suggestion.proposedChanges || {});
    } catch (error) {
      logError(error, 'Suggestion review load');
      this.shadowRoot.querySelector('message-modal')?.show(getErrorMessage(error), 'שגיאה');
    } finally {
      spinner.removeAttribute('active');
    }
  }

  renderMeta() {
    const meta = this.shadowRoot.getElementById('review-meta');
    meta.textContent = `מתכון: ${this.suggestion.recipeName || this.suggestion.recipeId} · הוצע על ידי ${this.suggestion.suggestedByName || this.suggestion.suggestedBy}`;
    const note = this.shadowRoot.getElementById('review-note');
    if (this.suggestion.note) {
      note.textContent = `הערה: ${this.suggestion.note}`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  async handleApprove() {
    const spinner = this.shadowRoot.querySelector('loading-spinner');
    try {
      spinner.setAttribute('active', '');
      const uploadedBy = authService.getCurrentUser()?.uid || 'anonymous';
      const payload = buildApplyPayload(
        this.currentRecipe || {},
        this.suggestion.proposedChanges || {},
      );

      await RecipeService.update(this.suggestion.recipeId, {
        ...payload,
        uploadedBy,
        approved: true,
      });
      await RecipeEditSuggestionService.approve(this.suggestion.id, {
        reviewedBy: uploadedBy,
        recipeId: this.suggestion.recipeId,
      });

      spinner.removeAttribute('active');
      this.modal.close();
      this.dispatchEvent(
        new CustomEvent('suggestion-approved', {
          detail: { suggestionId: this.suggestion.id, recipeId: this.suggestion.recipeId },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      spinner.removeAttribute('active');
      logError(error, 'Suggestion approve');
      this.shadowRoot.querySelector('message-modal')?.show(getErrorMessage(error), 'שגיאה');
    }
  }

  async handleReject() {
    const spinner = this.shadowRoot.querySelector('loading-spinner');
    try {
      spinner.setAttribute('active', '');
      const reviewedBy = authService.getCurrentUser()?.uid || null;
      await RecipeEditSuggestionService.reject(this.suggestion.id, { reviewedBy });

      spinner.removeAttribute('active');
      this.modal.close();
      this.dispatchEvent(
        new CustomEvent('suggestion-rejected', {
          detail: { suggestionId: this.suggestion.id, recipeId: this.suggestion.recipeId },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      spinner.removeAttribute('active');
      logError(error, 'Suggestion reject');
      this.shadowRoot.querySelector('message-modal')?.show(getErrorMessage(error), 'שגיאה');
    }
  }

  openModal() {
    this.modal.open();
  }

  closeModal() {
    this.modal.close();
  }

  handleResize() {
    if (window.innerWidth < 768) {
      this.modal.setHeight('100vh');
      this.modal.setWidth('100vw');
    } else {
      this.modal.setHeight('80vh');
      this.modal.setWidth('50vw');
    }
  }
}

customElements.define('edit-suggestion-review', EditSuggestionReview);
