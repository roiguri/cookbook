import styles from './garden_harvest.css?inline';
import { START_OVERLAY_STYLES, showStartOverlay } from './game_start_overlay.js';

// Whack-a-mole in a vegetable bed: produce pops out of nine holes. Tap it
// before it sinks back. Worms pop up too — don't tap those. Only tapping a
// worm is a strike; a vegetable that sinks unpicked is just a lost chance.
// Harvest `toHarvest` to win; `maxStrikes` worm taps lose.
//
// All timing runs in one rAF loop on elapsed time, so pause() (rotate
// prompt) or a hidden tab freezes the bed instead of letting everything
// sink at once.

const VEGGIES = [
  { emoji: '🥕', he: 'גזר' },
  { emoji: '🥬', he: 'חסה' },
  { emoji: '🥔', he: 'תפוח אדמה' },
  { emoji: '🧅', he: 'בצל' },
  { emoji: '🌽', he: 'תירס' },
  { emoji: '🥦', he: 'ברוקולי' },
];
const WORM = { emoji: '🐛', he: 'תולעת' };

const TUNING = {
  win: { toHarvest: 20 },
  miss: { maxStrikes: 3 },
  holes: 9,
  pop: {
    // Seconds an item stays up; shrinks as the player harvests more.
    baseUpSec: 1.7,
    upPerHarvestSec: 0.035,
    minUpSec: 0.95,
    // Seconds between pops; also shrinks.
    baseGapSec: 0.95,
    gapPerHarvestSec: 0.02,
    minGapSec: 0.5,
    maxUp: 3, // never more than this many items above ground
    wormChance: 0.22,
    firstPopSec: 0.4,
    maxFrameSec: 0.1,
  },
  // How long a hole shows its outcome animation (pluck / sink / wriggle)
  // before it is free again. Matches the ~420ms animations in the CSS.
  pacing: { hitShowSec: 0.45, endDelayMs: 450 },
};

let gardenIntroPending = true;

