/**
 * EditSuggestionReview Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * Manager-facing review modal for a pending recipe edit suggestion (Milestone 1:
 * display-only). Shows a field-by-field diff of the live recipe vs the suggested
 * state, with Approve (applies the suggestion as-is via RecipeService.update) and
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
import { diffRecipe, buildApplyPayload } from '../../../js/utils/recipes/recipe-diff-utils.js';
import { CATEGORY_MAP } from '../../../js/utils/recipes/recipe-data-utils.js';
import { logError, getErrorMessage } from '../../../js/utils/error-handler.js';

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

        .diff-list { display:flex; flex-direction:column; gap:12px; }
        .diff-card { border:1px solid var(--hairline,rgba(31,29,24,0.1)); border-radius:var(--r-lg,16px); padding:12px 16px; background:var(--surface-0,#fafaf8); }
        .diff-card__label { font-size:11px; font-weight:600; letter-spacing:0.06em; color:var(--ink-3,rgba(31,29,24,0.5)); margin-bottom:8px; }
        /* RTL row: before (right) ← after (left). The ← glyph isn't bidi-mirrored, so it points left toward the new value. */
        .diff-scalar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:15px; }
        .diff-before { color:var(--secondary-dark,#bc4749); text-decoration:line-through; opacity:0.8; }
        .diff-arrow { color:var(--ink-4,rgba(31,29,24,0.35)); }
        .diff-after { color:var(--primary-dark,#386641); font-weight:500; }
        .diff-lines { display:flex; flex-direction:column; gap:3px; }
        .diff-line { font-size:14px; padding:3px 8px; border-radius:var(--r-xs,6px); display:flex; gap:8px; align-items:baseline; }
        .diff-line__mark { flex-shrink:0; font-weight:700; width:14px; text-align:center; }
        .diff-line--add { background:rgba(106,153,78,0.1); color:var(--primary-dark,#386641); }
        .diff-line--rem { background:rgba(188,71,73,0.09); color:var(--secondary-dark,#bc4749); text-decoration:line-through; }
        .diff-empty { font-size:14px; color:var(--ink-3,rgba(31,29,24,0.55)); font-style:italic; text-align:center; padding:24px 0; }

        .review-toolbar { flex-shrink:0; display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; margin-top:16px; padding:12px 14px; background:var(--surface-0,#fafaf8); border:1px solid var(--hairline,rgba(31,29,24,0.08)); border-radius:var(--r-lg,16px); }
        .btn { font-family:var(--font-ui-he,sans-serif); font-size:13.5px; font-weight:500; padding:10px 22px; border-radius:var(--r-sm,8px); cursor:pointer; border:1px solid transparent; }
        .btn-reject { background:transparent; color:var(--secondary-dark,#bc4749); border-color:var(--secondary-dark,#bc4749); }
        .btn-reject:hover { background:rgba(188,71,73,0.08); }
        .btn-approve { background:var(--primary,#6a994e); color:#fff; }
        .btn-approve:hover { background:var(--primary-dark,#386641); }
      </style>

      <loading-spinner overlay border-radius="10px" size="60px" color="#ffffff">
        <custom-modal height="80vh" width="50vw" fullscreen-mobile>
          <div class="review-wrap" dir="rtl">
            <div class="review-header">
              <h2>סקירת הצעת עריכה</h2>
              <div class="review-meta" id="review-meta"></div>
              <div class="review-note" id="review-note" hidden></div>
            </div>
            <div class="review-body">
              <div class="diff-list" id="diff-content"></div>
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
      this.renderDiff();
    } catch (error) {
      logError(error, 'Suggestion review load');
      this.shadowRoot.querySelector('message-modal')?.show(getErrorMessage(error), 'שגיאה');
    } finally {
      spinner.removeAttribute('active');
    }
  }

  renderMeta() {
    const meta = this.shadowRoot.getElementById('review-meta');
    meta.textContent = `מתכון: ${this.suggestion.recipeName || this.suggestion.recipeId} · הוצע על ידי ${this.suggestion.suggestedBy}`;
    const note = this.shadowRoot.getElementById('review-note');
    if (this.suggestion.note) {
      note.textContent = `הערה: ${this.suggestion.note}`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  renderDiff() {
    const container = this.shadowRoot.getElementById('diff-content');
    const changes = diffRecipe(this.currentRecipe || {}, this.suggestion.proposedChanges || {});
    if (changes.length === 0) {
      container.innerHTML = '<div class="diff-empty">אין שינויים בתוכן.</div>';
      return;
    }
    container.innerHTML = changes.map((c) => this.renderDiffCard(c)).join('');
  }

  esc(v) {
    return String(v ?? '').replace(
      /[&<>]/g,
      (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[s],
    );
  }

  renderDiffCard(change) {
    const label = this.esc(change.label);

    if (change.type === 'scalar') {
      const before =
        change.field === 'category' ? CATEGORY_MAP[change.before] || change.before : change.before;
      const after =
        change.field === 'category' ? CATEGORY_MAP[change.after] || change.after : change.after;
      const beforeHtml = before
        ? `<span class="diff-before">${this.esc(before)}</span><span class="diff-arrow">←</span>`
        : '';
      return `
        <div class="diff-card">
          <div class="diff-card__label">${label}</div>
          <div class="diff-scalar">${beforeHtml}<span class="diff-after">${this.esc(after) || '—'}</span></div>
        </div>`;
    }

    if (change.type === 'images') {
      const primary = change.primaryChanged ? ' · התמונה הראשית הוחלפה' : '';
      return `
        <div class="diff-card">
          <div class="diff-card__label">${label}</div>
          <div class="diff-scalar"><span class="diff-before">${change.before}</span><span class="diff-arrow">←</span><span class="diff-after">${change.after}</span> תמונות${this.esc(primary)}</div>
        </div>`;
    }

    if (change.type === 'media') {
      return `
        <div class="diff-card">
          <div class="diff-card__label">${label}</div>
          <div class="diff-scalar"><span class="diff-before">${change.before}</span><span class="diff-arrow">←</span><span class="diff-after">${change.after}</span> פריטים</div>
        </div>`;
    }

    // list: line-level added / removed.
    const beforeSet = new Set(change.before);
    const afterSet = new Set(change.after);
    const removed = change.before.filter((x) => !afterSet.has(x));
    const added = change.after.filter((x) => !beforeSet.has(x));
    const lines = [
      ...removed.map(
        (x) =>
          `<div class="diff-line diff-line--rem"><span class="diff-line__mark">−</span><span>${this.esc(x)}</span></div>`,
      ),
      ...added.map(
        (x) =>
          `<div class="diff-line diff-line--add"><span class="diff-line__mark">+</span><span>${this.esc(x)}</span></div>`,
      ),
    ].join('');
    return `
      <div class="diff-card">
        <div class="diff-card__label">${label}</div>
        <div class="diff-lines">${lines}</div>
      </div>`;
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
      await RecipeEditSuggestionService.approve(this.suggestion.id, { reviewedBy: uploadedBy });

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
