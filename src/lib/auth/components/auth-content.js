import authService from '../../../js/services/auth/auth-service.js';

class AuthContent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._mode = 'auth'; // 'auth' | 'profile'
    this._activeTab = 'signin';
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.showAuthForms();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; }

        /* ---- Auth mode: body ---- */
        .auth-body {
          padding: 32px 40px 8px;
          display: none;
          text-align: center;
        }
        .auth-title {
          font-family: var(--font-display, serif);
          font-style: italic;
          font-size: 34px;
          line-height: 1.05;
          letter-spacing: -0.02em;
          color: var(--ink, #1f1d18);
          margin: 0 0 6px;
          text-align: center;
        }
        .auth-title em { font-style: normal; color: var(--primary-dark, #386641); }
        .auth-dek {
          margin: 0 0 24px;
          color: var(--ink-3, #7c7562);
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 14px;
          line-height: 1.55;
        }

        /* ---- Tabs (pill segmented control) ---- */
        .auth-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2px;
          background: var(--surface-2, #f2e8cf);
          padding: 4px;
          border-radius: var(--r-pill, 999px);
          margin: 0 0 28px;
          text-align: right;
        }
        .auth-tab {
          font-family: var(--font-ui-he, system-ui, sans-serif);
          font-size: 13px;
          font-weight: 500;
          padding: 10px 14px;
          border-radius: var(--r-pill, 999px);
          border: 0;
          cursor: pointer;
          background: transparent;
          color: var(--ink-3, #7c7562);
          transition: background var(--dur-1, 160ms) var(--ease, ease), color var(--dur-1, 160ms) var(--ease, ease);
        }
        .auth-tab.on {
          background: var(--surface-1, #fff);
          color: var(--primary-dark, #386641);
          box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
        }

        /* ---- Profile mode: head ---- */
        .profile-head {
          display: none;
          gap: 18px;
          align-items: center;
          padding: 24px 40px 22px;
          background: var(--surface-2, #f2e8cf);
          border-radius: var(--r-xl, 20px) var(--r-xl, 20px) var(--r-lg, 16px) var(--r-lg, 16px);
        }
        .avatar-xl {
          width: 72px; height: 72px;
          border-radius: 50%;
          flex-shrink: 0;
          background: linear-gradient(135deg, var(--primary-bright, #a7c957), var(--primary-dark, #386641));
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 2px solid rgba(255,255,255,0.7);
          box-shadow: 0 2px 10px rgba(56,102,65,0.22);
          position: relative;
          overflow: hidden;
        }
        .avatar-xl img {
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
          transform: scale(1.12) translateY(4%);
        }
        .avatar-xl .initial {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-weight: 600;
          font-size: 28px;
          color: #fff;
        }
        .profile-info { min-width: 0; }
        .profile-name {
          font-family: var(--font-display, serif);
          font-style: italic;
          font-size: 22px;
          letter-spacing: -0.01em;
          color: var(--ink, #1f1d18);
          margin: 0 0 3px;
          line-height: 1.15;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .profile-sub {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 12px;
          color: var(--ink-3, #7c7562);
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ---- Profile tabs (underline) ---- */
        .profile-tabs {
          display: none;
          grid-template-columns: repeat(3, 1fr);
          padding: 0 40px;
          border-bottom: 1px solid var(--hairline, rgba(31,29,24,0.10));
          background: var(--surface-1, #fff);
        }
        .profile-tab {
          background: transparent;
          border: 0;
          padding: 13px 0;
          margin: 0;
          text-align: center;
          font-family: var(--font-ui-he, system-ui, sans-serif);
          font-size: 12.5px;
          font-weight: 500;
          color: var(--ink-3, #7c7562);
          cursor: pointer;
          position: relative;
          transition: color var(--dur-1, 160ms) var(--ease, ease);
        }
        .profile-tab:hover { color: var(--ink, #1f1d18); }
        .profile-tab.on { color: var(--primary-dark, #386641); }
        .profile-tab.on::after {
          content: "";
          position: absolute;
          left: 16%; right: 16%; bottom: -1px;
          height: 2px;
          background: var(--primary-dark, #386641);
          border-radius: 2px 2px 0 0;
        }

        /* ---- Slot container ---- */
        .form-container { position: relative; }
        ::slotted(*) { display: none !important; }
        ::slotted(.active) { display: block !important; }

        @media (max-width: 560px) {
          .auth-body, .profile-head, .profile-tabs { padding-left: 22px; padding-right: 22px; }
          .profile-info { min-width: 0; }
        }
      </style>

      <!-- Auth mode: body (title + dek + tabs) -->
      <div class="auth-body" id="auth-body">
        <h2 class="auth-title" id="auth-title">Welcome <em>back.</em></h2>
        <p class="auth-dek" id="auth-dek">התחבר כדי לשמור מועדפים, להשאיר הערות ולהציע מתכוני משפחה.</p>
        <div class="auth-tabs" role="tablist">
          <button type="button" class="auth-tab on" data-tab="signin">התחברות</button>
          <button type="button" class="auth-tab" data-tab="signup">הרשמה</button>
        </div>
      </div>

      <!-- Profile mode: head -->
      <div class="profile-head" id="profile-head">
        <div class="avatar-xl" id="profile-avatar">
          <span class="initial" id="profile-initial"></span>
        </div>
        <div class="profile-info">
          <h3 class="profile-name" id="profile-name"></h3>
          <div class="profile-sub" id="profile-sub">
            <span id="profile-email-sub"></span>
          </div>
        </div>
      </div>

      <!-- Profile mode: underline tabs -->
      <div class="profile-tabs" role="tablist" id="profile-tabs-bar">
        <button type="button" class="profile-tab on" data-ptab="details">פרטים</button>
        <button type="button" class="profile-tab" data-ptab="avatar">אווטאר</button>
        <button type="button" class="profile-tab" data-ptab="security">אבטחה</button>
      </div>

      <!-- Slot host -->
      <div class="form-container">
        <slot name="login-form"></slot>
        <slot name="signup-form"></slot>
        <slot name="forgot-password"></slot>
        <slot name="user-profile"></slot>
      </div>
    `;
  }

  setupEventListeners() {
    // Auth tab switching (sign-in ↔ sign-up)
    this.shadowRoot.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.addEventListener('click', () => this._switchAuthTab(btn.dataset.tab));
    });

    // Profile tab switching
    this.shadowRoot.querySelectorAll('.profile-tab').forEach((btn) => {
      btn.addEventListener('click', () => this._switchProfileTab(btn.dataset.ptab));
    });

    // Listen for forgot-password request from login-form
    this.addEventListener('switch-to-forgot-password', () => this.showForgotPassword());

    // Listen for back-to-login from forgot-password
    this.addEventListener('back-to-login', () => {
      this.showAuthForms();
      this._switchAuthTab('signin');
    });

    // Refresh profile head when profile is updated (e.g. display name saved)
    document.addEventListener('profile-updated', () => {
      if (this._mode === 'profile') this._updateProfileHead();
    });

    // Reset on modal close
    const authController = this.closest('auth-controller');
    const modal = authController?.shadowRoot?.querySelector('custom-modal');
    if (modal) {
      modal.addEventListener('modal-closed', () => {
        setTimeout(() => {
          ['login-form', 'signup-form', 'forgot-password', 'user-profile'].forEach((slot) => {
            const el = this.querySelector(`[slot="${slot}"]`);
            if (typeof el?.reset === 'function') el.reset();
            if (typeof el?.resetState === 'function') el.resetState();
          });
          if (this._mode === 'auth') this.showAuthForms();
        }, 300);
      });
    }
  }

  // ---- Public API ----

  showAuthForms() {
    this._mode = 'auth';
    this._setVisibility('auth');
    this._switchAuthTab(this._activeTab || 'signin');
    const authController = this.closest('auth-controller');
    authController?.setAuthWidth?.();
  }

  showUserProfile() {
    this._mode = 'profile';
    this._setVisibility('profile');
    this._updateProfileHead();
    this._switchProfileTab('details');
    const authController = this.closest('auth-controller');
    authController?.setProfileWidth?.();
  }

  showForgotPassword() {
    this._setAllSlotsHidden();
    const el = this.querySelector('[slot="forgot-password"]');
    if (el) el.classList.add('active');
    this.shadowRoot.getElementById('auth-body').style.display = 'none';
  }

  // ---- Internal helpers ----

  _setVisibility(mode) {
    const body = this.shadowRoot.getElementById('auth-body');
    const head = this.shadowRoot.getElementById('profile-head');
    const tabsBar = this.shadowRoot.getElementById('profile-tabs-bar');

    if (mode === 'auth') {
      body.style.display = 'block';
      head.style.display = 'none';
      tabsBar.style.display = 'none';
    } else {
      body.style.display = 'none';
      head.style.display = 'flex';
      tabsBar.style.display = 'grid';
    }
  }

  _switchAuthTab(tabName) {
    this._activeTab = tabName;

    this.shadowRoot.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.tab === tabName);
    });

    const title = this.shadowRoot.getElementById('auth-title');
    const dek = this.shadowRoot.getElementById('auth-dek');
    if (tabName === 'signin') {
      title.innerHTML = 'Welcome <em>back</em>';
      dek.textContent = 'התחבר כדי לשמור מועדפים, להשאיר הערות ולהציע מתכוני משפחה.';
    } else {
      title.innerHTML = 'A seat at the <em>table</em>';
      dek.textContent = 'הצטרף למשפחה. כאן שומרים מתכונים, חולקים את סודות המטבח, ומשאירים חותם.';
    }

    this._setAllSlotsHidden();
    const slot = tabName === 'signin' ? 'login-form' : 'signup-form';
    const el = this.querySelector(`[slot="${slot}"]`);
    if (el) el.classList.add('active');
  }

  _switchProfileTab(tabName) {
    this.shadowRoot.querySelectorAll('.profile-tab').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.ptab === tabName);
    });
    const userProfile = this.querySelector('[slot="user-profile"]');
    if (userProfile?.showPanel) userProfile.showPanel(tabName);
  }

  _setAllSlotsHidden() {
    this.querySelectorAll('[slot]').forEach((el) => el.classList.remove('active'));
  }

  _updateProfileHead() {
    const user = authService.getCurrentUser();
    if (!user) return;

    const nameEl = this.shadowRoot.getElementById('profile-name');
    const avatarEl = this.shadowRoot.getElementById('profile-avatar');
    const emailSubEl = this.shadowRoot.getElementById('profile-email-sub');

    const displayName = user.displayName || user.email?.split('@')[0] || '';
    if (nameEl) nameEl.textContent = displayName;
    if (emailSubEl) emailSubEl.textContent = user.email || '';

    const avatarUrl = authService.getCurrentAvatarUrl();
    let imgEl = avatarEl?.querySelector('img');
    const initialEl = avatarEl?.querySelector('.initial');

    if (avatarUrl) {
      if (!imgEl) {
        imgEl = document.createElement('img');
        imgEl.alt = 'Avatar';
        avatarEl.prepend(imgEl);
      }
      imgEl.src = avatarUrl;
      if (initialEl) initialEl.style.display = 'none';
    } else {
      imgEl?.remove();
      if (initialEl) {
        initialEl.style.display = '';
        initialEl.textContent = (displayName[0] || '?').toUpperCase();
      }
    }

    this._setAllSlotsHidden();
    const userProfile = this.querySelector('[slot="user-profile"]');
    if (userProfile) userProfile.classList.add('active');
  }
}

customElements.define('auth-content', AuthContent);
