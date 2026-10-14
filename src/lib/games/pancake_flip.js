import styles from './pancake_flip.css?inline';
import { START_OVERLAY_STYLES, showStartOverlay } from './game_start_overlay.js';

// Timing game: batter lands in three pans and cooks. Tap a pan while the
// pancake is golden to flip it, tap again when the second side is golden to
// serve it. Tapping a raw pancake or letting one burn costs a strike.
// Serve `toServe` pancakes to win; `maxStrikes` strikes loses.
//
// Everything advances inside one requestAnimationFrame loop using elapsed
// time, so a hidden tab (rAF stops) or pause() freezes the whole stove —
// including the timers that pour new batter.

const TUNING = {
  win: { toServe: 8 },
  miss: { maxStrikes: 3 },
  pans: 3,
  cook: {
    // Seconds for one side to go from raw to burnt. Shrinks as the player
    // serves more pancakes.
    baseSideSec: 3.4,
    decreasePerServeSec: 0.15,
    minSideSec: 2.2,
    goldenFrom: 0.6, // progress where the golden window opens
    // progress 1.0 = burnt
  },
  pour: {
    firstDelaySec: [0.3, 1.4], // random range per pan at start
    delaySec: [0.6, 1.8], // random range after a pan frees up
  },
  pacing: {
    burntHoldSec: 0.8, // charred pancake stays on the pan this long
    maxFrameSec: 0.1, // clamp so a long frame can't skip the golden window
    winDelayMs: 450,
    loseDelayMs: 450,
  },
};

let pancakeIntroPending = true;

function randomIn([lo, hi]) {
  return lo + Math.random() * (hi - lo);
}

