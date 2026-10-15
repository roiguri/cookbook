/**
 * AuthAvatar Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * Header avatar component that serves as the main entry point for authentication
 */

import { icons } from '../../../js/icons.js';
import authService from '../../../js/services/auth/auth-service.js';
import { isBuiltAvatarUrl } from '../../../js/utils/avatar/avatar-url.js';
import './auth-content.js';

class AuthAvatar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.initializeAuthListener();
  }

  render() {
    this._shownKey = 'signed-out'; // what the markup below shows
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 36px;
          height: 36px;
        }

        .avatar {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          overflow: hidden;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, var(--primary-bright), var(--primary-dark));
          color: #ffffff;
          box-sizing: border-box;
          /* Same edge as the header search bar beside it. */
          border: 1px solid var(--hairline, rgba(31,29,24,0.1));
          transition: box-shadow var(--dur-1, 160ms) var(--ease, ease),
                      transform var(--dur-1, 160ms) var(--ease, ease);
        }

        .avatar:hover {
          transform: scale(1.08);
          box-shadow: 0 0 0 3px rgba(106,153,78,0.3), 0 2px 8px rgba(31,29,24,0.15);
        }

        .avatar:active {
          transform: scale(var(--press-scale-icon, 0.9));
          box-shadow: 0 0 0 2px rgba(106,153,78,0.4);
          transition-duration: 80ms;
        }

        .avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transform: scale(1.12) translateY(4%);
        }

        /* A built avatar fills its square: no zoom, and no gradient bleeding at the edge. */
        .avatar.built { background: var(--surface-1, #fff); }
        .avatar.built img { transform: none; }

        .initial {
          font-family: var(--font-ui, sans-serif);
          font-weight: 600;
          font-size: 13px;
          color: #ffffff;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
        }

        .avatar.signed-out svg {
          width: 24px;
          height: 24px;
        }

        /* Changing avatar (sign in/out, new picture): the current content stays until the new
           one is ready (pending: a soft pulsing ring), then the new one fades in. */
        .avatar.pending { animation: pending 1.1s var(--ease, ease) infinite; }
        @keyframes pending {
          0%, 100% { box-shadow: 0 0 0 0 rgba(106,153,78,0.45); }
          50% { box-shadow: 0 0 0 4px rgba(106,153,78,0.18); }
        }
        .avatar.fade-in > * { animation: fade-in var(--dur-2, 280ms) var(--ease-out, ease-out); }
        @keyframes fade-in {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .avatar.pending, .avatar.fade-in > * { animation: none; }
        }

        .avatar.loading {
          opacity: 0.7;
          pointer-events: none;
          cursor: wait;
        }

        .avatar.loading::after {
          content: '';
          position: absolute;
          width: 18px;
          height: 18px;
          border: 2px solid white;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      
      <div class="avatar signed-out" id="auth-trigger">
        ${icons.user}
      </div>
    `;
  }

  setupEventListeners() {
    const trigger = this.shadowRoot.getElementById('auth-trigger');
    trigger.addEventListener('click', () => this.handleClick());

    // Listen for signup success to show profile
    document.addEventListener('signup-success', () => {
      const authContent = document.querySelector('auth-content');
      if (authContent) {
        authContent.showUserProfile();
      }
    });

    // Add listener for profile updates
    document.addEventListener('profile-updated', () => {
      const user = authService.getCurrentUser();
      if (user) {
        this.updateAvatar(user);
      }
    });
  }

  initializeAuthListener() {
    authService.addAuthObserver((state) => {
      this.updateAvatar(state.user);
    });
  }

  updateAvatar(user) {
    const avatar = this.shadowRoot.getElementById('auth-trigger');
    // Use centralized avatar URL from auth service
    const avatarUrl = user ? authService.getCurrentAvatarUrl() : null;
    // What should show, as a key: skip updates that wouldn't change it (no needless fades).
    const key = !user ? 'signed-out' : avatarUrl ? `img:${avatarUrl}` : `initial:${user.email[0]}`;
    if (key === this._shownKey && !this._pendingKey) return;
    if (key === this._pendingKey) return; // already loading this picture
    const update = (this._avatarUpdate = (this._avatarUpdate || 0) + 1);
    this._pendingKey = null;

    // Swap to the new content. 'built' (white background) is set here too, never ahead of the
    // swap and never left over: it would hide the white signed-out icon or initial.
    const show = (content, { signedOut = false, built = false, shownKey = key } = {}) => {
      if (update !== this._avatarUpdate) return; // a newer update has taken over
      this._pendingKey = null;
      this._shownKey = shownKey;
      avatar.classList.remove('pending');
      avatar.classList.toggle('signed-out', signedOut);
      avatar.classList.toggle('built', built);
      if (typeof content === 'string') avatar.innerHTML = content;
      else avatar.replaceChildren(content);
      avatar.classList.remove('fade-in');
      void avatar.offsetWidth; // restart the fade
      avatar.classList.add('fade-in');
    };
    const initial = () => `<div class="initial">${user.email[0].toUpperCase()}</div>`;

    if (!user) return show(icons.user, { signedOut: true });
    if (!avatarUrl) return show(initial());

    // Keep what's showing until the new picture has loaded: no empty circle in between.
    const img = new Image();
    img.alt = 'User Avatar';
    img.src = avatarUrl;
    const ready = () => show(img, { built: isBuiltAvatarUrl(avatarUrl) });
    if (img.complete && img.naturalWidth) return ready();
    this._pendingKey = key;
    avatar.classList.add('pending');
    const loaded = img.decode
      ? img.decode()
      : new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
    loaded.then(ready, () => show(initial(), { shownKey: `initial:${user.email[0]}` }));
  }

  async handleClick() {
    const authController = document.querySelector('auth-controller');
    const authContent = document.querySelector('auth-content');

    if (!authController || !authContent) {
      console.error('Required components not found');
      return;
    }

    // Ensure slot components (especially <user-profile>) are upgraded before
    // we toggle .active on them or call methods like showPanel(). Otherwise
    // the slot may render visible but empty — only the profile head/tabs
    // show, with no form fields underneath.
    await authController.loadAuthComponents();

    const user = authService.getCurrentUser();
    if (user) {
      authContent.showUserProfile();
    } else {
      authContent.showAuthForms();
    }

    authController.openModal(this.shadowRoot.getElementById('auth-trigger'));
  }
}

customElements.define('auth-avatar', AuthAvatar);
