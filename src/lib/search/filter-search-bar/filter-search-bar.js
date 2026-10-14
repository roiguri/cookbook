import { icons } from '../../../js/icons.js';
import { debounce } from '../../../js/utils/common-utils.js';

/**
 * FilterSearchBar Component
 * Search bar component for filtering recipes with real-time functionality.
 */
class FilterSearchBar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.debouncedSearchInput = debounce((searchText) => {
      this.dispatchEvent(
        new CustomEvent('search-input', {
          bubbles: true,
          composed: true,
          detail: { searchText },
        }),
      );
    }, 300);
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    const placeholder = this.getAttribute('placeholder') || 'חיפוש מתכונים...';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }

        .search-container {
          position: relative;
          width: 100%;
          display: flex;
          align-items: center;
          background: var(--surface-1, #fff);
          border: 1px solid var(--hairline-strong, rgba(31, 29, 24, 0.2));
          border-radius: var(--r-pill, 999px);
          transition: border-color var(--dur-1, 160ms) ease, box-shadow var(--dur-1, 160ms) ease;
        }

        .search-container:focus-within {
          border-color: var(--primary, #6a994e);
          box-shadow: 0 0 0 3px rgba(106, 153, 78, 0.12);
        }

        .search-input {
          width: 100%;
          height: 38px;
          padding: 0 44px 0 44px; /* Balanced padding for icon and clear button */
          border: 0;
          background: transparent;
          outline: none;
          font-size: 14px;
          font-family: var(--font-ui, system-ui, sans-serif);
          color: var(--ink-1, #1a1a1a);
          font-weight: 400;
          box-sizing: border-box;
        }

        .search-input::placeholder {
          color: var(--ink-3, #7c7562);
        }

        .search-icon {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--ink-3, #7c7562);
          pointer-events: none;
          display: flex;
          align-items: center;
        }

        .clear-button {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--ink-3, #7c7562);
          cursor: pointer;
          font-size: 16px;
          padding: 0;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: none;
          align-items: center;
          justify-content: center;
          transition: color var(--dur-1, 160ms) ease, background var(--dur-1, 160ms) ease,
                      transform var(--dur-1, 160ms) ease;
          font-weight: bold;
          line-height: 1;
        }

        .clear-button:hover {
          color: var(--ink-1, #1a1a1a);
        }

        .clear-button:active {
          color: var(--ink-1, #1a1a1a);
          background: var(--hairline, rgba(31,29,24,0.1));
          transform: translateY(-50%) scale(var(--press-scale-icon, 0.9));
        }

        .clear-button.visible {
          display: flex;
        }

        /* RTL support */
        :host([dir="rtl"]) .search-container {
          direction: rtl;
        }

        :host([dir="rtl"]) .search-input {
          padding-right: 44px;
          padding-left: 44px;
        }

        :host([dir="rtl"]) .search-icon {
          left: auto;
          right: 16px;
        }

        :host([dir="rtl"]) .clear-button {
          right: auto;
          left: 14px;
        }

      </style>

      <div class="search-container" dir="rtl">
        <input
          type="text"
          class="search-input"
          placeholder="${placeholder}"
          aria-label="חיפוש מתכונים">
        <span class="search-icon" aria-hidden="true">
          ${icons.search}
        </span>
        <button class="clear-button" type="button" aria-label="נקה חיפוש">×</button>
      </div>
    `;
  }

  setupEventListeners() {
    const input = this.shadowRoot.querySelector('.search-input');
    const clearButton = this.shadowRoot.querySelector('.clear-button');

    input.addEventListener('input', (e) => {
      const searchText = e.target.value.trim();

      this.updateClearButtonVisibility();

      this.debouncedSearchInput(searchText);
    });

    clearButton.addEventListener('click', () => {
      this.clear();
    });
  }

  getValue() {
    return this.shadowRoot.querySelector('.search-input').value;
  }

  setValue(text) {
    this.shadowRoot.querySelector('.search-input').value = text;
    this.updateClearButtonVisibility();
  }

  clear() {
    const input = this.shadowRoot.querySelector('.search-input');
    if (input.value !== '') {
      input.value = '';
      this.updateClearButtonVisibility();

      this.dispatchEvent(
        new CustomEvent('search-input', {
          bubbles: true,
          composed: true,
          detail: { searchText: '' },
        }),
      );
      this.debouncedSearchInput.cancel();
    }
  }

  updateClearButtonVisibility() {
    const input = this.shadowRoot.querySelector('.search-input');
    const clearButton = this.shadowRoot.querySelector('.clear-button');

    if (input.value.trim().length > 0) {
      clearButton.classList.add('visible');
    } else {
      clearButton.classList.remove('visible');
    }
  }
}

customElements.define('filter-search-bar', FilterSearchBar);
