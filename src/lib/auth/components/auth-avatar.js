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
          transition: box-shadow var(--dur-1, 160ms) var(--ease, ease),
                      transform var(--dur-1, 160ms) var(--ease, ease);
        }

        .avatar:hover {
          transform: scale(1.08);
          box-shadow: 0 0 0 3px rgba(106,153,78,0.3), 0 2px 8px rgba(31,29,24,0.15);
        }

        .avatar:active {
          transform: scale(0.93);
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

    if (user) {
      avatar.classList.remove('signed-out');

      // Use centralized avatar URL from auth service
      const avatarUrl = authService.getCurrentAvatarUrl();

      if (avatarUrl) {
        avatar.innerHTML = `<img src="${avatarUrl}" alt="User Avatar">`;
      } else {
        avatar.innerHTML = `<div class="initial">${user.email[0].toUpperCase()}</div>`;
      }
    } else {
      avatar.classList.add('signed-out');
      avatar.innerHTML = icons.user;
    }
  }

  handleClick() {
    const user = authService.getCurrentUser();
    const authController = document.querySelector('auth-controller');
    const authContent = document.querySelector('auth-content');

    if (!authController || !authContent) {
      console.error('Required components not found');
      return;
    }

    if (user) {
      // Show profile for logged in user
      authContent.showUserProfile();
    } else {
      // Show login form for non-authenticated user
      authContent.showAuthForms();
    }

    authController.openModal(this.shadowRoot.getElementById('auth-trigger'));
  }
}

customElements.define('auth-avatar', AuthAvatar);