export class GardenHarvestGame {
  static resetSession() {
    gardenIntroPending = true;
  }

  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        toHarvest: TUNING.win.toHarvest,
        maxStrikes: TUNING.miss.maxStrikes,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      holes: [],
      harvested: 0,
      strikes: 0,
      nextPopIn: TUNING.pop.firstPopSec,
      isRunning: false,
      isPaused: false,
    };

    this.bedEl = null;
    this.harvestedEl = null;
    this.strikePipsEls = [];
    this.statusEl = null;
    this.removeStartOverlay = null;
    this.rafId = null;
    this.lastTs = null;
    this.endTimeoutId = null;
    this.firstInteractionFired = false;

    this._loop = this.loop.bind(this);
    this._onBedClick = this.onBedClick.bind(this);
  }

  start() {
    this.render();
    this.bedEl = this.container.querySelector('.garden-bed');
    this.harvestedEl = this.container.querySelector('#garden-harvested');
    this.statusEl = this.container.querySelector('.garden-status');
    this.strikePipsEls = Array.from(this.container.querySelectorAll('.garden-strike-pip'));
    this.state.holes = Array.from(this.container.querySelectorAll('.garden-hole')).map((el) => ({
      el,
      itemEl: el.querySelector('.garden-item'),
      state: 'empty', // empty | up | hit | gone
      kind: null, // veg | worm
      timer: 0,
    }));
    this.bedEl.addEventListener('click', this._onBedClick);

    if (gardenIntroPending) {
      gardenIntroPending = false;
      this.removeStartOverlay = showStartOverlay(this.container.querySelector('.garden-game'), {
        emoji: '🥕',
        title: 'קציר בגינה',
        instructions:
          'ירקות קופצים מהאדמה — הקישו עליהם לפני שהם חוזרים פנימה. אל תגעו בתולעים — כל תולעת היא פספוס.',
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
  }

  resume() {
    this.state.isPaused = false;
    if (this.state.isRunning) this.startLoop();
  }

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

  // --- Loop ---

  loop(ts) {
    this.rafId = null;
    if (!this.state.isRunning || this.state.isPaused) return;
    const dt =
      this.lastTs === null ? 0 : Math.min(TUNING.pop.maxFrameSec, (ts - this.lastTs) / 1000);
    this.lastTs = ts;

    for (const hole of this.state.holes) {
      if (hole.state === 'empty') continue;
      hole.timer -= dt;
      if (hole.timer > 0) continue;
      if (hole.state === 'up') {
        // Sank back unpicked — no penalty; only worms cost strikes.
        this.sink(hole, hole.kind === 'veg' ? 'missed' : 'gone');
      } else {
        this.clearHole(hole);
      }
    }

    this.state.nextPopIn -= dt;
    if (this.state.nextPopIn <= 0) {
      this.pop();
      this.state.nextPopIn = this.gapSec();
    }
    this.rafId = requestAnimationFrame(this._loop);
  }

  upSec() {
    const { baseUpSec, upPerHarvestSec, minUpSec } = TUNING.pop;
    return Math.max(minUpSec, baseUpSec - this.state.harvested * upPerHarvestSec);
  }

  gapSec() {
    const { baseGapSec, gapPerHarvestSec, minGapSec } = TUNING.pop;
    return Math.max(minGapSec, baseGapSec - this.state.harvested * gapPerHarvestSec);
  }

  pop() {
    const up = this.state.holes.filter((h) => h.state !== 'empty').length;
    if (up >= TUNING.pop.maxUp) return;
    const free = this.state.holes.filter((h) => h.state === 'empty');
    if (!free.length) return;
    const hole = free[Math.floor(Math.random() * free.length)];
    const isWorm = Math.random() < TUNING.pop.wormChance;
    const item = isWorm ? WORM : VEGGIES[Math.floor(Math.random() * VEGGIES.length)];
    hole.kind = isWorm ? 'worm' : 'veg';
    hole.state = 'up';
    hole.timer = this.upSec();
    hole.itemEl.textContent = item.emoji;
    hole.el.setAttribute('aria-label', item.he);
    hole.el.dataset.kind = hole.kind;
    hole.el.dataset.state = 'up';
  }

  sink(hole, visual) {
    hole.state = 'gone';
    hole.timer = TUNING.pacing.hitShowSec;
    hole.el.dataset.state = visual;
  }

  clearHole(hole) {
    hole.state = 'empty';
    hole.kind = null;
    hole.el.dataset.state = 'empty';
    delete hole.el.dataset.kind;
    hole.el.setAttribute('aria-label', 'גומה ריקה');
  }

  // --- Input ---

  onBedClick(e) {
    const holeEl = e.target.closest('.garden-hole');
    if (!holeEl || !this.state.isRunning || this.state.isPaused) return;
    const hole = this.state.holes.find((h) => h.el === holeEl);
    if (!hole || hole.state !== 'up') return;

    if (hole.kind === 'worm') {
      this.sink(hole, 'bitten');
      this.addStrike('אוי, תולעת!');
      return;
    }
    hole.state = 'hit';
    hole.timer = TUNING.pacing.hitShowSec;
    hole.el.dataset.state = 'hit';
    this.state.harvested += 1;
    if (this.harvestedEl) this.harvestedEl.textContent = String(this.state.harvested);
    if (this.state.harvested >= this.config.toHarvest) {
      this.finish(() => this.config.onComplete && this.config.onComplete());
    }
  }

  addStrike(text) {
    this.state.strikes += 1;
    const pip = this.strikePipsEls[this.state.strikes - 1];
    if (pip) pip.classList.add('garden-strike-pip--filled');
    this.setStatus(text);
    if (this.state.strikes >= this.config.maxStrikes) {
      this.finish(() => this.config.onGameOver && this.config.onGameOver('הגינה נשארה בלי קציר!'));
    }
  }

  finish(callback) {
    this.state.isRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.endTimeoutId = setTimeout(() => {
      this.endTimeoutId = null;
      callback();
    }, TUNING.pacing.endDelayMs);
  }

  setStatus(text) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.remove('garden-status--flash');
    void this.statusEl.offsetWidth;
    this.statusEl.classList.add('garden-status--flash');
  }

  render() {
    const holes = Array.from({ length: TUNING.holes })
      .map(
        (_, i) => `
          <button class="garden-hole" type="button" data-index="${i}" data-state="empty" aria-label="גומה ריקה">
            <span class="garden-item" aria-hidden="true"></span>
            <span class="garden-soil" aria-hidden="true"></span>
          </button>
        `,
      )
      .join('');
    const pips = Array.from({ length: this.config.maxStrikes })
      .map(() => '<span class="garden-strike-pip" aria-hidden="true"></span>')
      .join('');
    this.container.innerHTML = `
      <style>${START_OVERLAY_STYLES}\n${styles}</style>
      <div class="garden-game" dir="rtl">
        <div class="garden-hud">
          <div class="garden-strikes" aria-label="פספוסים">${pips}</div>
          <span class="garden-status" aria-live="polite"></span>
          <span class="garden-counter" dir="ltr" aria-label="ירקות שנקטפו">
            🧺 <span id="garden-harvested">0</span><span class="garden-counter-sep">/</span><span>${this.config.toHarvest}</span>
          </span>
        </div>
        <div class="garden-bed">${holes}</div>
      </div>
    `;
  }

  destroy() {
    this.state.isRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    clearTimeout(this.endTimeoutId);
    this.endTimeoutId = null;
    if (this.bedEl) this.bedEl.removeEventListener('click', this._onBedClick);
    if (this.removeStartOverlay) {
      this.removeStartOverlay();
      this.removeStartOverlay = null;
    }
    this.state.holes = [];
    this.bedEl = null;
    this.harvestedEl = null;
    this.statusEl = null;
    this.strikePipsEls = [];
    this.container.innerHTML = '';
  }
}
