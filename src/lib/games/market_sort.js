import styles from './market_sort.css?inline';
import { START_OVERLAY_STYLES, showStartOverlay } from './game_start_overlay.js';

// Sorting game: produce drops down the stall one item at a time. Send it to
// the fruit basket or the vegetable basket (tap a basket, swipe toward it,
// or use the arrow keys) before it hits the ground. A wrong basket or a
// dropped item is a strike. Sort `toSort` items to win; `maxStrikes` loses.
//
// Only kitchen-unambiguous produce — no tomato / pepper / cucumber debates.
const PRODUCE = [
  { emoji: '🍎', he: 'תפוח', kind: 'fruit' },
  { emoji: '🍌', he: 'בננה', kind: 'fruit' },
  { emoji: '🍇', he: 'ענבים', kind: 'fruit' },
  { emoji: '🍓', he: 'תות', kind: 'fruit' },
  { emoji: '🍐', he: 'אגס', kind: 'fruit' },
  { emoji: '🍒', he: 'דובדבן', kind: 'fruit' },
  { emoji: '🍑', he: 'אפרסק', kind: 'fruit' },
  { emoji: '🍍', he: 'אננס', kind: 'fruit' },
  { emoji: '🥕', he: 'גזר', kind: 'veg' },
  { emoji: '🥦', he: 'ברוקולי', kind: 'veg' },
  { emoji: '🥬', he: 'חסה', kind: 'veg' },
  { emoji: '🧅', he: 'בצל', kind: 'veg' },
  { emoji: '🥔', he: 'תפוח אדמה', kind: 'veg' },
  { emoji: '🧄', he: 'שום', kind: 'veg' },
];

const KIND_HE = { fruit: 'פרי', veg: 'ירק' };

const TUNING = {
  win: { toSort: 20 },
  miss: { maxStrikes: 3 },
  fall: {
    // Speed is a fraction of the field height per second, so the game plays
    // the same on any screen size and survives a resize mid-fall.
    baseSpeed: 0.2,
    speedPerSorted: 0.012,
    maxSpeed: 0.48,
  },
  swipe: { minPx: 40 },
  pacing: {
    nextItemDelaySec: 0.35,
    flyMs: 320,
    maxFrameSec: 0.1,
    endDelayMs: 450,
  },
};

let marketSortIntroPending = true;

