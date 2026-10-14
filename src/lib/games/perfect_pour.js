import styles from './perfect_pour.css?inline';
import { START_OVERLAY_STYLES, showStartOverlay } from './game_start_overlay.js';

// Hold-and-release game: press and hold to pour juice, let go when the level
// sits inside the marked band. Short of the band or overflowing the glass is
// a strike. Fill `toFill` glasses to win; `maxStrikes` loses.
//
// A pour that is interrupted without a deliberate release (pointercancel —
// e.g. the phone rotating mid-touch — window blur, tab hidden) just stops
// pouring. Nothing is judged; holding again tops up the same glass.

const JUICES = [
  { key: 'orange', emoji: '🍊', he: 'מיץ תפוזים' },
  { key: 'lemon', emoji: '🍋', he: 'לימונדה' },
  { key: 'grape', emoji: '🍇', he: 'מיץ ענבים' },
  { key: 'tomato', emoji: '🍅', he: 'מיץ עגבניות' },
];

const TUNING = {
  win: { toFill: 8 },
  miss: { maxStrikes: 3 },
  pour: {
    // Fraction of the glass per second. Speeds up as glasses are filled.
    baseRate: 0.3,
    ratePerGlass: 0.025,
    maxRate: 0.5,
    maxFrameSec: 0.1,
    // Releases below this level count as a tap, not a pour.
    minJudgedLevel: 0.05,
  },
  band: {
    // Band height shrinks from baseSize to minSize over the run.
    baseSize: 0.16,
    sizePerGlass: 0.012,
    minSize: 0.08,
    // Band centre is drawn from this range (fraction of glass height).
    centerMin: 0.42,
    centerMax: 0.82,
  },
  pacing: { resultMs: 750, endDelayMs: 450 },
};

let perfectPourIntroPending = true;

