import './auth-content.js';
import '../../modals/confirmation_modal/confirmation_modal.js';
import authService from '../../../js/services/auth/auth-service.js';
import { UserService } from '../../../js/services/users/user-service.js';

let avatarCache = null;

class UserProfile extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.selectedAvatarUrl = null;
    this._activePanel = 'details';
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.showPanel('details');

    const avatarUrl = authService.getCurrentAvatarUrl();
    if (avatarUrl) this.selectedAvatarUrl = avatarUrl;

    authService.addAuthObserver((state) => {
      if (state.user) this._populateDetails();
    });
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        /* ---- Panels ---- */
        .profile-body {
          padding: 28px 40px 32px;
          max-height: 60vh;
          overflow-y: auto;
          -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 24px), transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 24px), transparent 100%);
        }
        .profile-body { scrollbar-width: none; }
        .profile-body::-webkit-scrollbar { display: none; }

        .section-title {
          font-family: var(--font-mono, monospace);
          font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--ink-3, #7c7562);
          margin: 0 0 14px;
          display: flex; align-items: center; gap: 10px;
        }
        .section-title::before {
          content: ""; width: 14px; height: 1px;
          background: var(--primary-dark, #386641);
        }
        .section + .section {
          margin-top: 28px; padding-top: 28px;
          border-top: 1px solid var(--hairline, rgba(31,29,24,0.08));
        }
        .section-title.danger { color: var(--secondary-dark, #9a3a3c); }
        .section-title.danger::before { background: var(--secondary-dark, #9a3a3c); }

        /* ---- Field styles ---- */
        .stack { display: flex; flex-direction: column; gap: 16px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field label {
          font-family: var(--font-ui-he, system-ui, sans-serif);
          font-size: 12px; font-weight: 600;
          color: var(--ink-3, #7c7562);
          display: flex; justify-content: space-between; align-items: baseline;
        }
        .field input, .field textarea {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 14.5px; color: var(--ink, #1f1d18);
          background: var(--surface-0, #faf7f2);
          border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
          border-radius: var(--r-sm, 8px);
          padding: 12px 14px; outline: none; width: 100%; box-sizing: border-box;
          transition: border-color var(--dur-1, 160ms), box-shadow var(--dur-1, 160ms);
        }
        .field input:focus, .field textarea:focus {
          border-color: var(--primary, #6a994e);
          box-shadow: 0 0 0 3px rgba(106,153,78,0.12);
        }
        .field input:read-only {
          opacity: 0.6; cursor: default;
        }
        .field input:read-only:focus { box-shadow: none; border-color: var(--hairline-strong, rgba(31,29,24,0.2)); }
        .field textarea { min-height: 80px; resize: vertical; line-height: 1.55; }
        .field .hint {
          font-family: var(--font-mono, monospace);
          font-size: 10.5px; color: var(--ink-3, #7c7562);
        }

        /* ---- Avatar grid ---- */
        .avatar-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 10px;
        }
        .avatar-pick {
          aspect-ratio: 1/1; border-radius: var(--r-md, 12px);
          border: 2px solid var(--hairline, rgba(31,29,24,0.08));
          background: var(--surface-2, #f2e8cf);
          cursor: pointer; position: relative; overflow: hidden;
          display: inline-flex; align-items: center; justify-content: center;
          transition: border-color var(--dur-1, 160ms), transform var(--dur-1, 160ms);
          padding: 0;
        }
        .avatar-pick:hover { transform: translateY(-2px); border-color: var(--primary-bright, #a7c957); }
        .avatar-pick.on { border-color: var(--primary-dark, #386641); box-shadow: 0 0 0 3px rgba(106,153,78,0.12); }
        .avatar-pick.on::after {
          content: "✓"; position: absolute; top: 2px; right: 4px;
          color: var(--primary-dark, #386641); font-weight: 600; font-size: 13px;
        }
        .avatar-pick img { width: 100%; height: 100%; object-fit: cover; }

        /* Skeleton loading */
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .avatar-pick.loading {
          background: linear-gradient(90deg, #e0e0e0 25%, #f5f5f5 50%, #e0e0e0 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
          cursor: wait;
          border-color: var(--hairline, rgba(31,29,24,0.08));
        }

        /* ---- Pref rows ---- */
        .pref {
          display: grid; grid-template-columns: 1fr auto;
          gap: 14px; align-items: center;
          padding: 14px 0;
        }
        .pref + .pref { border-top: 1px solid var(--hairline, rgba(31,29,24,0.08)); }
        .pref .t {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 14px; color: var(--ink, #1f1d18); margin: 0 0 2px;
        }
        .pref .d {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 12.5px; color: var(--ink-3, #7c7562); margin: 0;
        }

        /* ---- Buttons ---- */
        .btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 13.5px; font-weight: 500;
          padding: 10px 18px; border-radius: var(--r-sm, 8px);
          border: 1px solid transparent; cursor: pointer;
          transition: background var(--dur-1, 160ms), color var(--dur-1, 160ms), border-color var(--dur-1, 160ms);
        }
        .btn-primary { background: var(--primary, #6a994e); color: #fff; }
        .btn-primary:hover { background: var(--primary-dark, #386641); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-ghost {
          background: var(--surface-1, #fff); color: var(--ink, #1f1d18);
          border-color: var(--hairline-strong, rgba(31,29,24,0.2));
        }
        .btn-ghost:hover { background: var(--surface-2, #f2e8cf); }
        .btn-quiet {
          background: transparent; color: var(--ink-3, #7c7562);
          border-color: transparent;
        }
        .btn-quiet:hover {
          color: var(--secondary-dark, #9a3a3c);
          background: color-mix(in oklab, var(--secondary, #bc4749) 8%, transparent);
        }
        .btn-danger-ghost {
          background: transparent; color: var(--secondary-dark, #9a3a3c);
          border-color: color-mix(in oklab, var(--secondary, #bc4749) 30%, transparent);
        }
        .btn-danger-ghost:hover {
          background: color-mix(in oklab, var(--secondary, #bc4749) 8%, transparent);
        }

        /* ---- Footer ---- */
        .profile-foot {
          padding: 14px 40px;
          background: var(--surface-2, #f2e8cf);
          border-radius: var(--r-lg, 16px) var(--r-lg, 16px) var(--r-xl, 20px) var(--r-xl, 20px);
          display: flex; justify-content: space-between; align-items: center; gap: 12px;
        }

        /* ---- Inline error / success ---- */
        .feedback {
          font-family: var(--font-mono, monospace);
          font-size: 11px; padding: 10px 14px;
          border-radius: var(--r-sm, 8px); display: none;
        }
        .feedback.err {
          background: color-mix(in oklab, var(--secondary, #bc4749) 8%, white);
          color: var(--secondary-dark, #9a3a3c);
          border: 1px solid color-mix(in oklab, var(--secondary, #bc4749) 20%, white);
        }
        .feedback.ok {
          background: color-mix(in oklab, var(--primary, #6a994e) 8%, white);
          color: var(--primary-dark, #386641);
          border: 1px solid color-mix(in oklab, var(--primary, #6a994e) 20%, white);
        }
        .feedback.visible { display: block; }

        /* ---- Password-only / google-only notice ---- */
        .google-notice {
          font-family: var(--font-ui, system-ui, sans-serif);
          font-size: 13.5px; color: var(--ink-3, #7c7562);
          background: var(--surface-2, #f2e8cf);
          padding: 14px 16px; border-radius: var(--r-sm, 8px);
          border: 1px solid var(--hairline, rgba(31,29,24,0.08));
        }

        @media (max-width: 560px) {
          .profile-body { padding-left: 22px; padding-right: 22px; }
          .profile-foot { padding: 14px 22px; }
          .avatar-grid { grid-template-columns: repeat(4, 1fr); }
          .grid2 { grid-template-columns: 1fr; }
          .pref { grid-template-columns: 1fr; gap: 10px; }
          .pref button { justify-self: start; }
        }
      </style>

      <!-- Details panel -->
      <div class="profile-body" data-panel="details">
        <section class="section">
          <h4 class="section-title">עליי</h4>
          <div class="stack">
            <div class="grid2">
              <div class="field">
                <label>שם תצוגה</label>
                <input type="text" id="display-name" />
              </div>
              <div class="field">
                <label>כתובת מייל</label>
                <input type="email" id="profile-email" readonly />
              </div>
            </div>
            <div class="field">
              <label>קצת עליי</label>
              <textarea id="profile-bio"></textarea>
              <span class="hint">מוצג עם הצעות המתכון שלך. עד 160 תווים.</span>
            </div>
            <span class="feedback" id="details-feedback"></span>
          </div>
        </section>
      </div>

      <!-- Avatar panel -->
      <div class="profile-body" data-panel="avatar" hidden>
        <section class="section">
          <h4 class="section-title">בחר אווטאר</h4>
          <div class="avatar-grid" id="avatar-grid"></div>
          <span class="feedback" id="avatar-feedback" style="margin-top:12px;display:none;"></span>
          <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn btn-quiet" type="button" id="use-initials-btn">השתמש בראשי תיבות</button>
          </div>
        </section>
      </div>

      <!-- Security panel -->
      <div class="profile-body" data-panel="security" hidden>

        <section class="section">
          <h4 class="section-title">סיסמה</h4>
          <div id="pw-section"></div>
        </section>

        <section class="section">
          <h4 class="section-title">חשבונות מחוברים</h4>
          <div id="providers-section"></div>
        </section>

        <section class="section">
          <h4 class="section-title danger">אזור מסוכן</h4>
          <div class="pref">
            <div>
              <p class="t">מחיקת חשבון</p>
              <p class="d">המתכונים שהצעת יישארו בספר; המועדפים שסימנת לא ישמרו והחשבון יוסר.</p>
            </div>
            <button class="btn btn-danger-ghost" type="button" id="delete-account-btn">מחק חשבון</button>
          </div>
        </section>
      </div>

      <!-- Footer -->
      <div class="profile-foot">
        <button class="btn btn-quiet" type="button" id="signout-btn">התנתק</button>
        <button class="btn btn-primary" type="button" id="my-meal-btn">הארוחה שלי</button>
      </div>

      <!-- Confirmation modal for delete account -->
      <confirmation-modal id="delete-confirm"></confirmation-modal>
    `;
  }

  setupEventListeners() {
    this.shadowRoot.getElementById('my-meal-btn').addEventListener('click', () => {
      this.closest('auth-controller')?.closeModal();
      if (window.spa?.router) window.spa.router.navigate('/my-meal');
      else window.location.hash = '/my-meal';
    });
    this.shadowRoot
      .getElementById('signout-btn')
      .addEventListener('click', () => this._handleSignout());
    this.shadowRoot
      .getElementById('use-initials-btn')
      .addEventListener('click', () => this._useInitials());
    this.shadowRoot
      .getElementById('delete-account-btn')
      .addEventListener('click', () => this._confirmDeleteAccount());

    this.shadowRoot
      .getElementById('display-name')
      .addEventListener('blur', () => this._autoSaveDetails());
    this.shadowRoot
      .getElementById('profile-bio')
      .addEventListener('blur', () => this._autoSaveDetails());
  }

  showPanel(panelName) {
    this._activePanel = panelName;
    this.shadowRoot.querySelectorAll('[data-panel]').forEach((el) => {
      el.hidden = el.dataset.panel !== panelName;
    });

    if (panelName === 'details') this._populateDetails();
    if (panelName === 'avatar') this._loadAvatars();
    if (panelName === 'security') this._populateSecurity();
  }

  resetState() {
    this._populateDetails();
    const avatarUrl = authService.getCurrentAvatarUrl();
    if (avatarUrl) this.selectedAvatarUrl = avatarUrl;
  }

  // ---- Details panel ----

  _populateDetails() {
    const user = authService.getCurrentUser();
    if (!user) return;

    const nameEl = this.shadowRoot.getElementById('display-name');
    const emailEl = this.shadowRoot.getElementById('profile-email');
    const bioEl = this.shadowRoot.getElementById('profile-bio');

    if (nameEl) nameEl.value = user.displayName || '';
    if (emailEl) emailEl.value = user.email || '';
    if (bioEl) bioEl.value = authService._userData?.bio || '';
  }

  async _autoSaveDetails() {
    const displayName = this.shadowRoot.getElementById('display-name')?.value.trim();
    const bio = this.shadowRoot.getElementById('profile-bio')?.value.trim();
    const updates = {};
    if (displayName) updates.displayName = displayName;
    updates.bio = bio ?? '';
    if (Object.keys(updates).length === 0) return;
    try {
      await authService.updateProfile(updates);
      this._flashFeedback('details-feedback', 'ok', '✓ נשמר');
    } catch (error) {
      this._showFeedback('details-feedback', 'err', error.message || 'השמירה נכשלה. נסה שנית.');
    }
  }

  // ---- Avatar panel ----

  async _loadAvatars() {
    const grid = this.shadowRoot.getElementById('avatar-grid');

    try {
      grid.innerHTML = '';
      for (let i = 0; i < 6; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'avatar-pick loading';
        grid.appendChild(btn);
      }

      if (!avatarCache) {
        avatarCache = await UserService.listAvatarOptions();
      }

      const results = await Promise.all(
        avatarCache.map(
          (url) =>
            new Promise((resolve) => {
              const img = new Image();
              img.src = url;
              img.onload = () => resolve({ ok: true, url, img });
              img.onerror = () => resolve({ ok: false, url });
            }),
        ),
      );

      grid.innerHTML = '';
      results.forEach((r) => {
        if (!r.ok) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'avatar-pick';
        btn.dataset.url = r.url;
        r.img.alt = 'Avatar option';
        btn.appendChild(r.img);
        if (this.selectedAvatarUrl === r.url) btn.classList.add('on');
        btn.addEventListener('click', () => this._selectAvatar(btn, r.url));
        grid.appendChild(btn);
      });
    } catch (error) {
      console.error('Error loading avatars:', error);
      this._showFeedback('avatar-feedback', 'err', 'טעינת האווטארים נכשלה. נסה שנית.');
    }
  }

  async _selectAvatar(btn, url) {
    this.shadowRoot.querySelectorAll('.avatar-pick').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    this.selectedAvatarUrl = url;
    try {
      await authService.updateProfile({ avatarUrl: url });
      this._flashFeedback('avatar-feedback', 'ok', '✓ נשמר');
    } catch (error) {
      this._showFeedback('avatar-feedback', 'err', error.message || 'השמירה נכשלה. נסה שנית.');
    }
  }

  async _useInitials() {
    const btn = this.shadowRoot.getElementById('use-initials-btn');
    btn.disabled = true;
    try {
      await authService.updateProfile({ avatarUrl: null });
      this.selectedAvatarUrl = null;
      this.shadowRoot.querySelectorAll('.avatar-pick').forEach((b) => b.classList.remove('on'));
      this._showFeedback('avatar-feedback', 'ok', 'ראשי תיבות מוצגים כעת כאווטאר שלך.');
    } catch (error) {
      this._showFeedback('avatar-feedback', 'err', error.message || 'הפעולה נכשלה. נסה שנית.');
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Security panel ----

  _populateSecurity() {
    this._renderPasswordSection();
    this._renderProviders();
  }

  _renderPasswordSection() {
    const container = this.shadowRoot.getElementById('pw-section');
    const user = authService.getCurrentUser();
    const hasPassword = user?.providerData?.some((p) => p.providerId === 'password');

    if (!hasPassword) {
      container.innerHTML = `
        <p class="google-notice">
          החשבון שלך משתמש ב-Google Sign-In — אימות בסיסמה אינו מופעל.
        </p>
      `;
      return;
    }

    container.innerHTML = `
      <div class="stack">
        <div class="field">
          <label>סיסמה נוכחית</label>
          <input type="password" id="current-pw" placeholder="••••••••" />
        </div>
        <div class="grid2">
          <div class="field">
            <label>סיסמה חדשה</label>
            <input type="password" id="new-pw" />
          </div>
          <div class="field">
            <label>אימות</label>
            <input type="password" id="confirm-pw" />
          </div>
        </div>
        <span class="feedback" id="pw-feedback"></span>
        <button class="btn btn-ghost" type="button" id="update-pw-btn" style="width:auto;align-self:flex-start;">
          עדכן סיסמה
        </button>
      </div>
    `;

    this.shadowRoot
      .getElementById('update-pw-btn')
      .addEventListener('click', () => this._handlePasswordUpdate());
  }

  async _handlePasswordUpdate() {
    const current = this.shadowRoot.getElementById('current-pw').value;
    const newPw = this.shadowRoot.getElementById('new-pw').value;
    const confirm = this.shadowRoot.getElementById('confirm-pw').value;

    if (!current || !newPw || !confirm) {
      this._showFeedback('pw-feedback', 'err', 'יש למלא את כל שדות הסיסמה.');
      return;
    }
    if (newPw !== confirm) {
      this._showFeedback('pw-feedback', 'err', 'הסיסמאות החדשות אינן תואמות.');
      return;
    }

    const btn = this.shadowRoot.getElementById('update-pw-btn');
    btn.disabled = true;
    btn.textContent = 'מעדכן...';

    try {
      const authController = this.closest('auth-controller');
      await authController.updatePassword(current, newPw);
      this._showFeedback('pw-feedback', 'ok', 'הסיסמה עודכנה בהצלחה.');
      this.shadowRoot.getElementById('current-pw').value = '';
      this.shadowRoot.getElementById('new-pw').value = '';
      this.shadowRoot.getElementById('confirm-pw').value = '';
    } catch (error) {
      const msg =
        error.code === 'auth/wrong-password'
          ? 'הסיסמה הנוכחית שגויה.'
          : error.message || 'עדכון הסיסמה נכשל.';
      this._showFeedback('pw-feedback', 'err', msg);
    } finally {
      btn.disabled = false;
      btn.textContent = 'עדכן סיסמה';
    }
  }

  _renderProviders() {
    const container = this.shadowRoot.getElementById('providers-section');
    const user = authService.getCurrentUser();
    const providers = user?.providerData || [];

    const googleLinked = providers.some((p) => p.providerId === 'google.com');
    const googleEmail = providers.find((p) => p.providerId === 'google.com')?.email || '';
    const isOnlyProvider = googleLinked && providers.length === 1;

    container.innerHTML = `
      <div class="pref" id="google-pref">
        <div>
          <p class="t">Google${googleEmail ? ` · ${googleEmail}` : ''}</p>
          <p class="d">${
            googleLinked
              ? isOnlyProvider
                ? 'לא ניתן לנתק — אין שיטת כניסה נוספת'
                : 'מחובר'
              : 'לא מחובר'
          }</p>
        </div>
        ${
          isOnlyProvider
            ? ''
            : `<button class="btn ${googleLinked ? 'btn-quiet' : 'btn-ghost'}" type="button" id="google-link-btn" style="width:auto;">
              ${googleLinked ? 'נתק' : 'חבר'}
            </button>`
        }
      </div>
      <span class="feedback" id="providers-feedback"></span>
    `;

    this.shadowRoot.getElementById('google-link-btn')?.addEventListener('click', async () => {
      const btn = this.shadowRoot.getElementById('google-link-btn');
      btn.disabled = true;
      try {
        const authController = this.closest('auth-controller');
        if (googleLinked) {
          await authController.unlinkProvider('google.com');
        } else {
          await authController.linkWithGoogle();
        }
        this._renderProviders();
        this._showFeedback(
          'providers-feedback',
          'ok',
          googleLinked ? 'חשבון Google נותק.' : 'חשבון Google חובר.',
        );
      } catch (error) {
        this._showFeedback('providers-feedback', 'err', error.message || 'הפעולה נכשלה. נסה שנית.');
        btn.disabled = false;
      }
    });
  }

  // ---- Delete account ----

  _confirmDeleteAccount() {
    const confirmModal = this.shadowRoot.getElementById('delete-confirm');
    confirmModal.confirm(
      'למחוק את החשבון שלך?',
      'המתכונים שהצעת יישארו בספר. החשבון, המתכונים המועדפים שלך יוסרו לצמיתות.',
      'מחק חשבון',
      'שמור את חשבוני',
    );
    confirmModal.addEventListener('confirm-approved', () => this._handleDeleteAccount(), {
      once: true,
    });
  }

  async _handleDeleteAccount() {
    const btn = this.shadowRoot.getElementById('delete-account-btn');
    btn.disabled = true;
    try {
      const authController = this.closest('auth-controller');
      await authController.handleDeleteAccount();
    } catch (error) {
      btn.disabled = false;
      console.error('Delete account error:', error);
    }
  }

  // ---- Sign out ----

  async _handleSignout() {
    const btn = this.shadowRoot.getElementById('signout-btn');
    btn.disabled = true;
    btn.textContent = 'מתנתק...';
    try {
      const authController = this.closest('auth-controller');
      await authController.handleLogout();
      this.closest('auth-content')?.showAuthForms();
      authController.closeModal();
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      btn.disabled = false;
      btn.textContent = 'התנתק';
    }
  }

  // ---- Helpers ----

  _showFeedback(id, type, msg) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = `feedback ${type} visible`;
  }

  _flashFeedback(id, type, msg) {
    this._showFeedback(id, type, msg);
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      const el = this.shadowRoot.getElementById(id);
      if (el) el.className = 'feedback';
    }, 2000);
  }

  reset() {}
}

customElements.define('user-profile', UserProfile);
