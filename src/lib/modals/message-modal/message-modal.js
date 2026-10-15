import { Modal } from '../../utilities/modal/modal.js';

/**
 * Message Modal Component
 * @class
 * @extends Modal
 *
 * @description
 * A simple modal component for displaying messages with optional title.
 * Extends Modal functionality and supports RTL (Right-to-Left) layout by default.
 *
 * @dependencies
 * - Requires Modal component (`custom-modal`)
 *
 * @example
 * // HTML
 * <message-modal></message-modal>
 *
 * // JavaScript
 * const modal = document.querySelector('message-modal');
 * modal.show('Your message here', 'Optional Title');
 *
 * @method show(message, title)
 * @param {string} message - The message to display
 * @param {string} [title=''] - Optional title for the message
 *
 * @fires modal-opened - Inherited from Modal component
 * @fires modal-closed - Inherited from Modal component
 */
class MessageModal extends Modal {
  constructor() {
    super();
  }

  template() {
    return `
      <div dir="rtl" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-message">
        <div class="modal-content">
          <button class="close-button" aria-label="סגור">&times;</button>
          <div class="message-modal-content">
            <h2 id="modal-title"></h2>
            <p id="modal-message"></p>
            <div class="modal-actions"></div>
          </div>
        </div>
      </div>
    `;
  }

  styles() {
    return `
      ${super.styles()}
      ${super.existingStyles()}
      .message-modal-content {
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
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
      }
      p.monospace {
        font-family: var(--font-mono, monospace);
        text-align: left;
        direction: ltr;
        font-size: 12px;
        background: var(--surface-2, #f2e8cf);
        padding: 12px;
        border-radius: var(--r-sm, 8px);
        margin-top: 10px;
      }
      .modal-actions {
        margin-top: 20px;
        text-align: center;
      }
      .modal-actions button {
        font-family: var(--font-ui, system-ui, sans-serif);
        font-size: 13.5px;
        font-weight: 500;
        padding: 11px 28px;
        background: var(--primary, #6a994e);
        color: #fff;
        border: none;
        border-radius: var(--r-sm, 8px);
        cursor: pointer;
        transition: background var(--dur-1, 160ms) var(--ease, ease),
                    transform var(--dur-1, 160ms) var(--ease, ease);
      }
      .modal-actions button:hover,
      .modal-actions button:active {
        background: var(--primary-dark, #386641);
      }
      .modal-actions button:active {
        transform: scale(var(--press-scale, 0.97));
      }
    `;
  }

  show(message, title = '', buttonText = null, buttonAction = null, options = {}) {
    const messageEl = this.shadowRoot.getElementById('modal-message');
    messageEl.textContent = message;

    if (options.monospace) {
      messageEl.classList.add('monospace');
    } else {
      messageEl.classList.remove('monospace');
    }

    const titleDiv = this.shadowRoot.getElementById('modal-title');
    if (title) {
      titleDiv.textContent = title;
      titleDiv.style.display = 'block'; // Show the title if it exists
    } else {
      titleDiv.style.display = 'none'; // Hide the title if it's empty
    }

    const actionsContainer = this.shadowRoot.querySelector('.modal-actions');
    actionsContainer.innerHTML = ''; // Clear previous buttons

    if (buttonText && typeof buttonAction === 'function') {
      const button = document.createElement('button');
      button.textContent = buttonText;
      button.classList.add('action-button'); // Add class for styling if needed
      button.addEventListener('click', () => {
        buttonAction();
      });
      actionsContainer.appendChild(button);
    }

    this.open();
  }
}

customElements.define('message-modal', MessageModal);
