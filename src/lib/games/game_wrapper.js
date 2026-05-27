import { CookingMemoryGame } from './memory_game.js';
import { BurgerStackerGame } from './burger_stacker.js';
import { PizzatronGame } from './pizzatron.js';
import wrapperCss from './game_wrapper.css?inline';
import memoryCss from './memory_game.css?inline';
import burgerCss from './burger_stacker.css?inline';
import pizzatronCss from './pizzatron.css?inline';

export const GAME_STYLES = `${wrapperCss}\n${memoryCss}\n${burgerCss}\n${pizzatronCss}`;

const REGISTRY = [
  {
    key: 'memory',
    name: 'משחק זיכרון',
    icon: '🧠',
    description: 'מצאו את הזוגות',
    GameClass: CookingMemoryGame,
    defaultConfig: { rows: 3 },
    successMessage: 'כל הכבוד! הזיכרון שלך חד!',
    loadingText: 'זה עשוי לקחת מספר שניות... הנה משחק קטן בינתיים!',
  },
  {
    key: 'burger',
    name: 'מגדל ההמבורגר',
    icon: '🍔',
    description: 'תפסו את המרכיבים והרכיבו המבורגר',
    GameClass: BurgerStackerGame,
    defaultConfig: { targetHeight: 5 },
    successMessage: 'כל הכבוד! ההמבוגר מוכן',
    loadingText: 'מכין את המטבח... תפוס את המרכיבים!',
  },
  {
    key: 'pizza',
    name: 'הפיצריה',
    icon: '🍕',
    description: 'הרכיבו פיצות לפי ההזמנה',
    GameClass: PizzatronGame,
    defaultConfig: { ordersToWin: 10 },
    successMessage: 'כל הכבוד! משלוחים הושלמו',
    loadingText: 'מחממים את התנור... תפסו הזמנות בינתיים!',
    // Excluded from GameWrapper.random() so it never shows as a filler
    // during async waits in other modals — it's an explicit-choice game
    // and only meant to be launched from /games.
    excludeFromRandom: true,
    // When set, the wrapper shows a rotation prompt on portrait phones
    // (with a "המשך בכל זאת" escape hatch). Pizzatron's belt is inherently
    // horizontal so portrait makes it nearly unplayable.
    requiresLandscape: true,
  },
];

export class GameWrapper {
  static list() {
    return REGISTRY.map(({ key, name, icon, description }) => ({
      key,
      name,
      icon,
      description,
    }));
  }

  static create(key, container, overrides = {}) {
    const pick = REGISTRY.find((g) => g.key === key);
    if (!pick) throw new Error(`Unknown game key: ${key}`);
    return new GameWrapper(container, pick.GameClass, {
      ...pick.defaultConfig,
      ...overrides,
      successMessage: pick.successMessage,
      loadingText: pick.loadingText,
      requiresLandscape: !!pick.requiresLandscape,
    });
  }

  static random(container, overrides = {}) {
    const pool = REGISTRY.filter((g) => !g.excludeFromRandom);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return GameWrapper.create(pick.key, container, overrides);
  }

  constructor(container, GameClass, config = {}) {
    this.container = container;
    this.GameClass = GameClass;
    this.config = config;
    this.game = null;
    this.startTime = null;
    this.timerInterval = null;
    this.hasStarted = false;
    this._asyncReadyShown = false;
    this._mqlPortrait = null;
    this._rotationDismissed = false;
    this._onOrientationChange = () => this._evaluateRotationPrompt();
  }

  init() {
    this.renderWrapper();
    const gameContainer = this.container.querySelector('.game-content');

    this.game = new this.GameClass(gameContainer, {
      ...this.config,
      onInteraction: () => this.startTimer(),
      onComplete: () => this.onGameComplete(),
      onGameOver: (reason) => this.onGameOver(reason),
    });

    if (this._asyncReadyShown) this._applyAsyncReady();

    this.game.start();

    if (this.config.requiresLandscape) {
      this._setupRotationPrompt();
    }
  }

  renderWrapper() {
    const { asyncReady, loadingText } = this.config;
    const statusBlock = asyncReady
      ? `
        <div class="game-status">
          <div class="game-status-loading">
            <div class="game-loading-dots">
              <div class="game-loading-dot"></div>
              <div class="game-loading-dot"></div>
              <div class="game-loading-dot"></div>
            </div>
            <span class="game-loading-text"></span>
          </div>
          <div class="game-status-ready" hidden>
            <span class="game-ready-icon">✨</span>
            <span class="game-ready-text"></span>
            <button class="game-ready-btn"></button>
          </div>
        </div>
      `
      : '';

    const rotateBlock = this.config.requiresLandscape
      ? `
        <div class="game-rotate-prompt" hidden role="dialog" aria-modal="true" aria-labelledby="game-rotate-title">
          <div class="game-rotate-content">
            <div class="game-rotate-icon" aria-hidden="true">📱</div>
            <h3 id="game-rotate-title">סובב את המסך לרוחב</h3>
            <p>המשחק עוצב למצב אופקי. סובב את המכשיר לרוחב כדי להמשיך.</p>
            <button class="game-rotate-skip" type="button">המשך בכל זאת</button>
          </div>
        </div>
      `
      : '';

    this.container.innerHTML = `
      <div class="game-wrapper">
        ${statusBlock}
        <div class="game-header">
          <div class="timer">⏱️ <span id="game-timer">00:00</span></div>
        </div>
        <div class="game-content"></div>

        ${rotateBlock}

        <div class="game-overlay" style="display: none;">
          <div class="overlay-content">
            <div class="overlay-icon">🏆</div>
            <h3 id="overlay-title"></h3>
            <p id="overlay-msg"></p>
            <div class="final-time" style="display:none;">00:00</div>
            <button class="overlay-btn">שחק שוב</button>
          </div>
        </div>
      </div>
    `;

    if (asyncReady) {
      const loadingTextEl = this.container.querySelector('.game-loading-text');
      const readyTextEl = this.container.querySelector('.game-ready-text');
      const readyBtnEl = this.container.querySelector('.game-ready-btn');
      if (loadingTextEl) loadingTextEl.textContent = loadingText || '';
      if (readyTextEl) readyTextEl.textContent = asyncReady.text || '';
      if (readyBtnEl) {
        readyBtnEl.textContent = asyncReady.button || '';
        if (typeof asyncReady.onDismiss === 'function') {
          readyBtnEl.onclick = () => asyncReady.onDismiss();
        }
      }
    }

    const btn = this.container.querySelector('.overlay-btn');
    if (btn) btn.onclick = () => this.restart();
  }

