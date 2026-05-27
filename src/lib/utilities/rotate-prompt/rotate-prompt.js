/**
 * Rotate Prompt Web Component (<rotate-prompt>)
 *
 * Full-cover overlay shown when a feature needs the device in landscape
 * (e.g. mini-games with horizontal layouts). Auto-shows/hides based on a
 * matchMedia query, and provides a "continue anyway" dismiss button that
 * persists for the component's lifetime.
 *
 * Drop it anywhere as a child of a positioned element (it uses inset: 0)
 * and it will float over its parent's content.
 *
 * Attributes:
 *  - active-media: media query that activates the prompt
 *      (default: "(orientation: portrait) and (max-width: 768px)")
 *  - title-text:   heading shown above the body (default Hebrew)
 *  - body-text:    explanatory text below the heading (default Hebrew)
 *  - dismiss-label: button copy that hides the prompt (default Hebrew).
 *      Set to empty string to hide the dismiss button entirely.
 *
 * Events:
 *  - rotate-prompt-dismissed: fired once when the user clicks dismiss.
 *
 * Programmatic API:
 *  - el.reset() — clear the dismissed flag so the prompt can show again.
 */
class RotatePrompt extends HTMLElement {
  static get observedAttributes() {
    return ['active-media', 'title-text', 'body-text', 'dismiss-label'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._dismissed = false;
    this._mql = null;
    this._onMediaChange = () => this._evaluate();
  }

  connectedCallback() {
    this._render();
    this._bindMedia();
    this._evaluate();
  }

  disconnectedCallback() {
    this._unbindMedia();
  }

  attributeChangedCallback(name, _oldValue, _newValue) {
    if (!this.shadowRoot.hasChildNodes()) return;
    if (name === 'active-media') {
      this._unbindMedia();
      this._bindMedia();
      this._evaluate();
    } else {
      this._render();
      this._evaluate();
    }
  }

  reset() {
    this._dismissed = false;
    this._evaluate();
  }

  get _activeMedia() {
    return this.getAttribute('active-media') || '(orientation: portrait) and (max-width: 768px)';
  }

  get _titleText() {
    return this.getAttribute('title-text') || 'סובב את המסך לרוחב';
  }

  get _bodyText() {
    return (
      this.getAttribute('body-text') || 'התצוגה עוצבה למצב אופקי. סובב את המכשיר לרוחב כדי להמשיך.'
    );
  }

  get _dismissLabel() {
    if (this.hasAttribute('dismiss-label')) return this.getAttribute('dismiss-label');
    return 'המשך בכל זאת';
  }

  _bindMedia() {
    this._mql = window.matchMedia(this._activeMedia);
    if (this._mql.addEventListener) {
      this._mql.addEventListener('change', this._onMediaChange);
    } else if (this._mql.addListener) {
      this._mql.addListener(this._onMediaChange);
    }
  }

  _unbindMedia() {
    if (!this._mql) return;
    if (this._mql.removeEventListener) {
      this._mql.removeEventListener('change', this._onMediaChange);
    } else if (this._mql.removeListener) {
      this._mql.removeListener(this._onMediaChange);
    }
    this._mql = null;
  }

  _evaluate() {
    const root = this.shadowRoot.querySelector('.rotate-prompt');
    if (!root) return;
    const shouldShow = !!(this._mql && this._mql.matches) && !this._dismissed;
    root.hidden = !shouldShow;
    this.toggleAttribute('active', shouldShow);
  }

  _render() {
    const dismissLabel = this._dismissLabel;
    const dismissMarkup = dismissLabel
      ? `<button class="rotate-prompt__dismiss" type="button">${dismissLabel}</button>`
      : '';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: absolute;
          inset: 0;
          /* --z-page-overlay covers above-content-but-below-app-chrome overlays.
             Inherits across shadow DOM via CSS custom properties. */
          z-index: var(--z-page-overlay, 200);
          pointer-events: none;
        }

        :host([active]) {
          pointer-events: auto;
        }

        .rotate-prompt {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: rgba(31, 29, 24, 0.86);
          color: #fff;
          font-family: var(--font-ui-he, var(--font-ui, system-ui, sans-serif));
        }

        .rotate-prompt[hidden] { display: none; }

        .rotate-prompt__content {
          text-align: center;
          padding: 24px;
          max-width: 280px;
        }

        .rotate-prompt__icon {
          font-size: 64px;
          line-height: 1;
          display: inline-block;
          animation: rotate-prompt-spin 2.4s ease-in-out infinite;
        }

        @keyframes rotate-prompt-spin {
          0%, 100% { transform: rotate(0deg); }
          50%      { transform: rotate(-90deg); }
        }

        .rotate-prompt__title {
          margin: 14px 0 8px;
          font-size: 1.4rem;
          font-weight: 700;
        }

        .rotate-prompt__body {
          margin: 0 0 18px;
          font-size: 0.95rem;
          color: rgba(255, 255, 255, 0.85);
          line-height: 1.4;
        }

        .rotate-prompt__dismiss {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.45);
          color: #fff;
          padding: 8px 20px;
          border-radius: 999px;
          cursor: pointer;
          font-family: inherit;
          font-size: 0.9rem;
          transition: background-color 120ms ease-out;
        }

        .rotate-prompt__dismiss:hover {
          background-color: rgba(255, 255, 255, 0.12);
        }
      </style>

      <div class="rotate-prompt" hidden role="dialog" aria-modal="true" aria-labelledby="rotate-prompt-title">
        <div class="rotate-prompt__content">
          <div class="rotate-prompt__icon" aria-hidden="true">📱</div>
          <h3 id="rotate-prompt-title" class="rotate-prompt__title">${this._titleText}</h3>
          <p class="rotate-prompt__body">${this._bodyText}</p>
          ${dismissMarkup}
        </div>
      </div>
    `;

    const dismissBtn = this.shadowRoot.querySelector('.rotate-prompt__dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        if (this._dismissed) return;
        this._dismissed = true;
        this._evaluate();
        this.dispatchEvent(
          new CustomEvent('rotate-prompt-dismissed', { bubbles: true, composed: true }),
        );
      });
    }
  }
}

customElements.define('rotate-prompt', RotatePrompt);

export { RotatePrompt };
