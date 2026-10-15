import { icons } from '../../../js/icons.js';
import './auth-content.js';

class SignupForm extends HTMLElement {
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

        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

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
        .input-icon .eye:active { transform: translateY(-50%) scale(var(--press-scale-icon, 0.9)); }

        /* 4-segment strength bar */
        .strength { display: flex; gap: 4px; margin-top: 6px; }
        .strength i {
          flex: 1; height: 3px; border-radius: 2px;
          background: var(--hairline-strong, rgba(31,29,24,0.2));
          transition: background var(--dur-1, 160ms);
        }
        .strength.s1 i:nth-child(-n+1) { background: var(--secondary, #bc4749); }
        .strength.s2 i:nth-child(-n+2) { background: #d99a3a; }
        .strength.s3 i:nth-child(-n+3) { background: var(--primary, #6a994e); }
        .strength.s4 i { background: var(--primary-dark, #386641); }
        .strength-label {
          font-family: var(--font-mono, monospace);
          font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--ink-3, #7c7562); margin-top: 4px; display: block;
        }
        .strength-label b { color: var(--primary-dark, #386641); font-weight: 500; }

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
          .grid2 { grid-template-columns: 1fr; }
        }
      </style>

      <form class="stack" id="signup-form" novalidate>
        <div class="grid2">
          <div class="field">
            <label for="first-name">שם פרטי</label>
            <input type="text" id="first-name" autocomplete="given-name" />
          </div>
          <div class="field">
            <label for="last-name">שם משפחה</label>
            <input type="text" id="last-name" autocomplete="family-name" />
          </div>
        </div>

        <div class="field">
          <label for="signup-email">כתובת מייל</label>
          <input type="email" id="signup-email" autocomplete="email" />
        </div>

        <div class="field">
          <label for="signup-password">סיסמה</label>
          <div class="input-icon">
            <input type="password" id="signup-password" autocomplete="new-password" />
            <button type="button" class="eye" id="toggle-pw" aria-label="הצג סיסמה">
              ${icons.eye}
            </button>
          </div>
          <div class="strength" id="strength-bar"><i></i><i></i><i></i><i></i></div>
          <span class="strength-label" id="strength-label"></span>
        </div>

        <div class="field">
          <label for="confirm-password">אימות סיסמה</label>
          <input type="password" id="confirm-password" autocomplete="new-password" />
          <span class="err" id="signup-error"></span>
        </div>

        <button type="submit" class="btn btn-primary" style="margin-top:6px;">
          יצירת חשבון
          ${icons.arrowLeft}
        </button>

        <div class="or">או</div>

        <div class="socials">
          <button type="button" class="btn btn-social" id="google-signup">
            <span class="logo">${icons.googleLogo}</span>
            הרשמה עם Google
          </button>
        </div>

        <p class="footer-note">
          כבר חלק מהמשפחה? <a id="goto-signin">התחברות</a>
        </p>
      </form>
    `;
  }

  setupEventListeners() {
    this.shadowRoot
      .getElementById('signup-form')
      .addEventListener('submit', (e) => this._handleSubmit(e));
    this.shadowRoot
      .getElementById('signup-password')
      .addEventListener('input', () => this._checkStrength());
    this.shadowRoot
      .getElementById('confirm-password')
      .addEventListener('input', () => this._checkMatch());
    this.shadowRoot
      .getElementById('google-signup')
      .addEventListener('click', () => this._handleGoogleSignup());
    this.shadowRoot
      .getElementById('toggle-pw')
      .addEventListener('click', () => this._togglePassword());
    this.shadowRoot.getElementById('goto-signin').addEventListener('click', (e) => {
      e.preventDefault();
      const authContent = this.closest('auth-content');
      authContent?._switchAuthTab('signin');
    });
  }

  _togglePassword() {
    const input = this.shadowRoot.getElementById('signup-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  _checkStrength() {
    const pw = this.shadowRoot.getElementById('signup-password').value;
    const bar = this.shadowRoot.getElementById('strength-bar');
    const label = this.shadowRoot.getElementById('strength-label');
    bar.className = 'strength';

    if (!pw) {
      label.innerHTML = '';
      return;
    }

    let score = 0;
    if (pw.length >= 8) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;

    const levels = ['', 's1', 's2', 's3', 's4'];
    const names = ['', 'חלשה', 'בינונית', 'חזקה', 'מצוינת'];
    if (score > 0) bar.classList.add(levels[score]);
    label.innerHTML = score > 0 ? `חוזק: <b>${names[score]}</b>` : '';
  }

  _checkMatch() {
    const pw = this.shadowRoot.getElementById('signup-password').value;
    const confirm = this.shadowRoot.getElementById('confirm-password').value;
    if (confirm && pw !== confirm) {
      this._showError('הסיסמאות אינן תואמות');
    } else {
      this._clearError();
    }
  }

  async _handleSubmit(e) {
    e.preventDefault();
    const firstName = this.shadowRoot.getElementById('first-name').value.trim();
    const lastName = this.shadowRoot.getElementById('last-name').value.trim();
    const email = this.shadowRoot.getElementById('signup-email').value;
    const password = this.shadowRoot.getElementById('signup-password').value;
    const confirm = this.shadowRoot.getElementById('confirm-password').value;
    if (!firstName) {
      this._showError('יש להזין שם פרטי');
      return;
    }
    if (password !== confirm) {
      this._showError('הסיסמאות אינן תואמות');
      return;
    }

    const btn = this.shadowRoot.querySelector('button[type="submit"]');
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.textContent = 'יוצר חשבון...';

    try {
      const authController = this.closest('auth-controller');
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      await authController.handleSignup(email, password, fullName);
      this.dispatchEvent(new CustomEvent('signup-success', { bubbles: true, composed: true }));
    } catch (error) {
      this._handleError(error);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  async _handleGoogleSignup() {
    const btn = this.shadowRoot.getElementById('google-signup');
    btn.disabled = true;
    try {
      const authController = this.closest('auth-controller');
      await authController.handleGoogleSignIn();
      this.dispatchEvent(new CustomEvent('signup-success', { bubbles: true, composed: true }));
    } catch (error) {
      this._handleError(error);
    } finally {
      btn.disabled = false;
    }
  }

  _handleError(error) {
    const ERRORS = {
      'auth/email-already-in-use': 'כבר קיים חשבון עם כתובת מייל זו.',
      'auth/invalid-email': 'כתובת מייל לא תקינה.',
      'auth/weak-password': 'הסיסמה חלשה מדי. בחר סיסמה חזקה יותר.',
      'auth/network-request-failed': 'שגיאת רשת. בדוק את החיבור שלך.',
    };
    const msg = ERRORS[error.code] || error.message || 'ההרשמה נכשלה. נסה שנית.';
    this._showError(msg);
  }

  _showError(msg) {
    const el = this.shadowRoot.getElementById('signup-error');
    el.textContent = msg;
    el.classList.add('visible');
  }

  _clearError() {
    const el = this.shadowRoot.getElementById('signup-error');
    el.textContent = '';
    el.classList.remove('visible');
  }

  reset() {
    this.shadowRoot.getElementById('signup-form').reset();
    this._clearError();
    this.shadowRoot.getElementById('strength-bar').className = 'strength';
    this.shadowRoot.getElementById('strength-label').innerHTML = '';
  }
}

customElements.define('signup-form', SignupForm);
