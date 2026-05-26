import { CookingMemoryGame } from './memory_game.js';
import { BurgerStackerGame } from './burger_stacker.js';
import wrapperCss from './game_wrapper.css?inline';
import memoryCss from './memory_game.css?inline';
import burgerCss from './burger_stacker.css?inline';

export const GAME_STYLES = `${wrapperCss}\n${memoryCss}\n${burgerCss}`;

const REGISTRY = [
  {
    GameClass: CookingMemoryGame,
    defaultConfig: { rows: 3 },
    successMessage: 'כל הכבוד! הזיכרון שלך חד!',
    loadingText: 'זה עשוי לקחת מספר שניות... הנה משחק קטן בינתיים!',
  },
  {
    GameClass: BurgerStackerGame,
    defaultConfig: { targetHeight: 5 },
    successMessage: 'כל הכבוד! הבורגר מוכן!',
    loadingText: 'מכין את המטבח... תפוס את המרכיבים!',
  },
];

export class GameWrapper {
  static random(container, overrides = {}) {
    const pick = REGISTRY[Math.floor(Math.random() * REGISTRY.length)];
    const wrapper = new GameWrapper(container, pick.GameClass, {
      ...pick.defaultConfig,
      ...overrides,
      successMessage: pick.successMessage,
    });
    return { wrapper, loadingText: pick.loadingText };
  }

  constructor(container, GameClass, config = {}) {
    this.container = container;
    this.GameClass = GameClass;
    this.config = config;
    this.game = null;
    this.startTime = null;
    this.timerInterval = null;
    this.hasStarted = false;
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

    this.game.start();
  }

  renderWrapper() {
    this.container.innerHTML = `
      <div class="game-wrapper">
        <div class="game-header">
          <div class="timer">⏱️ <span id="game-timer">00:00</span></div>
        </div>
        <div class="game-content"></div>
        
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

    const btn = this.container.querySelector('.overlay-btn');
    if (btn) btn.onclick = () => this.restart();
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