export class MarketSortGame {
  static resetSession() {
    marketSortIntroPending = true;
  }

  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        toSort: TUNING.win.toSort,
        maxStrikes: TUNING.miss.maxStrikes,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      item: null, // { data, y, el }
      sorted: 0,
      strikes: 0,
      wait: 0, // seconds until the next item drops
      lastPick: null,
      isRunning: false,
      isPaused: false,
    };

    this.fieldEl = null;
    this.basketEls = {};
    this.sortedEl = null;
    this.strikePipsEls = [];
    this.toastEl = null;
    this.removeStartOverlay = null;
    this.rafId = null;
    this.lastTs = null;
    this.timeouts = new Set();
    this.swipe = null;
    this.firstInteractionFired = false;

    this._loop = this.loop.bind(this);
    this._onBasketClick = this.onBasketClick.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
  }

  start() {
    this.render();
    this.fieldEl = this.container.querySelector('.market-field');
    this.sortedEl = this.container.querySelector('#market-sorted');
    this.toastEl = this.container.querySelector('.market-toast');
    this.strikePipsEls = Array.from(this.container.querySelectorAll('.market-strike-pip'));
    this.basketEls = {
      fruit: this.container.querySelector('.market-basket--fruit'),
      veg: this.container.querySelector('.market-basket--veg'),
    };
    this.container.querySelector('.market-baskets').addEventListener('click', this._onBasketClick);
    this.fieldEl.addEventListener('pointerdown', this._onPointerDown);
    this.fieldEl.addEventListener('pointerup', this._onPointerUp);
    this.fieldEl.addEventListener('pointercancel', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);

    if (marketSortIntroPending) {
      marketSortIntroPending = false;
      this.removeStartOverlay = showStartOverlay(this.container.querySelector('.market-game'), {
        emoji: '🧺',
        title: 'מיון בשוק',
        instructions:
          'פירות לסל הפירות, ירקות לסל הירקות. הקישו על הסל, החליקו לכיוונו או השתמשו בחצים — לפני שהמוצר נופל לרצפה.',
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
    this.dropItem();
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

    const item = this.state.item;
    if (item) {
      item.y += dt * this.speed();
      this.positionItem(item);
      if (item.y >= 1) {
        this.state.item = null;
        item.el.classList.add('market-item--splat');
        this.later(() => item.el.remove(), TUNING.pacing.flyMs);
        this.addStrike(`${item.data.he} נפל!`);
      }
    } else {
      this.state.wait -= dt;
      if (this.state.wait <= 0) this.dropItem();
    }

    if (this.state.isRunning) this.rafId = requestAnimationFrame(this._loop);
  }

  speed() {
    const { baseSpeed, speedPerSorted, maxSpeed } = TUNING.fall;
    return Math.min(maxSpeed, baseSpeed + this.state.sorted * speedPerSorted);
  }

  dropItem() {
    // Avoid the same produce twice in a row.
    let data;
    do {
      data = PRODUCE[Math.floor(Math.random() * PRODUCE.length)];
    } while (data === this.state.lastPick && PRODUCE.length > 1);
    this.state.lastPick = data;

    const el = document.createElement('div');
    el.className = 'market-item';
    el.dataset.kind = data.kind;
    el.innerHTML = `<span class="market-item-emoji" aria-hidden="true"></span><span class="market-item-name"></span>`;
    el.querySelector('.market-item-emoji').textContent = data.emoji;
    el.querySelector('.market-item-name').textContent = data.he;
    this.fieldEl.appendChild(el);
    this.state.item = { data, y: 0, el };
    this.positionItem(this.state.item);
  }

  positionItem(item) {
    // --y is consumed by CSS (top: calc(...)) so the position follows the
    // field's current height — a rotation mid-fall just rescales it.
    item.el.style.setProperty('--y', item.y.toFixed(4));
  }

  // --- Input ---

  sort(kind) {
    const item = this.state.item;
    if (!item || !this.state.isRunning || this.state.isPaused) return;
    this.state.item = null;
    this.state.wait = TUNING.pacing.nextItemDelaySec;

    item.el.classList.add(`market-item--to-${kind}`);
    this.later(() => item.el.remove(), TUNING.pacing.flyMs);
    this.bump(this.basketEls[kind], item.data.kind === kind ? 'good' : 'bad');

    if (item.data.kind !== kind) {
      this.addStrike(`${item.data.he} זה ${KIND_HE[item.data.kind]}!`);
      return;
    }
    this.state.sorted += 1;
    if (this.sortedEl) this.sortedEl.textContent = String(this.state.sorted);
    if (this.state.sorted >= this.config.toSort) {
      this.finish(() => this.config.onComplete && this.config.onComplete());
    }
  }

  onBasketClick(e) {
    const basket = e.target.closest('.market-basket');
    if (basket) this.sort(basket.dataset.kind);
  }

  onKeyDown(e) {
    if (!this.state.isRunning) return;
    // RTL layout: the fruit basket sits on the right.
    if (e.key === 'ArrowRight') this.sort('fruit');
    else if (e.key === 'ArrowLeft') this.sort('veg');
    else return;
    e.preventDefault();
  }

  onPointerDown(e) {
    this.swipe = { id: e.pointerId, x: e.clientX };
  }

  onPointerUp(e) {
    if (!this.swipe || this.swipe.id !== e.pointerId) return;
    const dx = e.clientX - this.swipe.x;
    this.swipe = null;
    if (e.type === 'pointercancel' || Math.abs(dx) < TUNING.swipe.minPx) return;
    this.sort(dx > 0 ? 'fruit' : 'veg');
  }

  // --- Outcome ---

  addStrike(text) {
    this.state.strikes += 1;
    const pip = this.strikePipsEls[this.state.strikes - 1];
    if (pip) pip.classList.add('market-strike-pip--filled');
    this.showToast(text);
    if (this.state.strikes >= this.config.maxStrikes) {
      this.finish(() => this.config.onGameOver && this.config.onGameOver('יותר מדי טעויות במיון!'));
    }
  }

  finish(callback) {
    this.state.isRunning = false;
    this.stopLoop();
    this.later(callback, TUNING.pacing.endDelayMs);
  }

  // --- View helpers ---

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timeouts.delete(id);
      fn();
    }, ms);
    this.timeouts.add(id);
  }

  bump(el, kind) {
    if (!el) return;
    el.classList.remove('market-basket--good', 'market-basket--bad');
    void el.offsetWidth;
    el.classList.add(`market-basket--${kind}`);
  }

  showToast(text) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('market-toast--show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('market-toast--show');
  }

  render() {
    const pips = Array.from({ length: this.config.maxStrikes })
      .map(() => '<span class="market-strike-pip" aria-hidden="true"></span>')
      .join('');
    this.container.innerHTML = `
      <style>${START_OVERLAY_STYLES}\n${styles}</style>
      <div class="market-game" dir="rtl">
        <div class="market-hud">
          <div class="market-strikes" aria-label="פספוסים">${pips}</div>
          <span class="market-counter" dir="ltr" aria-label="מוצרים שמוינו">
            <span id="market-sorted">0</span><span class="market-counter-sep">/</span><span>${this.config.toSort}</span>
          </span>
        </div>
        <div class="market-field">
          <div class="market-toast" aria-live="polite"></div>
        </div>
        <div class="market-baskets">
          <button class="market-basket market-basket--fruit" type="button" data-kind="fruit">
            <span class="market-basket-emoji" aria-hidden="true">🧺</span>
            <span class="market-basket-label">פירות</span>
          </button>
          <button class="market-basket market-basket--veg" type="button" data-kind="veg">
            <span class="market-basket-emoji" aria-hidden="true">🧺</span>
            <span class="market-basket-label">ירקות</span>
          </button>
        </div>
      </div>
    `;
  }

  destroy() {
    this.state.isRunning = false;
    this.stopLoop();
    for (const id of this.timeouts) clearTimeout(id);
    this.timeouts.clear();
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.fieldEl) {
      this.fieldEl.removeEventListener('pointerdown', this._onPointerDown);
      this.fieldEl.removeEventListener('pointerup', this._onPointerUp);
      this.fieldEl.removeEventListener('pointercancel', this._onPointerUp);
    }
    const baskets = this.container.querySelector('.market-baskets');
    if (baskets) baskets.removeEventListener('click', this._onBasketClick);
    if (this.removeStartOverlay) {
      this.removeStartOverlay();
      this.removeStartOverlay = null;
    }
    this.state.item = null;
    this.fieldEl = null;
    this.sortedEl = null;
    this.toastEl = null;
    this.basketEls = {};
    this.strikePipsEls = [];
    this.container.innerHTML = '';
  }
}
