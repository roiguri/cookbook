import { Modal } from '../../utilities/modal/modal.js';

/**
 * Confirmation Modal Component
 * @class
 * @extends Modal
 *
 * @description
 * A custom web component that extends the Modal component to display a confirmation
 * dialog in RTL (Right-to-Left) layout. Provides customizable title, message, and button text.
 *
 * @dependencies
 * - Requires Modal component as parent class
 * - Uses CSS variables:
 *   - --primary-color (default: #bb6016)
 *   - --primary-hover (default: #5c4033)
 *   - --secondary-color (default: #e6dfd1)
 *
 * @example
 * // HTML
 * <confirmation-modal></confirmation-modal>
 *
 * // JavaScript
 * const modal = document.querySelector('confirmation-modal');
 *
 * modal.addEventListener('confirm-approved', () => {
 *   console.log('Action approved!');
 * });
 *
 * modal.addEventListener('confirm-rejected', () => {
 *   console.log('Action rejected!');
 * });
 *
 * // Basic usage with default Hebrew text
 * modal.confirm();
 *
 * // Custom text usage
 * modal.confirm(
 *   'Delete this item?',    // message
 *   'Confirm Delete',       // title
 *   'Delete',              // approve button
 *   'Cancel'               // reject button
 * );
 *
 * // Custom content between the message and the buttons (e.g. a form). The
 * // body node may carry its own <style>; `className` is added to the dialog
 * // for the duration of this confirm.
 * modal.confirm('', 'Save how?', 'Save', 'Cancel', { body: node, className: 'save-choice' });
 * modal.setApproveText('Save and send');   // e.g. when the body's choice changes
 *
 * @method confirm(message?, title?, approveButtonText?, rejectButtonText?, options?)
 * @param {string} [message='האם אתה בטוח?'] - The confirmation message to display
 * @param {string} [title=''] - Modal title. If empty, title section is hidden
 * @param {string} [approveButtonText='כן'] - Text for the approve button (default: "Yes" in Hebrew)
 * @param {string} [rejectButtonText='לא'] - Text for the reject button (default: "No" in Hebrew)
 * @param {Object} [options]
 * @param {Node} [options.body] - Content shown between the message and the buttons
 * @param {string} [options.className] - Extra class on the dialog for this confirm
 *
 * @event confirm-approved - Fired when the approve button is clicked
 * @event confirm-rejected - Fired when the reject button is clicked
 *
 * @cssProperties
 * - --primary-color: Primary color for approve button and text
 * - --primary-hover: Hover color for buttons
 * - --secondary-color: Background color for reject button
 *
 * @notes
 * - Component uses RTL layout by default
 * - Inherits modal backdrop and close button functionality from Modal component
 * - Event listeners are added on each confirm() call
 */
class ConfirmationModal extends Modal {
  constructor() {
    super();
  }

  template() {
    return `
      <div dir="rtl" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-message">
        <div class="modal-content">
          <button class="close-button" aria-label="סגור">&times;</button>
          <div class="confirmation-modal-content">
            <h2 id="modal-title"></h2>
            <p id="modal-message"></p>
            <div id="modal-body"></div>
            <div class="modal-buttons">
              <button id="modal-reject-button" class="modal-button reject-button"></button>
              <button id="modal-approve-button" class="modal-button approve-button"></button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  styles() {
    return `
      ${super.styles()}
      ${super.existingStyles()}
      .confirmation-modal-content {
        text-align: center;
        direction: rtl;
        font-family: var(--font-ui, system-ui, sans-serif);
        padding: 56px 32px 32px;
      }
      h2 {
        font-family: var(--font-display-he, serif);
        font-style: italic;
        font-weight: 400;
        font-size: 1.25rem;
        color: var(--ink, #1f1d18);
        margin: 0 0 12px;
        letter-spacing: -0.02em;
      }
      p {
        font-size: 14px;
        color: var(--ink-3, #7c7562);
        line-height: 1.6;
        margin: 0 0 20px;
      }
      .modal-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
      }
      .modal-button {
        font-family: var(--font-ui, system-ui, sans-serif);
        font-size: 13.5px;
        font-weight: 500;
        padding: 11px 24px;
        border-radius: var(--r-sm, 8px);
        cursor: pointer;
        transition: background var(--dur-1, 160ms) var(--ease, ease),
                    border-color var(--dur-1, 160ms) var(--ease, ease),
                    transform var(--dur-1, 160ms) var(--ease, ease);
        min-width: 100px;
        border: none;
      }
      .modal-button:active:not(:disabled) {
        transform: scale(var(--press-scale, 0.97));
      }
      .approve-button {
        background: var(--primary, #6a994e);
        color: #fff;
      }
      .approve-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .approve-button:hover:not(:disabled),
      .approve-button:active:not(:disabled) {
        background: var(--primary-dark, #386641);
      }
      .reject-button {
        background: transparent;
        color: var(--ink-2, #3a3a3a);
        border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
      }
      .reject-button:hover,
      .reject-button:active {
        background: var(--surface-2, #f2e8cf);
      }
    `;
  }

  setupEventListeners() {
    super.setupEventListeners();

    const approveButton = this.shadowRoot.getElementById('modal-approve-button');
    const rejectButton = this.shadowRoot.getElementById('modal-reject-button');

    approveButton.addEventListener('click', () => {
      const resolve = this._resolveConfirm;
      this._resolveConfirm = null;
      this.close();
      this.dispatchEvent(new CustomEvent('confirm-approved'));
      if (resolve) resolve(true);
    });

    rejectButton.addEventListener('click', () => {
      const resolve = this._resolveConfirm;
      this._resolveConfirm = null;
      this.close();
      this.dispatchEvent(new CustomEvent('confirm-rejected'));
      if (resolve) resolve(false);
    });

    this.addEventListener('modal-closed', () => {
      if (this._resolveConfirm) {
        this._resolveConfirm(false);
        this._resolveConfirm = null;
      }
    });
  }

  confirm(
    message = 'האם אתה בטוח?',
    title = '',
    approveButtonText = 'כן',
    rejectButtonText = 'לא',
    { body = null, className = '' } = {},
  ) {
    const messageEl = this.shadowRoot.getElementById('modal-message');
    messageEl.textContent = message;
    messageEl.style.display = message ? '' : 'none';

    this.shadowRoot.getElementById('modal-body').replaceChildren(...(body ? [body] : []));
    const dialog = this.shadowRoot.querySelector('.modal');
    if (this._customClass) dialog.classList.remove(this._customClass);
    this._customClass = className || null;
    if (className) dialog.classList.add(className);

    const titleDiv = this.shadowRoot.getElementById('modal-title');
    if (title) {
      titleDiv.textContent = title;
      titleDiv.style.display = 'block';
    } else {
      titleDiv.style.display = 'none';
    }

    this.shadowRoot.getElementById('modal-approve-button').textContent = approveButtonText;
    this.shadowRoot.getElementById('modal-reject-button').textContent = rejectButtonText;

    this.open();

    return new Promise((resolve) => {
      this._resolveConfirm = resolve;
    });
  }

  /** Change the approve button's label while the dialog is open. */
  setApproveText(text) {
    this.shadowRoot.getElementById('modal-approve-button').textContent = text;
  }

  /** Enable or disable the approve button (e.g. until a required field is filled). */
  setApproveDisabled(disabled) {
    this.shadowRoot.getElementById('modal-approve-button').disabled = !!disabled;
  }
}

customElements.define('confirmation-modal', ConfirmationModal);

export { ConfirmationModal };
