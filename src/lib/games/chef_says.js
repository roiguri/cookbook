import styles from './chef_says.css?inline';
import { START_OVERLAY_STYLES, showStartOverlay } from './game_start_overlay.js';

// Simon-style memory game: the chef plays a sequence of ingredients, the
// player repeats it. Every round adds one ingredient. One wrong tap ends the
// run; repeating `roundsToWin` sequences wins.

// Pad order is DOM order (the grid is RTL, so index 0 sits top-right).
const INGREDIENTS = [
  { key: 'tomato', emoji: '🍅', he: 'עגבנייה' },
  { key: 'cheese', emoji: '🧀', he: 'גבינה' },
  { key: 'carrot', emoji: '🥕', he: 'גזר' },
  { key: 'broccoli', emoji: '🥦', he: 'ברוקולי' },
];

const TUNING = {
  win: { roundsToWin: 7 },
  playback: {
    // Each ingredient lights for onMs, then waits gapMs. onMs shrinks a bit
    // every round so later sequences feel quicker.
    firstDelayMs: 600,
    baseOnMs: 560,
    onDecreasePerRoundMs: 30,
    minOnMs: 300,
    gapMs: 200,
  },
  input: { flashMs: 200 },
  pacing: {
    nextRoundDelayMs: 800,
    failRevealMs: 700, // how long the correct pad glows before game over
    winDelayMs: 400,
  },
};

// Module-level: the start card is an onboarding cue. It shows on each fresh
// entry from the chooser (GameWrapper.create → resetSession) but not on
// "שחק שוב" restarts.
let chefSaysIntroPending = true;