  _setupRotationPrompt() {
    const promptEl = this.container.querySelector('.game-rotate-prompt');
    if (!promptEl) return;
    const skipBtn = promptEl.querySelector('.game-rotate-skip');
    if (skipBtn) {
      skipBtn.onclick = () => {
        this._rotationDismissed = true;
        this._evaluateRotationPrompt();
      };
    }
    this._mqlPortrait = window.matchMedia('(orientation: portrait) and (max-width: 768px)');
    if (this._mqlPortrait.addEventListener) {
      this._mqlPortrait.addEventListener('change', this._onOrientationChange);
    } else if (this._mqlPortrait.addListener) {
      // Safari < 14 fallback
      this._mqlPortrait.addListener(this._onOrientationChange);
    }
    this._evaluateRotationPrompt();
  }

  _evaluateRotationPrompt() {
    const promptEl = this.container.querySelector('.game-rotate-prompt');
    if (!promptEl || !this._mqlPortrait) return;
    const shouldShow = this._mqlPortrait.matches && !this._rotationDismissed;
    promptEl.hidden = !shouldShow;
  }

  markAsyncReady() {
    this._asyncReadyShown = true;
    this._applyAsyncReady();
  }

  _applyAsyncReady() {
    const loadingRow = this.container.querySelector('.game-status-loading');
    const readyRow = this.container.querySelector('.game-status-ready');
    if (loadingRow) loadingRow.hidden = true;
    if (readyRow) readyRow.hidden = false;
  }

  startTimer() {
    if (this.hasStarted) return;
    this.hasStarted = true;
    this.startTime = Date.now();

    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      this.updateTimerDisplay(elapsed);
    }, 1000);
  }

  updateTimerDisplay(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    const timeString = `${minutes}:${seconds}`;

    const timerDisplay = this.container.querySelector('#game-timer');
    if (timerDisplay) timerDisplay.textContent = timeString;
    return timeString;
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  onGameComplete() {
    this.stopTimer();

    const elapsed = Date.now() - this.startTime;
    const finalTimeString = this.updateTimerDisplay(elapsed);

    this.showOverlay({
      icon: '🏆',
      title: this.config.successMessage || 'כל הכבוד!',
      message: 'סיימת את המשחק בזמן:',
      time: finalTimeString,
      isSuccess: true,
    });
  }

  onGameOver(reason) {
    this.stopTimer();

    this.showOverlay({
      icon: '😕',
      title: 'אוי לא!',
      message: reason || 'המשחק נגמר',
      isSuccess: false,
    });
  }

  showOverlay({ icon, title, message, time, isSuccess }) {
    const overlay = this.container.querySelector('.game-overlay');
    const content = this.container.querySelector('.overlay-content');

    this.container.querySelector('.overlay-icon').textContent = icon;
    this.container.querySelector('#overlay-title').textContent = title;
    this.container.querySelector('#overlay-msg').textContent = message;

    const timeDisplay = this.container.querySelector('.final-time');
    if (time && isSuccess) {
      timeDisplay.textContent = time;
      timeDisplay.style.display = 'block';
    } else {
      timeDisplay.style.display = 'none';
    }

    content.classList.remove('success-theme', 'failure-theme');
    content.classList.add(isSuccess ? 'success-theme' : 'failure-theme');

    if (overlay) {
      overlay.style.display = 'flex';
      setTimeout(() => overlay.classList.add('show'), 10);
    }
  }

  destroy() {
    this.stopTimer();
    if (this._mqlPortrait) {
      if (this._mqlPortrait.removeEventListener) {
        this._mqlPortrait.removeEventListener('change', this._onOrientationChange);
      } else if (this._mqlPortrait.removeListener) {
        this._mqlPortrait.removeListener(this._onOrientationChange);
      }
      this._mqlPortrait = null;
    }
    if (this.game && typeof this.game.destroy === 'function') {
      this.game.destroy();
    }
    this.container.innerHTML = '';
    this.hasStarted = false;
    this.game = null;
  }

  restart() {
    const overlay = this.container.querySelector('.game-overlay');
    if (overlay) {
      overlay.classList.remove('show');
      setTimeout(() => {
        overlay.style.display = 'none';
        this.destroy(); // Properly clean up
        this.init(); // Start fresh
      }, 300);
    } else {
      this.destroy();
      this.init();
    }
  }
}
