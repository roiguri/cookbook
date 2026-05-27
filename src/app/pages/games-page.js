import { AppConfig } from '../../js/config/app-config.js';
import '../../styles/pages/games-spa.css';
import '../../lib/games/game_wrapper.css';
import '../../lib/games/memory_game.css';
import '../../lib/games/burger_stacker.css';
import '../../lib/games/knife_skills.css';
import '../../lib/utilities/modal/modal.js';

// Phone-sized viewport — matches the modal's fullscreen-mobile activation.
// Includes both portrait (narrow width) and landscape (short height) so a
// landscape phone still goes through the modal path instead of falling back
// to the desktop inline view.
const MOBILE_QUERY = '(max-width: 768px), (max-height: 500px)';

export default {
  async render() {
    const response = await fetch(new URL('./games-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(`Failed to load games page template: ${response.status}`);
    }
    return await response.text();
  },

  async mount() {
    const { GameWrapper } = await import('../../lib/games/game_wrapper.js');
    this._GameWrapper = GameWrapper;

    const chooser = document.getElementById('games-page-chooser');
    const gameView = document.getElementById('games-page-game-view');
    const backBtn = document.getElementById('games-page-back');
    if (!chooser || !gameView || !backBtn) return;

    this._chooser = chooser;
    this._gameView = gameView;

    chooser.innerHTML = GameWrapper.list()
      .map(
        (g, i) => `
          <button class="games-page-card" type="button" data-game-key="${g.key}" style="--card-i: ${i};">
            <span class="games-page-card-icon" aria-hidden="true">${g.icon}</span>
            <span class="games-page-card-name">${g.name}</span>
            <span class="games-page-card-desc">${g.description}</span>
          </button>
        `,
      )
      .join('');

    this._onChooserClick = (event) => {
      const card = event.target.closest('.games-page-card');
      if (!card) return;
      this._startGame(card.dataset.gameKey);
    };
    chooser.addEventListener('click', this._onChooserClick);

    this._onBackClick = () => this._returnToChooser();
    backBtn.addEventListener('click', this._onBackClick);

    // Modal lifecycle: on mobile we host the game inside <custom-modal>.
    // modal-closed (X / Escape / backdrop click) tears down the active game.
    this._modal = document.getElementById('games-page-modal');
    if (this._modal) {
      this._onModalClosed = () => this._destroyWrapper();
      this._modal.addEventListener('modal-closed', this._onModalClosed);
    }
  },

  async unmount() {
    this._destroyWrapper();
    if (this._chooser && this._onChooserClick) {
      this._chooser.removeEventListener('click', this._onChooserClick);
    }
    const backBtn = document.getElementById('games-page-back');
    if (backBtn && this._onBackClick) {
      backBtn.removeEventListener('click', this._onBackClick);
    }
    if (this._modal && this._onModalClosed) {
      this._modal.removeEventListener('modal-closed', this._onModalClosed);
    }
    this._chooser = null;
    this._gameView = null;
    this._modal = null;
    this._GameWrapper = null;
  },

  _isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  },

  _startGame(key) {
    if (!this._GameWrapper) return;
    this._destroyWrapper();

    if (this._isMobile() && this._modal) {
      const container = document.getElementById('games-page-modal-container');
      if (!container) return;
      this._wrapper = this._GameWrapper.create(key, container);
      this._wrapper.init();
      this._modal.open();
    } else {
      const container = document.getElementById('games-page-container');
      if (!container) return;
      this._chooser.hidden = true;
      this._gameView.hidden = false;
      this._wrapper = this._GameWrapper.create(key, container);
      this._wrapper.init();
    }
  },

  _returnToChooser() {
    this._destroyWrapper();
    this._gameView.hidden = true;
    this._chooser.hidden = false;
  },

  _destroyWrapper() {
    if (this._wrapper) {
      this._wrapper.destroy();
      this._wrapper = null;
    }
  },

  getTitle() {
    return AppConfig.getPageTitle('Mini Games');
  },

  getMeta() {
    return {
      description: 'A small fun corner — pick a quick mini-game.',
    };
  },
};