export class ChefSaysGame {
  static resetSession() {
    chefSaysIntroPending = true;
  }

  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        roundsToWin: TUNING.win.roundsToWin,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      sequence: [],
      inputIndex: 0,
      phase: 'idle', // idle | showing | input | over
    };

    this.boardEl = null;
    this.padEls = [];
    this.roundEl = null;
    this.statusEl = null;
    this.removeStartOverlay = null;
    this.timeouts = new Set();
    this.firstInteractionFired = false;

    this._onBoardClick = this.onBoardClick.bind(this);
  }

  start() {
    this.render();
    this.boardEl = this.container.querySelector('.chef-board');
    this.padEls = Array.from(this.container.querySelectorAll('.chef-pad'));
    this.roundEl = this.container.querySelector('#chef-round');
    this.statusEl = this.container.querySelector('.chef-status');
    this.boardEl.addEventListener('click', this._onBoardClick);

    if (chefSaysIntroPending) {
      chefSaysIntroPending = false;
      this.removeStartOverlay = showStartOverlay(this.container.querySelector('.chef-game'), {
        emoji: '👨‍🍳',
        title: 'השף אומר',
        instructions:
          'השף יראה לכם רצף של מרכיבים. הקישו עליהם באותו הסדר. בכל סיבוב נוסף מרכיב — טעות אחת והמנה נהרסת.',
        onStart: () => {
          this.removeStartOverlay = null;
          this.beginPlay();
        },
      });
    } else {
      this.beginPlay();
    }
  }

  beginPlay() {
    if (!this.firstInteractionFired && this.config.onInteraction) {
      this.firstInteractionFired = true;
      this.config.onInteraction();
    }
    this.nextRound();
  }

  // --- Timers ---

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timeouts.delete(id);
      fn();
    }, ms);
    this.timeouts.add(id);
  }

  clearTimers() {
    for (const id of this.timeouts) clearTimeout(id);
    this.timeouts.clear();
  }

  // --- Rounds ---

  nextRound() {
    this.state.sequence.push(Math.floor(Math.random() * INGREDIENTS.length));
    this.state.inputIndex = 0;
    this.updateHud();
    this.playSequence();
  }

  playSequence() {
    this.setPhase('showing');
    this.setStatus('השף מראה את המתכון…');
    const round = this.state.sequence.length;
    const { firstDelayMs, baseOnMs, onDecreasePerRoundMs, minOnMs, gapMs } = TUNING.playback;
    const onMs = Math.max(minOnMs, baseOnMs - (round - 1) * onDecreasePerRoundMs);

    let t = firstDelayMs;
    this.state.sequence.forEach((padIndex) => {
      this.later(() => this.lightPad(padIndex, onMs), t);
      t += onMs + gapMs;
    });
    this.later(() => {
      this.setPhase('input');
      this.setStatus(`תורכם! ${round === 1 ? 'מרכיב אחד' : `${round} מרכיבים`}`);
    }, t);
  }

  onBoardClick(e) {
    const pad = e.target.closest('.chef-pad');
    if (!pad || this.state.phase !== 'input') return;
    const padIndex = Number(pad.dataset.index);
    this.lightPad(padIndex, TUNING.input.flashMs);

    const expected = this.state.sequence[this.state.inputIndex];
    if (padIndex !== expected) {
      this.fail(padIndex, expected);
      return;
    }

    this.state.inputIndex += 1;
    if (this.state.inputIndex < this.state.sequence.length) return;

    // Whole sequence repeated.
    if (this.state.sequence.length >= this.config.roundsToWin) {
      this.setPhase('over');
      this.setStatus('המנה מושלמת!');
      this.later(() => {
        if (this.config.onComplete) this.config.onComplete();
      }, TUNING.pacing.winDelayMs);
      return;
    }
    this.setPhase('between');
    this.setStatus('מצוין! עוד מרכיב…');
    this.later(() => this.nextRound(), TUNING.pacing.nextRoundDelayMs);
  }

  fail(pressedIndex, expectedIndex) {
    this.setPhase('over');
    this.setStatus('אופס…');
    this.padEls[pressedIndex].classList.add('chef-pad--wrong');
    this.padEls[expectedIndex].classList.add('chef-pad--hint');
    this.later(() => {
      if (this.config.onGameOver) {
        this.config.onGameOver(`טעות במתכון! היה צריך ${INGREDIENTS[expectedIndex].he}`);
      }
    }, TUNING.pacing.failRevealMs);
  }

  // --- View helpers ---

  lightPad(padIndex, ms) {
    const pad = this.padEls[padIndex];
    if (!pad) return;
    // Restart the lit state even if the same pad lights twice in a row.
    if (pad.classList.contains('chef-pad--lit')) {
      pad.classList.remove('chef-pad--lit');
      void pad.offsetWidth;
    }
    pad.classList.add('chef-pad--lit');
    this.later(() => pad.classList.remove('chef-pad--lit'), ms);
  }

  setPhase(phase) {
    this.state.phase = phase;
    if (this.boardEl) this.boardEl.dataset.phase = phase;
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  updateHud() {
    if (this.roundEl) this.roundEl.textContent = String(this.state.sequence.length);
  }

  render() {
    const pads = INGREDIENTS.map(
      (ing, i) => `
        <button class="chef-pad chef-pad--${ing.key}" type="button" data-index="${i}" aria-label="${ing.he}">
          <span class="chef-pad-emoji" aria-hidden="true">${ing.emoji}</span>
          <span class="chef-pad-label">${ing.he}</span>
        </button>
      `,
    ).join('');

    this.container.innerHTML = `
      <style>${START_OVERLAY_STYLES}\n${styles}</style>
      <div class="chef-game" dir="rtl">
        <div class="chef-hud">
          <span class="chef-round" dir="ltr" aria-label="סיבוב">
            <span id="chef-round">0</span><span class="chef-round-sep">/</span><span>${this.config.roundsToWin}</span>
          </span>
          <span class="chef-status" aria-live="polite"></span>
        </div>
        <div class="chef-board" data-phase="idle">${pads}</div>
      </div>
    `;
  }

  destroy() {
    this.clearTimers();
    this.state.phase = 'over';
    if (this.boardEl) this.boardEl.removeEventListener('click', this._onBoardClick);
    if (this.removeStartOverlay) {
      this.removeStartOverlay();
      this.removeStartOverlay = null;
    }
    this.boardEl = null;
    this.padEls = [];
    this.roundEl = null;
    this.statusEl = null;
    this.container.innerHTML = '';
  }
}