export class PerfectPourGame {
  static resetSession() {
    perfectPourIntroPending = true;
  }

  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        toFill: TUNING.win.toFill,
        maxStrikes: TUNING.miss.maxStrikes,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      level: 0,
      band: { lo: 0, hi: 0 },
      juiceIndex: 0,
      filled: 0,
      strikes: 0,
      pouring: false,
      phase: 'idle', // idle | ready | result | over
    };

    this.gameEl = null;
    this.stageEl = null;
    this.glassEl = null;
    this.bandEl = null;
    this.labelEl = null;
    this.filledEl = null;
    this.toastEl = null;
    this.strikePipsEls = [];
    this.removeStartOverlay = null;
    this.rafId = null;
    this.lastTs = null;
    this.pointerId = null;
    this.timeouts = new Set();
    this.firstInteractionFired = false;

    this._loop = this.loop.bind(this);
    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onPointerCancel = this.onPointerCancel.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
    this._onKeyUp = this.onKeyUp.bind(this);
    this._onInterrupt = () => this.stopPouring();
    this._onVisibility = () => {
      if (document.hidden) this.stopPouring();
    };
  }

  start() {
    this.render();
    this.gameEl = this.container.querySelector('.pour-game');
    this.stageEl = this.container.querySelector('.pour-stage');
    this.glassEl = this.container.querySelector('.pour-glass');
    this.bandEl = this.container.querySelector('.pour-band');
    this.labelEl = this.container.querySelector('.pour-label');
    this.filledEl = this.container.querySelector('#pour-filled');
    this.toastEl = this.container.querySelector('.pour-toast');
    this.strikePipsEls = Array.from(this.container.querySelectorAll('.pour-strike-pip'));

    this.stageEl.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onInterrupt);
    document.addEventListener('visibilitychange', this._onVisibility);

    if (perfectPourIntroPending) {
      perfectPourIntroPending = false;
      this.removeStartOverlay = showStartOverlay(this.gameEl, {
        emoji: '🧃',
        title: 'מזיגה מדויקת',
        instructions:
          'לחצו והחזיקו כדי למזוג, ושחררו כשהמיץ בתוך הפס המסומן. חסר או גלש — פספוס. במחשב אפשר להחזיק את מקש הרווח.',
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
    this.newGlass();
  }

  // --- Glass lifecycle ---

  newGlass() {
    const { baseSize, sizePerGlass, minSize, centerMin, centerMax } = TUNING.band;
    const size = Math.max(minSize, baseSize - this.state.filled * sizePerGlass);
    const center = centerMin + Math.random() * (centerMax - centerMin);
    this.state.band = { lo: center - size / 2, hi: center + size / 2 };
    this.state.level = 0;
    this.state.juiceIndex = (this.state.juiceIndex + 1) % JUICES.length;
    const juice = JUICES[this.state.juiceIndex];

    this.gameEl.dataset.juice = juice.key;
    this.labelEl.textContent = `${juice.emoji} ${juice.he}`;
    this.bandEl.style.setProperty('--lo', this.state.band.lo.toFixed(3));
    this.bandEl.style.setProperty('--hi', this.state.band.hi.toFixed(3));
    this.gameEl.classList.remove('pour-game--good', 'pour-game--bad');
    this.paintLevel();
    this.setPhase('ready');
  }

  rate() {
    const { baseRate, ratePerGlass, maxRate } = TUNING.pour;
    return Math.min(maxRate, baseRate + this.state.filled * ratePerGlass);
  }

  startPouring() {
    if (this.state.phase !== 'ready' || this.state.pouring) return;
    this.state.pouring = true;
    this.gameEl.classList.add('pour-game--pouring');
    this.lastTs = null;
    this.rafId = requestAnimationFrame(this._loop);
  }

  // Stop without judging (interrupted pour).
  stopPouring() {
    if (!this.state.pouring) return;
    this.state.pouring = false;
    this.pointerId = null;
    this.gameEl.classList.remove('pour-game--pouring');
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  // Deliberate release: stop and judge.
  release() {
    if (!this.state.pouring) return;
    this.stopPouring();
    if (this.state.level < TUNING.pour.minJudgedLevel) return;
    const { lo, hi } = this.state.band;
    if (this.state.level < lo) this.judge(false, 'חסר!');
    else if (this.state.level > hi) this.judge(false, 'יותר מדי!');
    else this.judge(true, 'מושלם!');
  }

  loop(ts) {
    this.rafId = null;
    if (!this.state.pouring) return;
    const dt =
      this.lastTs === null ? 0 : Math.min(TUNING.pour.maxFrameSec, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.state.level = Math.min(1, this.state.level + dt * this.rate());
    this.paintLevel();
    if (this.state.level >= 1) {
      this.stopPouring();
      this.gameEl.classList.add('pour-game--spill');
      this.judge(false, 'גלש!');
      return;
    }
    this.rafId = requestAnimationFrame(this._loop);
  }

  judge(success, text) {
    this.setPhase('result');
    this.showToast(text, success);
    this.gameEl.classList.add(success ? 'pour-game--good' : 'pour-game--bad');

    if (success) {
      this.state.filled += 1;
      if (this.filledEl) this.filledEl.textContent = String(this.state.filled);
      if (this.state.filled >= this.config.toFill) {
        this.end(() => this.config.onComplete && this.config.onComplete());
        return;
      }
    } else {
      this.state.strikes += 1;
      const pip = this.strikePipsEls[this.state.strikes - 1];
      if (pip) pip.classList.add('pour-strike-pip--filled');
      if (this.state.strikes >= this.config.maxStrikes) {
        this.end(
          () => this.config.onGameOver && this.config.onGameOver('יותר מדי כוסות הלכו לפח!'),
        );
        return;
      }
    }
    this.later(() => {
      this.gameEl.classList.remove('pour-game--spill');
      this.newGlass();
    }, TUNING.pacing.resultMs);
  }

  end(callback) {
    this.setPhase('over');
    this.later(callback, TUNING.pacing.endDelayMs);
  }

  // --- Input ---

  onPointerDown(e) {
    if (this.state.phase !== 'ready') return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.startPouring();
  }

  onPointerUp(e) {
    if (this.pointerId === null || e.pointerId !== this.pointerId) return;
    this.release();
  }

  onPointerCancel(e) {
    if (this.pointerId === null || e.pointerId !== this.pointerId) return;
    this.stopPouring();
  }

  onKeyDown(e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (this.state.phase === 'idle' || this.state.phase === 'over') return;
    e.preventDefault();
    if (!e.repeat) this.startPouring();
  }

  onKeyUp(e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (this.pointerId !== null) return; // a finger is pouring, not the key
    this.release();
  }

  // --- View helpers ---

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timeouts.delete(id);
      fn();
    }, ms);
    this.timeouts.add(id);
  }

  setPhase(phase) {
    this.state.phase = phase;
    if (this.gameEl) this.gameEl.dataset.phase = phase;
  }

  paintLevel() {
    // On the glass so both the liquid and the stream (::before) read it.
    if (this.glassEl) this.glassEl.style.setProperty('--level', this.state.level.toFixed(4));
  }

  showToast(text, good) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.className = `pour-toast pour-toast--${good ? 'good' : 'bad'}`;
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('pour-toast--show');
  }

  render() {
    const pips = Array.from({ length: this.config.maxStrikes })
      .map(() => '<span class="pour-strike-pip" aria-hidden="true"></span>')
      .join('');
    this.container.innerHTML = `
      <style>${START_OVERLAY_STYLES}\n${styles}</style>
      <div class="pour-game" dir="rtl" data-phase="idle">
        <div class="pour-hud">
          <div class="pour-strikes" aria-label="פספוסים">${pips}</div>
          <span class="pour-label"></span>
          <span class="pour-counter" dir="ltr" aria-label="כוסות מלאות">
            <span id="pour-filled">0</span><span class="pour-counter-sep">/</span><span>${this.config.toFill}</span>
          </span>
        </div>
        <div class="pour-stage" role="button" aria-label="לחצו והחזיקו כדי למזוג">
          <div class="pour-bottle" aria-hidden="true"></div>
          <div class="pour-glass" aria-hidden="true">
            <div class="pour-band"></div>
            <div class="pour-liquid"></div>
          </div>
          <div class="pour-toast" aria-live="polite"></div>
          <p class="pour-hint">לחצו והחזיקו</p>
        </div>
      </div>
    `;
  }

  destroy() {
    this.stopPouring();
    this.state.phase = 'over';
    for (const id of this.timeouts) clearTimeout(id);
    this.timeouts.clear();
    if (this.stageEl) this.stageEl.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onInterrupt);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.removeStartOverlay) {
      this.removeStartOverlay();
      this.removeStartOverlay = null;
    }
    this.gameEl = null;
    this.stageEl = null;
    this.glassEl = null;
    this.bandEl = null;
    this.labelEl = null;
    this.filledEl = null;
    this.toastEl = null;
    this.strikePipsEls = [];
    this.container.innerHTML = '';
  }
}
