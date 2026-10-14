import { icons } from '../../../js/icons.js';
import './auth-content.js';

class LoginForm extends HTMLElement {
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

        .stack { display: flex; flex-direction: column; gap: 16px; padding: 0 40px 36px; }

        .field { display: flex; flex-direction: column; gap: 6px; }
        .field label {
          font-family: var(--font-ui-he, system-ui, sans-serif);
          font-size: 12px; font-weight: 600;
          color: var(--ink-3, #7c7562);
          display: flex; justify-content: space-between; align-items: baseline;
        }
        .field input {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 14.5px; color: var(--ink, #1f1d18);
          background: var(--surface-0, #faf7f2);
          border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
          border-radius: var(--r-sm, 8px);
          padding: 12px 14px; outline: none; width: 100%;
          box-sizing: border-box;
          transition: border-color var(--dur-1, 160ms) var(--ease, ease),
                      box-shadow var(--dur-1, 160ms) var(--ease, ease);
        }
        .field input:focus {
          border-color: var(--primary, #6a994e);
          box-shadow: 0 0 0 3px rgba(106,153,78,0.12);
        }
        .field .err {
          font-family: var(--font-mono, monospace);
          font-size: 10.5px; color: var(--secondary-dark, #9a3a3c);
          display: none; align-items: center; gap: 6px;
        }
        .field .err.visible { display: flex; }
        .field .err::before {
          content: "!"; width: 14px; height: 14px; border-radius: 50%;
          background: var(--secondary, #bc4749); color: #fff;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; flex-shrink: 0;
        }

        .input-icon { position: relative; }
        .input-icon input { padding-right: 40px; }
        .input-icon .eye {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          color: var(--ink-3, #7c7562); cursor: pointer; padding: 4px;
          background: none; border: none; display: flex; align-items: center;
          font-size: 18px;
        }
        .input-icon .eye:hover, .input-icon .eye:active { color: var(--ink, #1f1d18); }

        .row-between {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-top: 4px;
        }
        .check {
          display: inline-flex; align-items: center; gap: 8px;
          cursor: pointer;
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 13px; color: var(--ink, #1f1d18);
          user-select: none;
        }
        .check input[type="checkbox"] { display: none; }
        .check .box {
          width: 18px; height: 18px;
          border-radius: var(--r-xs, 4px);
          border: 1.5px solid var(--hairline-strong, rgba(31,29,24,0.2));
          background: var(--surface-0, #faf7f2);
          display: inline-flex; align-items: center; justify-content: center;
          transition: background var(--dur-1, 160ms), border-color var(--dur-1, 160ms), transform var(--dur-1, 160ms);
          flex-shrink: 0;
        }
        .check:active .box { border-color: var(--primary, #6a994e); transform: scale(var(--press-scale-icon, 0.9)); }
        .check input:checked + .box {
          background: var(--primary, #6a994e);
          border-color: var(--primary, #6a994e);
        }
        .check input:checked + .box::after {
          content: "";
          width: 10px; height: 6px;
          border-left: 2px solid #fff; border-bottom: 2px solid #fff;
          transform: rotate(-45deg) translate(1px, -1px);
        }

        .link {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 13px; color: var(--primary-dark, #386641);
          text-decoration: none;
          border-bottom: 1px solid transparent;
          cursor: pointer;
        }
        .link:hover { border-color: var(--primary, #6a994e); }
        .link:active { border-color: var(--primary, #6a994e); opacity: 0.7; }

        .btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 10px;
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 14px; font-weight: 500;
          padding: 13px 20px; border-radius: var(--r-sm, 8px);
          border: 1px solid transparent; cursor: pointer;
          transition: background var(--dur-1, 160ms), transform var(--dur-1, 160ms);
          width: 100%;
        }
        .btn-primary { background: var(--primary, #6a994e); color: #fff; }
        .btn:active:not(:disabled) { transform: scale(var(--press-scale, 0.97)); }
        .btn-primary:hover, .btn-primary:active { background: var(--primary-dark, #386641); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-social {
          background: var(--surface-1, #fff); color: var(--ink, #1f1d18);
          border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
          padding: 12px 16px; font-weight: 500; font-size: 13.5px;
        }
        .btn-social:hover, .btn-social:active { background: var(--surface-2, #f2e8cf); }
        .btn-social .logo {
          width: 18px; height: 18px;
          display: inline-flex; align-items: center; justify-content: center;
        }

        .or {
          display: grid; grid-template-columns: 1fr auto 1fr;
          align-items: center; gap: 14px; margin: 6px 0;
          font-family: var(--font-mono, monospace);
          font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
          color: var(--ink-3, #7c7562);
        }
        .or::before, .or::after { content: ""; height: 1px; background: var(--hairline, rgba(31,29,24,0.08)); }

        .socials { display: grid; gap: 10px; }

        .footer-note {
          margin-top: 24px;
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 12.5px; color: var(--ink-3, #7c7562);
          text-align: center;
        }
        .footer-note a {
          color: var(--primary-dark, #386641); text-decoration: none;
          border-bottom: 1px dotted var(--primary, #6a994e); cursor: pointer;
        }
        .footer-note a:active { opacity: 0.7; }

        @media (max-width: 560px) {
          .stack { padding-left: 22px; padding-right: 22px; }
        }
      </style>

      <form class="stack" id="login-form" novalidate>
        <div class="field">
          <label>כתובת מייל</label>
          <input type="email" id="login-email" autocomplete="email" />
        </div>

        <div class="field">
          <label>סיסמה</label>
          <div class="input-icon">
            <input type="password" id="login-password" autocomplete="current-password" />
            <button type="button" class="eye" id="toggle-pw" aria-label="הצג סיסמה">
              ${icons.eye}
            </button>
          </div>
          <span class="err" id="login-error"></span>
        </div>

        <div class="row-between">
          <label class="check">
            <input type="checkbox" id="remember" />
            <span class="box"></span>
            זכור אותי
          </label>
          <a class="link" id="forgot-password-link">שכחת סיסמה?</a>
        </div>

        <button type="submit" class="btn btn-primary" style="margin-top:8px;">
          התחבר
          ${icons.arrowLeft}
        </button>

        <div class="or">או</div>

        <div class="socials">
          <button type="button" class="btn btn-social" id="google-signin">
            <span class="logo">${icons.googleLogo}</span>
            המשך עם Google
          </button>
        </div>

        <p class="footer-note">
          חדש כאן? <a id="goto-signup">יצירת חשבון</a>
        </p>
      </form>
    `;
  }

  setupEventListeners() {
    this.shadowRoot
      .getElementById('login-form')
      .addEventListener('submit', (e) => this._handleSubmit(e));
    this.shadowRoot
      .getElementById('forgot-password-link')
      .addEventListener('click', () => this._handleForgotPassword());
    this.shadowRoot
      .getElementById('google-signin')
      .addEventListener('click', () => this._handleGoogleSignIn());
    this.shadowRoot
      .getElementById('toggle-pw')
      .addEventListener('click', () => this._togglePassword());
    this.shadowRoot.getElementById('goto-signup').addEventListener('click', (e) => {
      e.preventDefault();
      const authContent = this.closest('auth-content');
      authContent?._switchAuthTab('signup');
    });
  }

  _togglePassword() {
    const input = this.shadowRoot.getElementById('login-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  async _handleSubmit(e) {
    e.preventDefault();
    const email = this.shadowRoot.getElementById('login-email').value;
    const password = this.shadowRoot.getElementById('login-password').value;
    const remember = this.shadowRoot.getElementById('remember').checked;

    const btn = this.shadowRoot.querySelector('button[type="submit"]');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.textContent = 'מתחבר...';

    try {
      const authController = this.closest('auth-controller');
      await authController.handleLogin(email, password, remember);
      authController.closeModal();
    } catch (error) {
      this._showError(error);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  _handleForgotPassword() {
    this.dispatchEvent(
      new CustomEvent('switch-to-forgot-password', {
        bubbles: true,
        composed: true,
        detail: { email: this.shadowRoot.getElementById('login-email').value },
      }),
    );
  }

  async _handleGoogleSignIn() {
    const btn = this.shadowRoot.getElementById('google-signin');
    btn.disabled = true;
    try {
      const authController = this.closest('auth-controller');
      await authController.handleGoogleSignIn();
      authController.closeModal();
    } catch (error) {
      this._showError(error);
    } finally {
      btn.disabled = false;
    }
  }

  _showError(error) {
    const AUTH_ERRORS = {
      'auth/invalid-credential': 'כתובת מייל או סיסמה שגויים',
      INVALID_LOGIN_CREDENTIALS: 'כתובת מייל או סיסמה שגויים',
      'auth/invalid-email': 'כתובת מייל לא תקינה',
      'auth/user-disabled': 'חשבון זה מושבת',
      'auth/user-not-found': 'לא נמצא חשבון עבור כתובת מייל זו',
      'auth/wrong-password': 'סיסמה שגויה',
      'auth/too-many-requests': 'יותר מדי ניסיונות. נסה שנית מאוחר יותר',
      'auth/network-request-failed': 'שגיאת רשת. בדוק את החיבור שלך',
      'auth/popup-closed-by-user': 'חלון ההתחברות נסגר לפני סיום',
      'auth/popup-blocked': 'חלון קופץ נחסם. אנא אפשר חלונות קופצים ונסה שנית',
      'auth/account-exists-with-different-credential':
        'קיים חשבון עם כתובת מייל זו עם שיטת התחברות שונה',
    };
    let code = error.code;
    if (code === 'auth/internal-error' && error.message) {
      try {
        code = JSON.parse(error.message).error.message;
      } catch (_) {}
    }
    const msg = AUTH_ERRORS[code] || 'ההתחברות נכשלה. נסה שנית.';
    const el = this.shadowRoot.getElementById('login-error');
    el.textContent = msg;
    el.classList.add('visible');
  }

  _clearError() {
    const el = this.shadowRoot.getElementById('login-error');
    el.textContent = '';
    el.classList.remove('visible');
  }

  reset() {
    this.shadowRoot.getElementById('login-form').reset();
    this._clearError();
  }
}

customElements.define('login-form', LoginForm);
