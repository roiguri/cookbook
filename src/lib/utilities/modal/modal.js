/**
 * Modal Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * A custom web component that creates a flexible, accessible, and stylable modal dialog
 * that can be easily integrated into web pages. It provides open/close functionality,
 * customizable appearance, and event handling.
 *
 * @example
 * // HTML
 * <custom-modal id="myModal" width="400px" height="300px" background-color="#f0f0f0">
 *   <h2>Welcome to My Modal</h2>
 *   <p>This is a basic modal example.</p>
 *   <button onclick="document.getElementById('myModal').close()">Close</button>
 * </custom-modal>
 *
 * // JavaScript
 * const modal = document.getElementById('myModal');
 * modal.addEventListener('modal-opened', () => console.log('Modal opened'));
 * modal.addEventListener('modal-closed', () => console.log('Modal closed'));
 *
 * // Open the modal
 * modal.open();
 *
 * @property {boolean} isOpen - Indicates whether the modal is currently open.
 *
 * @method open
 * @description Opens the modal and dispatches the 'modal-opened' event.
 *
 * @method close
 * @description Closes the modal and dispatches the 'modal-closed' event after the closing animation.
 *
 * @method setWidth
 * @param {string} value - The width of the modal (e.g., '400px', '50%').
 * @description Sets the width of the modal.
 *
 * @method setHeight
 * @param {string} value - The height of the modal (e.g., '300px', 'auto').
 * @description Sets the height of the modal.
 *
 * @method setBackgroundColor
 * @param {string} value - The background color of the modal (e.g., '#ffffff', 'rgb(255, 255, 255)').
 * @description Sets the background color of the modal.
 *
 * @fires modal-opened - When the modal is opened.
 * @fires modal-closed - When the modal is closed (after closing animation).
 *
 * @attr {string} width - Sets the width of the modal.
 * @attr {string} height - Sets the height of the modal.
 * @attr {string} background-color - Sets the background color of the modal.
 * @attr {boolean} fullscreen-mobile - When present, the modal renders edge-to-edge
 *   (100vw x 100dvh, no border, no radius) at viewports ≤768px. Desktop layout
 *   is unaffected.
 */

export class Modal extends HTMLElement {
  /**
   * ##Set-up
   */
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isOpen = false;
    this._closeGuard = null; // async () => boolean — return false to prevent close

    // Accesibility Enhancements
    this.focusableElements = [];
    this.firstFocusableElement = null;
    this.lastFocusableElement = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.setFocusableElements();

    // Check for attributes and set custom properties
    if (this.hasAttribute('width')) {
      this.setWidth(this.getAttribute('width'));
    }
    if (this.hasAttribute('height')) {
      this.setHeight(this.getAttribute('height'));
    }
    if (this.hasAttribute('background-color')) {
      this.setBackgroundColor(this.getAttribute('background-color'));
    }
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
      :host {
        --modal-outer-padding: 20px;
        --modal-max-width: 90vw;
      }

      /* Phone-sized viewports — both portrait (narrow width) and landscape
         (short height) so rotating a phone doesn't drop fullscreen modals
         back to a centered card. Tablets have height ≥ 768 in landscape,
         so the max-height clause excludes them. */
      @media (max-width: 768px), (max-height: 500px) {
        :host {
          --modal-outer-padding: 4px;
          --modal-max-width: 100vw;
        }

        :host([fullscreen-mobile]) {
          --modal-outer-padding: 0;
          --modal-max-width: 100vw;
        }

        :host([fullscreen-mobile]) .modal-content {
          width: 100vw;
          max-width: 100vw;
          height: 100dvh;
          max-height: 100dvh;
          border: 0;
          border-radius: 0;
          transform: translateY(24px);
        }

        :host([fullscreen-mobile]) .modal.open .modal-content {
          transform: none;
        }
      }

