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
 */

import { icons } from '../../../js/icons.js';
import '../recipe_component/recipe_component.js';
import '../recipe_form_component/edit_recipe_component.js';
import '../../utilities/modal/modal.js';

class EditPreviewRecipe extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.recipeId = this.getAttribute('recipe-id');
    this.showButtons = false;
    this.recipeName = this.getAttribute('recipe-name');
    this.mode = this.getAttribute('start-mode') || 'preview'; // Get start mode or default to 'preview'
    this.path = '/img/icon/other/';
    this.render();
    this.modal = this.shadowRoot.querySelector('custom-modal');
    this.setupToolbar();
    this.setupSuccessEventListener();

    this._handleResize = this.handleResize.bind(this);
    this._handleResize();
    window.addEventListener('resize', this._handleResize);
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
      .edit-modal-wrap {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .modal-body {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
      }

      /* ---- Bottom action bar ---- */

      .edit-toolbar {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        direction: rtl;
        margin-top: 20px;
        padding: 14px 20px;
        background: var(--surface-0, #fafaf8);
        border: 1px solid var(--hairline, rgba(31,29,24,0.08));
        border-radius: var(--r-lg, 20px);
        box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
      }

      .toolbar-btn svg {
        display: block;
        flex-shrink: 0;
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
        font-family: var(--font-ui-he, sans-serif);
        font-size: 13.5px;
        font-weight: 500;
        padding: 10px 22px;
        border-radius: var(--r-sm, 8px);
        cursor: pointer;
        transition:
          background var(--dur-1, 160ms),
          border-color var(--dur-1, 160ms);
      }

      .toolbar-btn--toggle {
        background: transparent;
        color: var(--ink-3, rgba(31,29,24,0.55));
        border: 1px solid var(--hairline, rgba(31,29,24,0.12));
        border-radius: var(--r-pill, 999px);
        font-size: 13px;
        padding: 10px 18px;
      }

      .toolbar-btn--toggle:hover {
        background: var(--surface-2, #f0ede6);
        border-color: var(--primary, #6a994e);
        color: var(--primary-dark, #386641);
      }

      .toolbar-btn--clear {
        background: transparent;
        color: var(--ink, #1f1d18);
        border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
      }

      .toolbar-btn--clear:hover {
        background: var(--surface-2, #f0ede6);
      }

      .toolbar-btn--save {
        background: var(--primary, #6a994e);
        color: #fff;
        border: none;
      }

      .toolbar-btn--save:hover {
        background: var(--primary-dark, #386641);
      }

      .toolbar-btn:disabled {
        opacity: 0.38;
        cursor: not-allowed;
        pointer-events: none;
      }

      .toggle-icon {
        width: 15px;
        height: 15px;
        display: block;
        opacity: 0.65;
      }

      @media (max-width: 768px) {
        .btn-label { display: none; }

        .toolbar-btn {
          padding: 10px 12px;
        }

        .toolbar-btn--toggle {
          padding: 10px 12px;
        }
      }
    `;
  }

  template() {
    const isPreview = this.mode === 'preview';
    return `
      <div class="recipe-preview-modal">
        <custom-modal height="90vh" width="60vw" fullscreen-mobile>
          <div class="edit-modal-wrap">
            <div class="modal-body">
              ${
                isPreview
                  ? `<recipe-component recipe-id="${this.recipeId}"></recipe-component>`
                  : `<edit-recipe-component recipe-id="${this.recipeId}" hide-form-actions></edit-recipe-component>`
              }
            </div>
            <div class="edit-toolbar">
              <button class="toolbar-btn toolbar-btn--toggle" id="toolbar-toggle">
                ${
                  isPreview
                    ? `<img src="${this.path}pencil.png" class="toggle-icon" alt="ערוך"><span class="btn-label">ערוך מתכון</span>`
                    : `<img src="${this.path}eye.png" class="toggle-icon" alt="צפה"><span class="btn-label">תצוגה מקדימה</span>`
                }
              </button>
              <div class="toolbar-actions">
                <button class="toolbar-btn toolbar-btn--clear" id="toolbar-clear" ${isPreview ? 'disabled' : ''} aria-label="נקה">
                  ${icons.closeX}
                  <span class="btn-label">נקה</span>
                </button>
                <button class="toolbar-btn toolbar-btn--save" id="toolbar-save" disabled aria-label="שמור">
                  ${icons.floppyDisk}
                  <span class="btn-label">שמור</span>
                </button>
              </div>
            </div>
          </div>
        </custom-modal>
      </div>
    `;
  }

  setupToolbar() {
    const toggleBtn = this.shadowRoot.getElementById('toolbar-toggle');
    const saveBtn = this.shadowRoot.getElementById('toolbar-save');
    const clearBtn = this.shadowRoot.getElementById('toolbar-clear');
    const modalBody = this.shadowRoot.querySelector('.modal-body');
    const toggleImg = toggleBtn.querySelector('.toggle-icon');
    const toggleLbl = toggleBtn.querySelector('.btn-label');

    toggleBtn.addEventListener('click', () => {
      if (this.mode === 'preview') {
        this.mode = 'edit';

        const recipeComp = modalBody.querySelector('recipe-component');
        if (recipeComp) modalBody.removeChild(recipeComp);

        const editComp = document.createElement('edit-recipe-component');
        editComp.setAttribute('recipe-id', this.recipeId);
        editComp.setAttribute('hide-form-actions', '');
        modalBody.appendChild(editComp);

        toggleImg.src = this.path + 'eye.png';
        toggleImg.alt = 'צפה';
        toggleLbl.textContent = 'תצוגה מקדימה';
        saveBtn.disabled = true;
        clearBtn.disabled = false;
      } else {
        this.mode = 'preview';

        const editComp = modalBody.querySelector('edit-recipe-component');
        if (editComp) modalBody.removeChild(editComp);

        const recipeComp = document.createElement('recipe-component');
        recipeComp.setAttribute('recipe-id', this.recipeId);
        modalBody.appendChild(recipeComp);

        toggleImg.src = this.path + 'pencil.png';
        toggleImg.alt = 'ערוך';
        toggleLbl.textContent = 'ערוך מתכון';
        saveBtn.disabled = true;
        clearBtn.disabled = true;
      }
    });

    saveBtn.addEventListener('click', () => {
      const editComp = modalBody.querySelector('edit-recipe-component');
      const formComp = editComp?.shadowRoot?.querySelector('recipe-form-component');
      formComp?.submitForm();
    });

    clearBtn.addEventListener('click', () => {
      const editComp = modalBody.querySelector('edit-recipe-component');
      const formComp = editComp?.shadowRoot?.querySelector('recipe-form-component');
      formComp?.requestClear();
    });

    modalBody.addEventListener('form-dirty-changed', (event) => {
      if (this.mode !== 'edit') return;
      saveBtn.disabled = !event.detail.isDirty;
    });
  }

  openModal() {
    this.modal.open();
  }

  closeModal() {
    this.modal.close();
  }

  handleError(error) {
    // TODO: add error handling
    return;
  }

  setupSuccessEventListener() {
    this.addEventListener('edit-success-modal-closed', () => {
      this.closeModal();
    });
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

customElements.define('edit-preview-recipe', EditPreviewRecipe);
