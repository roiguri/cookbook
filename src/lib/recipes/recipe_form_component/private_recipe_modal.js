/**
 * PrivateRecipeModal
 *
 * Slice 1.5 — private recipe authoring from /my-recipes (the collection
 * page). Hosts the shared `recipe-form-component` inside a modal and, on
 * submit, writes a `visibility: 'private'` recipe owned by the current user
 * plus a `source: 'owned'` collection entry in the same flow — see
 * docs/feature-plans/personal-collections.md, Slice 1.5.
 *
 * A singleton, like message-modal/confirmation-modal elsewhere in the app:
 * the host page creates one instance on first use and calls openModal() on
 * every subsequent "+ הוספת מתכון" click.
 *
 * Dependencies:
 * - RecipeFormComponent: the shared manual-entry form.
 * - RecipeService / CollectionService: persistence for the recipe and its
 *   collection entry.
 *
 * Example Usage:
 *
 * <private-recipe-modal></private-recipe-modal>
 * el.openModal();
 *
 * Fires:
 * - recipe-added: after a successful create, detail: { recipeId }.
 */

import { RecipeService } from '../../../js/services/recipes/recipe-service.js';
import { CollectionService } from '../../../js/services/users/collection-service.js';
import { buildCardFromRecipe } from '../../../js/utils/recipes/recipe-card-utils.js';
import authService from '../../../js/services/auth/auth-service.js';
import { logError, getErrorMessage } from '../../../js/utils/error-handler.js';
import { showToast } from '../../notifications/toast-notification/toast-notification.js';
import { icons } from '../../../js/icons.js';

import './recipe_form_component.js';
import '../../utilities/modal/modal.js';
import '../../utilities/loading-spinner/loading-spinner.js';

class PrivateRecipeModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.modal = this.shadowRoot.querySelector('custom-modal');
    this.formComponent = this.shadowRoot.querySelector('recipe-form-component');
    this.setupEventListeners();

    // AI import (URL/image extraction) is gated to approved + manager by the
    // backing Cloud Functions (extractRecipeFromImage/Url/Video —
    // functions/index.js) — hide the trigger for plain users rather than
    // showing it and failing on click. Mirrors propose-recipe-page.js's
    // isApproved-gated #action-import.
    this.handleAuthUpdate = this.handleAuthUpdate.bind(this);
    authService.addAuthObserver(this.handleAuthUpdate);
    this.updateImportButtonVisibility(authService.isApproved());
  }

  disconnectedCallback() {
    authService.removeAuthObserver(this.handleAuthUpdate);
  }

  handleAuthUpdate(state) {
    this.updateImportButtonVisibility(!!state?.isApproved);
  }

  updateImportButtonVisibility(isApproved) {
    const importBtn = this.shadowRoot.getElementById('toolbar-import');
    if (importBtn) importBtn.hidden = !isApproved;
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
      .modal-wrap {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .modal-title {
        font-family: var(--font-display-he, var(--font-display));
        font-size: var(--step-2);
        margin: 0 0 12px;
      }

      .modal-body {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
      }

      .toolbar {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        direction: rtl;
        margin-top: 20px;
        padding: 14px 20px;
        background: var(--surface-0);
        border: 1px solid var(--hairline, rgba(31, 29, 24, 0.08));
        border-radius: var(--r-lg, 20px);
        box-shadow: var(--shadow-1);
      }

      .toolbar-actions {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .toolbar-btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-family: var(--font-ui-he, var(--font-ui));
        font-size: 13.5px;
        font-weight: 500;
        padding: 10px 22px;
        border-radius: var(--r-sm);
        cursor: pointer;
        transition:
          background var(--dur-1),
          border-color var(--dur-1);
      }

      .toolbar-btn[hidden] {
        display: none;
      }

      .toolbar-btn svg {
        display: block;
        flex-shrink: 0;
      }

      .toolbar-btn--ghost {
        background: transparent;
        color: var(--ink-3);
        border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
      }

      .toolbar-btn--ghost:hover {
        background: var(--surface-2);
      }

      .toolbar-btn--clear {
        background: transparent;
        color: var(--ink);
        border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
      }

      .toolbar-btn--clear:hover {
        background: var(--surface-2);
      }

      .toolbar-btn--submit {
        background: var(--primary);
        color: #fff;
        border: none;
      }

      .toolbar-btn--submit:hover {
        background: var(--primary-dark, var(--primary));
      }

      @media (max-width: 768px) {
        .btn-label {
          display: none;
        }
        .toolbar-btn {
          padding: 10px 12px;
        }
      }
    `;
  }

  template() {
    return `
      <custom-modal width="60vw" height="90vh" fullscreen-mobile>
        <loading-spinner overlay border-radius="10px">
          <div class="modal-wrap">
            <h2 class="modal-title">הוספת מתכון</h2>
            <div class="modal-body">
              <recipe-form-component hide-actions></recipe-form-component>
            </div>
            <div class="toolbar">
              <button type="button" class="toolbar-btn toolbar-btn--ghost" id="toolbar-import" aria-label="ייבוא מתכון">
                ${icons.link}
                <span class="btn-label">ייבוא מתכון</span>
              </button>
              <div class="toolbar-actions">
                <button type="button" class="toolbar-btn toolbar-btn--clear" id="toolbar-clear" aria-label="נקה">
                  ${icons.closeX}
                  <span class="btn-label">נקה</span>
                </button>
                <button type="button" class="toolbar-btn toolbar-btn--submit" id="toolbar-submit" aria-label="שמירה">
                  ${icons.floppyDisk}
                  <span class="btn-label">שמירה</span>
                </button>
              </div>
            </div>
          </div>
        </loading-spinner>
      </custom-modal>
    `;
  }

  setupEventListeners() {
    this.formComponent.addEventListener('recipe-data-collected', this.handleRecipeData.bind(this));

    const submitBtn = this.shadowRoot.getElementById('toolbar-submit');
    submitBtn.addEventListener('click', () => this.formComponent.submitForm());

    const clearBtn = this.shadowRoot.getElementById('toolbar-clear');
    clearBtn.addEventListener('click', () => this.formComponent.requestClear());

    const importBtn = this.shadowRoot.getElementById('toolbar-import');
    importBtn.addEventListener('click', () => this.formComponent.openImportModal());
  }

  async handleRecipeData(event) {
    const recipeData = event.detail.recipeData;
    const spinner = this.shadowRoot.querySelector('loading-spinner');
    try {
      spinner.setAttribute('active', '');
      const user = authService.getCurrentUser();
      if (!user?.uid) {
        const authError = new Error('User must be authenticated to add a recipe');
        authError.code = 'auth/user-not-found';
        throw authError;
      }
      const uid = user.uid;

      const {
        images: formImages,
        mediaInstructions: _m,
        toDelete: _td,
        mediaToDelete: _mtd,
        ...baseFields
      } = recipeData;
      const imagesToUpload = (formImages || []).map(({ file, isPrimary }) => ({ file, isPrimary }));

      const recipeDataForFirestore = {
        ...baseFields,
        userId: uid,
        approved: false,
        visibility: 'private',
      };

      const mediaItemsOrdered = this.formComponent?.getAllMediaInOrder?.() || [];

      const { recipeId, mediaUploadResults } = await RecipeService.create({
        recipeData: recipeDataForFirestore,
        imagesToUpload,
        mediaItemsOrdered,
        uploadedBy: uid,
      });

      await this.writeCollectionEntry(uid, recipeId, recipeDataForFirestore);

      this.formComponent.clearForm();
      spinner.removeAttribute('active');

      if (mediaUploadResults.failedCount > 0) {
        showToast(
          `המתכון נשמר בהצלחה!\n\n` +
            `${mediaUploadResults.successCount} קבצי מדיה הועלו בהצלחה.\n` +
            `${mediaUploadResults.failedCount} קבצי מדיה נכשלו.\n\n` +
            `אפשר לערוך את המתכון ולנסות שוב.`,
          'warn',
          0,
        );
      } else {
        showToast('המתכון נוסף לאוסף שלך!', 'success');
      }

      this.closeModal();
      this.dispatchEvent(
        new CustomEvent('recipe-added', {
          detail: { recipeId },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      spinner.removeAttribute('active');
      this.showErrorMessage(error);
    }
  }

  /**
   * Best-effort: RecipeService.create and CollectionService.create are not
   * transactional. A failure here is logged and swallowed rather than
   * surfaced as an error to the user — the recipe itself is already saved,
   * and /my-recipes' orphan self-heal (recipes where userId == uid) picks up
   * the missing entry on next load. See the plan's Slice 1.5.
   * @param {string} uid
   * @param {string} recipeId
   * @param {Object} recipeDataForFirestore - The payload just written, used
   *   as a fallback card source if re-fetching the created doc fails.
   */
  async writeCollectionEntry(uid, recipeId, recipeDataForFirestore) {
    let card = {
      name: recipeDataForFirestore.name ?? null,
      category: recipeDataForFirestore.category ?? null,
      prepTime: recipeDataForFirestore.prepTime ?? null,
    };
    try {
      const created = await RecipeService.get(recipeId);
      if (created) card = buildCardFromRecipe(created);
    } catch (error) {
      console.error('Error re-fetching newly-created recipe for its card:', error);
    }

    try {
      await CollectionService.create(uid, recipeId, { source: 'owned', state: 'to-try', card });
    } catch (error) {
      console.error('Error writing collection entry for new private recipe:', error);
    }
  }

  showErrorMessage(error) {
    logError(error, 'Private recipe authoring');
    showToast(getErrorMessage(error), 'error', 5000);
  }

  openModal() {
    this.modal.open();
  }

  closeModal() {
    this.modal.close();
  }
}

customElements.define('private-recipe-modal', PrivateRecipeModal);