      .modal {
        display: flex;
        position: fixed;
        z-index: var(--z-modal);
        inset: 0;
        align-items: center;
        justify-content: center;
        padding: var(--modal-outer-padding, 20px);
        background: rgba(26, 26, 26, 0.55);
        opacity: 0;
        visibility: hidden;
        transition: opacity var(--dur-2, 280ms) var(--ease, ease),
                    visibility var(--dur-2, 280ms) var(--ease, ease);
      }
      .modal.open {
        opacity: 1;
        visibility: visible;
      }
      .modal-content {
        width: var(--modal-width, 480px);
        max-width: min(var(--modal-max-width, 90vw), var(--modal-width, 480px));
        max-height: 86vh;
        height: var(--modal-height, auto);
        background: var(--surface-1, #fff);
        border: 1px solid var(--hairline, rgba(31, 29, 24, 0.12));
        border-radius: var(--r-xl, 20px);
        box-shadow: var(--shadow-3, 0 8px 32px rgba(31, 29, 24, 0.18), 0 2px 8px rgba(31, 29, 24, 0.08));
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: hidden;
        transform: translateY(16px) scale(0.98);
        transition: transform var(--dur-2, 280ms) var(--ease, ease);
      }
      .modal.open .modal-content {
        transform: none;
      }
      .close-button {
        position: absolute;
        top: 20px;
        left: 20px;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 1px solid var(--hairline, rgba(31, 29, 24, 0.12));
        background: var(--surface-0, #faf6ec);
        cursor: pointer;
        color: var(--ink-1, #1a1a1a);
        font-size: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background var(--dur-1, 160ms) var(--ease, ease);
        z-index: 1;
        line-height: 1;
        padding: 0;
        flex-shrink: 0;
      }
      .close-button:hover {
        background: var(--surface-2, #f2e8cf);
      }
      .modal-slot {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        padding: var(--modal-slot-padding, 28px 32px 32px);
      }
    `;
  }

  existingStyles() {
    return '';
  }

  template() {
    return `
      <div dir="rtl" class="modal" role="dialog" aria-modal="true">
        <div class="modal-content">
          <button class="close-button" aria-label="סגור">&times;</button>
          <div class="modal-slot">
            <slot></slot>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * ##Functionality
   */
  setupEventListeners() {
    const closeButton = this.shadowRoot.querySelector('.close-button');
    closeButton.addEventListener('click', () => this.close({ byUser: true }));

    const modal = this.shadowRoot.querySelector('.modal');
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        this.close({ byUser: true });
      }
    });
  }

  open() {
    if (!this.isOpen) {
      const modalElement = this.shadowRoot.querySelector('.modal');
      modalElement.style.display = 'flex';
      // Force a reflow before adding the 'open' class
      modalElement.offsetWidth;
      modalElement.classList.add('open');
      this.isOpen = true;
      this.setFocusableElements();
      this.firstFocusableElement?.focus();
      window.addEventListener('keydown', this.handleKeyDown);
      this.dispatchEvent(new CustomEvent('modal-opened'));
      this.lockScroll();
    }
  }

  async close(options = { byUser: false }) {
    if (!this.isOpen) return;

    if (options.byUser && this._closeGuard) {
      const allowed = await this._closeGuard();
      if (!allowed || !this.isOpen) return; // guard rejected or modal already closed
    }

    if (options.byUser) {
      this.dispatchEvent(
        new CustomEvent('modal-closed-by-user', { bubbles: true, composed: true }),
      );
    }
    const modalElement = this.shadowRoot.querySelector('.modal');
    modalElement.classList.remove('open');
    this.isOpen = false;
    window.removeEventListener('keydown', this.handleKeyDown);
    // Wait for the transition to finish before hiding the modal
    setTimeout(() => {
      if (!this.isOpen) {
        modalElement.style.display = 'none';
      }
    }, 300); // This should match the transition duration
    this.dispatchEvent(new CustomEvent('modal-closed'));
    this.unlockScroll();
  }

  setCloseGuard(fn) {
    this._closeGuard = fn;
  }

  clearCloseGuard() {
    this._closeGuard = null;
  }

  /**
   * Customization
   */
  setCustomProperty(property, value) {
    this.style.setProperty(`--modal-${property}`, value);
  }

  setWidth(value) {
    this.setCustomProperty('width', value);
  }

  setHeight(value) {
    this.setCustomProperty('height', value);
  }

  setBackgroundColor(value) {
    this.setCustomProperty('background-color', value);
  }

  /**
   * ##Accesibility
   */
  handleKeyDown(event) {
    if (!this.isOpen) return;

    switch (event.key) {
      case 'Escape':
        this.close({ byUser: true });
        break;
      case 'Tab':
        this.handleTabKey(event);
        break;
    }
  }

  handleTabKey(event) {
    if (!this.firstFocusableElement || !this.lastFocusableElement) return;

    if (event.shiftKey && document.activeElement === this.firstFocusableElement) {
      event.preventDefault();
      this.lastFocusableElement.focus();
    } else if (!event.shiftKey && document.activeElement === this.lastFocusableElement) {
      event.preventDefault();
      this.firstFocusableElement.focus();
    }
  }

  setFocusableElements() {
    const focusableSelectors =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    this.focusableElements = [...this.shadowRoot.querySelectorAll(focusableSelectors)];
    this.firstFocusableElement = this.focusableElements[0];
    this.lastFocusableElement = this.focusableElements[this.focusableElements.length - 1];
  }

  /**
   * ##Scroll-lock
   */
  lockScroll() {
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = this.getScrollbarWidth() + 'px';
  }

  unlockScroll() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

  getScrollbarWidth() {
    return window.innerWidth - document.documentElement.clientWidth;
  }
}

customElements.define('custom-modal', Modal);
