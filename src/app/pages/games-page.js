import { AppConfig } from '../../js/config/app-config.js';
import '../../styles/pages/games-spa.css';
import '../../lib/games/game_wrapper.css';
import '../../lib/games/memory_game.css';
import '../../lib/games/burger_stacker.css';

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
    const container = document.getElementById('games-page-container');
    if (!container) return;

    this._wrapper = GameWrapper.random(container);
    this._wrapper.init();
  },

  async unmount() {
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
      description: 'A small fun corner — play a quick mini-game.',
    };
  },
};