export class PancakeFlipGame {
  static resetSession() {
    pancakeIntroPending = true;
  }

  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        toServe: TUNING.win.toServe,
        maxStrikes: TUNING.miss.maxStrikes,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      pans: [],
      served: 0,
      strikes: 0,
      isRunning: false,
      isPaused: false,
    };

    this.stoveEl = null;
    this.servedEl = null;
    this.strikePipsEls = [];
    this.toastEl = null;
    this.removeStartOverlay = null;
    this.rafId = null;
    this.lastTs = null;
    this.endTimeoutId = null;
    this.toastTimeoutId = null;
    this.firstInteractionFired = false;

    this._loop = this.loop.bind(this);
    this._onStoveClick = this.onStoveClick.bind(this);
  }

  start() {
    this.render();
    this.stoveEl = this.container.querySelector('.pancake-stove');
    this.servedEl = this.container.querySelector('#pancake-served');
    this.toastEl = this.container.querySelector('.pancake-toast');
    this.strikePipsEls = Array.from(this.container.querySelectorAll('.pancake-strike-pip'));
    this.state.pans = Array.from(this.container.querySelectorAll('.pancake-pan')).map((el) => ({
      el,
      cakeEl: el.querySelector('.pancake-cake'),
      phase: 'empty', // empty | side1 | side2 | burnt
      progress: 0,
      wait: randomIn(TUNING.pour.firstDelaySec),
    }));
    this.state.pans.forEach((pan) => this.paintPan(pan));
    this.stoveEl.addEventListener('click', this._onStoveClick);

    if (pancakeIntroPending) {
      pancakeIntroPending = false;
      this.removeStartOverlay = showStartOverlay(this.container.querySelector('.pancake-game'), {
        emoji: '🥞',
        title: 'מחבת הפנקייקים',
        instructions:
          'הקישו על מחבת כשהפנקייק זהוב כדי להפוך אותו, ושוב כשהצד השני זהוב כדי להגיש. מוקדם מדי או שרוף — פספוס.',
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
    if (this.state.isRunning) return;
    this.state.isRunning = true;
    if (!this.firstInteractionFired && this.config.onInteraction) {
      this.firstInteractionFired = true;
      this.config.onInteraction();
    }
    if (!this.state.isPaused) this.startLoop();
  }

  // --- Pause (GameWrapper calls these while the rotate prompt is up) ---

  pause() {
    this.state.isPaused = true;
    this.stopLoop();
    if (this.stoveEl) this.stoveEl.classList.add('pancake-stove--paused');
  }

  resume() {
    this.state.isPaused = false;
    if (this.stoveEl) this.stoveEl.classList.remove('pancake-stove--paused');
    if (this.state.isRunning) this.startLoop();
  }

  // --- Loop ---

  startLoop() {
    if (this.rafId) return;
    this.lastTs = null;
    this.rafId = requestAnimationFrame(this._loop);
  }

  stopLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastTs = null;
  }

  loop(ts) {
    this.rafId = null;
    if (!this.state.isRunning || this.state.isPaused) return;
    const dt =
      this.lastTs === null ? 0 : Math.min(TUNING.pacing.maxFrameSec, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    for (const pan of this.state.pans) {
      this.advancePan(pan, dt);
      if (!this.state.isRunning) return;
    }
    this.rafId = requestAnimationFrame(this._loop);
  }

  sideSeconds() {
    const { baseSideSec, decreasePerServeSec, minSideSec } = TUNING.cook;
    return Math.max(minSideSec, baseSideSec - this.state.served * decreasePerServeSec);
  }

  advancePan(pan, dt) {
    if (pan.phase === 'empty') {
      pan.wait -= dt;
      if (pan.wait <= 0) {
        pan.phase = 'side1';
        pan.progress = 0;
        this.paintPan(pan, 'pour');
      }
      return;
    }
    if (pan.phase === 'burnt') {
      pan.wait -= dt;
      if (pan.wait <= 0) this.emptyPan(pan);
      return;
    }
    pan.progress += dt / this.sideSeconds();
    if (pan.progress >= 1) {
      pan.phase = 'burnt';
      pan.wait = TUNING.pacing.burntHoldSec;
      this.paintPan(pan);
      this.addStrike('נשרף!', pan);
      return;
    }
    this.paintPan(pan);
  }

  emptyPan(pan) {
    pan.phase = 'empty';
    pan.progress = 0;
    pan.wait = randomIn(TUNING.pour.delaySec);
    this.paintPan(pan);
  }

  // --- Input ---

  onStoveClick(e) {
    const panEl = e.target.closest('.pancake-pan');
    if (!panEl || !this.state.isRunning || this.state.isPaused) return;
    const pan = this.state.pans.find((p) => p.el === panEl);
    if (!pan || pan.phase === 'empty' || pan.phase === 'burnt') return;

    if (pan.progress < TUNING.cook.goldenFrom) {
      // Too early: the raw pancake tears and is lost.
      this.addStrike('עוד לא מוכן!', pan);
      if (this.state.isRunning) this.emptyPan(pan);
      return;
    }

    if (pan.phase === 'side1') {
      pan.phase = 'side2';
      pan.progress = 0;
      this.paintPan(pan, 'flip');
      return;
    }

    // Second side golden → serve.
    this.state.served += 1;
    if (this.servedEl) this.servedEl.textContent = String(this.state.served);
    this.paintPan(pan, 'serve');
    this.emptyPan(pan);
    this.showToast('מעולה!', pan, 'good');
    if (this.state.served >= this.config.toServe) {
      this.finish(
        () => this.config.onComplete && this.config.onComplete(),
        TUNING.pacing.winDelayMs,
      );
    }
  }

  addStrike(text, pan) {
    this.state.strikes += 1;
    const pip = this.strikePipsEls[this.state.strikes - 1];
    if (pip) pip.classList.add('pancake-strike-pip--filled');
    this.showToast(text, pan, 'bad');
    if (this.state.strikes >= this.config.maxStrikes) {
      this.finish(
        () => this.config.onGameOver && this.config.onGameOver('יותר מדי פנקייקים הלכו לפח!'),
        TUNING.pacing.loseDelayMs,
      );
    }
  }

  finish(callback, delayMs) {
    this.state.isRunning = false;
    this.stopLoop();
    this.endTimeoutId = setTimeout(() => {
      this.endTimeoutId = null;
      callback();
    }, delayMs);
  }

  // --- View ---

  zoneOf(pan) {
    if (pan.phase === 'empty' || pan.phase === 'burnt') return pan.phase;
    return pan.progress < TUNING.cook.goldenFrom ? 'raw' : 'golden';
  }

  paintPan(pan, effect) {
    const zone = this.zoneOf(pan);
    pan.el.dataset.zone = zone;
    pan.el.dataset.side = pan.phase === 'side2' ? '2' : '1';
    pan.el.style.setProperty('--progress', pan.progress.toFixed(3));
    pan.el.setAttribute(
      'aria-label',
      {
        empty: 'מחבת ריקה',
        raw: 'פנקייק מתבשל',
        golden: pan.phase === 'side1' ? 'זהוב — להפוך' : 'זהוב — להגיש',
        burnt: 'פנקייק שרוף',
      }[zone],
    );
    if (effect) {
      pan.cakeEl.classList.remove(
        'pancake-cake--pour',
        'pancake-cake--flip',
        'pancake-cake--serve',
      );
      void pan.cakeEl.offsetWidth;
      pan.cakeEl.classList.add(`pancake-cake--${effect}`);
    }
  }

  showToast(text, pan, kind) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.className = `pancake-toast pancake-toast--${kind} pancake-toast--show`;
    const panRect = pan.el.getBoundingClientRect();
    const gameRect = this.container.querySelector('.pancake-game').getBoundingClientRect();
    this.toastEl.style.left = `${panRect.left - gameRect.left + panRect.width / 2}px`;
    this.toastEl.style.top = `${panRect.top - gameRect.top}px`;
    clearTimeout(this.toastTimeoutId);
    this.toastTimeoutId = setTimeout(() => {
      if (this.toastEl) this.toastEl.classList.remove('pancake-toast--show');
    }, 700);
  }

  render() {
    const pans = Array.from({ length: TUNING.pans })
      .map(
        (_, i) => `
          <button class="pancake-pan" type="button" data-index="${i}" data-zone="empty">
            <span class="pancake-ring" aria-hidden="true"></span>
            <span class="pancake-cake" aria-hidden="true"></span>
            <span class="pancake-handle" aria-hidden="true"></span>
          </button>
        `,
      )
      .join('');
    const pips = Array.from({ length: this.config.maxStrikes })
      .map(() => '<span class="pancake-strike-pip" aria-hidden="true"></span>')
      .join('');

    this.container.innerHTML = `
      <style>${START_OVERLAY_STYLES}\n${styles}</style>
      <div class="pancake-game" dir="rtl">
        <div class="pancake-hud">
          <div class="pancake-strikes" aria-label="פספוסים">${pips}</div>
          <span class="pancake-counter" dir="ltr" aria-label="פנקייקים שהוגשו">
            🥞 <span id="pancake-served">0</span><span class="pancake-counter-sep">/</span><span>${this.config.toServe}</span>
          </span>
        </div>
        <div class="pancake-stove">${pans}</div>
        <div class="pancake-legend" aria-hidden="true">
          <span class="pancake-legend-item pancake-legend-item--raw">נא</span>
          <span class="pancake-legend-item pancake-legend-item--golden">זהוב — הקישו!</span>
          <span class="pancake-legend-item pancake-legend-item--burnt">שרוף</span>
        </div>
        <div class="pancake-toast" aria-live="polite"></div>
      </div>
    `;
  }

  destroy() {
    this.state.isRunning = false;
    this.stopLoop();
    clearTimeout(this.endTimeoutId);
    clearTimeout(this.toastTimeoutId);
    this.endTimeoutId = null;
    this.toastTimeoutId = null;
    if (this.stoveEl) this.stoveEl.removeEventListener('click', this._onStoveClick);
    if (this.removeStartOverlay) {
      this.removeStartOverlay();
      this.removeStartOverlay = null;
    }
    this.state.pans = [];
    this.stoveEl = null;
    this.servedEl = null;
    this.toastEl = null;
    this.strikePipsEls = [];
    this.container.innerHTML = '';
  }
}
