import './auth-content.js';

class ForgotPassword extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        .body { padding: 32px 40px 36px; }

        .title {
          text-align: center;
          font-family: var(--font-display, serif);
          font-style: italic;
          font-size: 28px;
          line-height: 1.1;
          letter-spacing: -0.02em;
          color: var(--ink, #1f1d18);
          margin: 0 0 8px;
        }
        .title em { font-style: normal; color: var(--primary-dark, #386641); }

        .dek {
          text-align: center;
          margin: 0 0 24px;
          color: var(--ink-3, #7c7562);
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 14px;
          line-height: 1.55;
        }

        .stack { display: flex; flex-direction: column; gap: 16px; }

        .field { display: flex; flex-direction: column; gap: 6px; }
        .field label {
          font-family: var(--font-ui-he, system-ui, sans-serif);
          font-size: 12px; font-weight: 600;
          color: var(--ink-3, #7c7562);
        }
        .field input {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 14.5px; color: var(--ink, #1f1d18);
          background: var(--surface-0, #faf7f2);
          border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
          border-radius: var(--r-sm, 8px);
          padding: 12px 14px; outline: none; width: 100%; box-sizing: border-box;
          transition: border-color var(--dur-1, 160ms), box-shadow var(--dur-1, 160ms);
        }
        .field input:focus {
          border-color: var(--primary, #6a994e);
          box-shadow: 0 0 0 3px rgba(106,153,78,0.12);
        }

        .btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 10px;
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 14px; font-weight: 500;
          padding: 13px 20px; border-radius: var(--r-sm, 8px);
          border: 1px solid transparent; cursor: pointer; width: 100%;
          transition: background var(--dur-1, 160ms), transform var(--dur-1, 160ms);
        }
        .btn:active:not(:disabled) { transform: scale(var(--press-scale, 0.97)); }
        .btn-primary { background: var(--primary, #6a994e); color: #fff; }
        .btn-primary:hover, .btn-primary:active { background: var(--primary-dark, #386641); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

        .msg {
          font-family: var(--font-mono, monospace);
          font-size: 11px; padding: 10px 14px; border-radius: var(--r-sm, 8px);
          display: none;
        }
        .msg.err {
          background: color-mix(in oklab, var(--secondary, #bc4749) 8%, white);
          color: var(--secondary-dark, #9a3a3c);
          border: 1px solid color-mix(in oklab, var(--secondary, #bc4749) 20%, white);
        }
        .msg.ok {
          background: color-mix(in oklab, var(--primary, #6a994e) 8%, white);
          color: var(--primary-dark, #386641);
          border: 1px solid color-mix(in oklab, var(--primary, #6a994e) 20%, white);
        }
        .msg.visible { display: block; }

        .back {
          display: inline-flex; align-self: center; margin-top: 16px; text-align: center;
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 13px; color: var(--primary-dark, #386641);
          text-decoration: none;
          border-bottom: 1px solid transparent; cursor: pointer;
        }
        .back:hover { border-color: var(--primary, #6a994e); }
        .back:active { border-color: var(--primary, #6a994e); opacity: 0.7; }

        @media (max-width: 560px) {
          .body { padding-left: 22px; padding-right: 22px; }
        }
      </style>

      <div class="body">
        <h2 class="title">Reset your <em>password</em></h2>
        <p class="dek">הזן את כתובת המייל שלך ונשלח לך קישור לאיפוס הסיסמה.</p>

        <form class="stack" id="reset-form" novalidate>
          <div class="field">
            <label>כתובת מייל</label>
            <input type="email" id="reset-email" autocomplete="email" />
          </div>
          <span class="msg" id="reset-msg"></span>
          <button type="submit" class="btn btn-primary">שלח קישור לאיפוס</button>
          <a class="back" id="back-link">→ חזרה להתחברות</a>
        </form>
      </div>
    `;
  }

  setupEventListeners() {
    this.shadowRoot
      .getElementById('reset-form')
      .addEventListener('submit', (e) => this._handleSubmit(e));
    this.shadowRoot.getElementById('back-link').addEventListener('click', (e) => {
      e.preventDefault();
      this._goBack();
    });
  }

  async _handleSubmit(e) {
    e.preventDefault();
    const email = this.shadowRoot.getElementById('reset-email').value;
    const btn = this.shadowRoot.querySelector('button[type="submit"]');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'שולח...';
    this._clearMsg();

    try {
      const authController = this.closest('auth-controller');
      await authController.handlePasswordReset(email);
      this._showMsg('ok', 'הקישור נשלח — בדוק את תיבת הדואר שלך.');
      setTimeout(() => this._goBack(), 3000);
    } catch (error) {
      this._handleError(error);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  _handleError(error) {
    const ERRORS = {
      'auth/invalid-email': 'כתובת מייל לא תקינה.',
      'auth/user-not-found': 'לא נמצא חשבון עבור כתובת מייל זו.',
      'auth/network-request-failed': 'שגיאת רשת. בדוק את החיבור שלך.',
    };
    const msg = ERRORS[error.code] || 'שליחת הקישור נכשלה. נסה שנית.';
    this._showMsg('err', msg);
  }

  _goBack() {
    this.dispatchEvent(new CustomEvent('back-to-login', { bubbles: true, composed: true }));
  }

  _showMsg(type, text) {
    const el = this.shadowRoot.getElementById('reset-msg');
    el.textContent = text;
    el.className = `msg ${type} visible`;
  }

  _clearMsg() {
    const el = this.shadowRoot.getElementById('reset-msg');
    el.className = 'msg';
    el.textContent = '';
  }

  reset() {
    this.shadowRoot.getElementById('reset-form').reset();
    this._clearMsg();
  }
}

customElements.define('forgot-password', ForgotPassword);
