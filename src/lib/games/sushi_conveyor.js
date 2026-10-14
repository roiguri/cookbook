import styles from './sushi_conveyor.css?inline';
import { START_OVERLAY_STYLES, showStartOverlay } from './game_start_overlay.js';

// Conveyor game: a customer orders three dishes and waits with a shrinking
// patience bar. Plates ride the belt from right to left; tap the ones in the
// order to send them over. Tapping a dish nobody ordered, or letting the
// customer run out of patience, is a strike. Serve `ordersToWin` orders to
// win; `maxStrikes` loses. Plates that ride off the belt are free to miss.
//
// Plate positions are fractions of the belt width and everything advances
// in one rAF loop on elapsed time, so a resize/rotation rescales the belt
// and pause() (rotate prompt) or a hidden tab freezes it.

const MENU = [
  { key: 'nigiri', emoji: '🍣', he: 'ניגירי' },
  { key: 'onigiri', emoji: '🍙', he: 'אוניגירי' },
  { key: 'tempura', emoji: '🍤', he: 'טמפורה' },
  { key: 'dumpling', emoji: '🥟', he: 'כיסונים' },
  { key: 'bento', emoji: '🍱', he: 'בנטו' },
  { key: 'naruto', emoji: '🍥', he: 'נרוטו' },
];

const TUNING = {
  win: { ordersToWin: 5 },
  miss: { maxStrikes: 3 },
  order: {
    size: 3,
    basePatienceSec: 16,
    patiencePerOrderSec: 1.2,
    minPatienceSec: 10,
  },
  belt: {
    // Belt widths per second; a plate crosses in ~1/speed seconds.
    baseSpeed: 0.1,
    speedPerOrder: 0.012,
    maxSpeed: 0.16,
    spawnEverySec: 1.15,
    // Chance a new plate is something the current order still needs.
    neededChance: 0.5,
    minGapPlates: 1.3, // min centre-to-centre spacing, in plate widths
    maxFrameSec: 0.1,
  },
  pacing: { newOrderDelaySec: 0.6, endDelayMs: 450 },
};

let sushiIntroPending = true;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class SushiConveyorGame {
  static resetSession() {
    sushiIntroPending = true;
  }

  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        ordersToWin: TUNING.win.ordersToWin,
        maxStrikes: TUNING.miss.maxStrikes,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      plates: [], // { id, dish, x, el }
      order: null, // { slots: [{ dish, done }], patience, total }
      served: 0,
      strikes: 0,
      spawnIn: 0,
      orderIn: 0,
      isRunning: false,
      isPaused: false,
    };

    this.beltEl = null;
    this.orderEl = null;
    this.patienceEl = null;
    this.servedEl = null;
    this.toastEl = null;
    this.strikePipsEls = [];
    this.removeStartOverlay = null;
    this.rafId = null;
    this.lastTs = null;
    this.endTimeoutId = null;
    this.plateIdCounter = 0;
    this.firstInteractionFired = false;

    this._loop = this.loop.bind(this);
    this._onBeltClick = this.onBeltClick.bind(this);
  }

  start() {
    this.render();
    this.gameEl = this.container.querySelector('.sushi-game');
    this.beltEl = this.container.querySelector('.sushi-belt');
    this.orderEl = this.container.querySelector('.sushi-order-slots');
    this.patienceEl = this.container.querySelector('.sushi-patience');
    this.customerEl = this.container.querySelector('.sushi-customer');
    this.servedEl = this.container.querySelector('#sushi-served');
    this.toastEl = this.container.querySelector('.sushi-toast');
    this.strikePipsEls = Array.from(this.container.querySelectorAll('.sushi-strike-pip'));
    this.beltEl.addEventListener('click', this._onBeltClick);

    if (sushiIntroPending) {
      sushiIntroPending = false;
      this.removeStartOverlay = showStartOverlay(this.gameEl, {
        emoji: '🍣',
        title: 'מסוע הסושי',
        instructions:
          'הלקוח מזמין שלוש מנות. הקישו על הצלחות המתאימות כשהן עוברות על המסוע, לפני שנגמרת לו הסבלנות. מנה שלא הוזמנה — פספוס.',
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
    this.newOrder();
    // Pre-fill the belt so the first order is playable right away.
    for (let i = 0; i < 4; i++) this.spawnPlate(1 - i * 0.22);
    this.state.spawnIn = TUNING.belt.spawnEverySec;
    if (!this.state.isPaused) this.startLoop();
  }

  // --- Pause (GameWrapper calls these while the rotate prompt is up) ---

  pause() {
    this.state.isPaused = true;
    this.stopLoop();
    if (this.gameEl) this.gameEl.classList.add('sushi-game--paused');
  }

  resume() {
    this.state.isPaused = false;
    if (this.gameEl) this.gameEl.classList.remove('sushi-game--paused');
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

  speed() {
    const { baseSpeed, speedPerOrder, maxSpeed } = TUNING.belt;
    return Math.min(maxSpeed, baseSpeed + this.state.served * speedPerOrder);
  }

  loop(ts) {
    this.rafId = null;
    if (!this.state.isRunning || this.state.isPaused) return;
    const dt =
      this.lastTs === null ? 0 : Math.min(TUNING.belt.maxFrameSec, (ts - this.lastTs) / 1000);
    this.lastTs = ts;

    // Belt
    const v = this.speed();
    for (let i = this.state.plates.length - 1; i >= 0; i--) {
      const p = this.state.plates[i];
      p.x -= v * dt;
      if (p.x < -0.15) {
        p.el.remove();
        this.state.plates.splice(i, 1);
      } else {
        this.positionPlate(p);
      }
    }
    this.state.spawnIn -= dt;
    if (this.state.spawnIn <= 0 && this.hasRoomToSpawn()) {
      this.spawnPlate(1.1);
      this.state.spawnIn = TUNING.belt.spawnEverySec;
    }

    // Customer
    const order = this.state.order;
    if (order) {
      order.patience -= dt;
      this.paintPatience();
      if (order.patience <= 0) {
        this.state.order = null;
        this.customerEl.dataset.mood = 'angry';
        this.addStrike('הלקוח התעצבן!');
        if (!this.state.isRunning) return;
        this.state.orderIn = TUNING.pacing.newOrderDelaySec;
      }
    } else {
      this.state.orderIn -= dt;
      if (this.state.orderIn <= 0) this.newOrder();
    }

    this.rafId = requestAnimationFrame(this._loop);
  }

  // --- Orders & plates ---

  patienceSec() {
    const { basePatienceSec, patiencePerOrderSec, minPatienceSec } = TUNING.order;
    return Math.max(minPatienceSec, basePatienceSec - this.state.served * patiencePerOrderSec);
  }

  newOrder() {
    const menu = [...MENU];
    const slots = [];
    for (let i = 0; i < TUNING.order.size; i++) {
      const dish = menu.splice(Math.floor(Math.random() * menu.length), 1)[0];
      slots.push({ dish, done: false });
    }
    const total = this.patienceSec();
    this.state.order = { slots, patience: total, total };
    this.customerEl.dataset.mood = 'waiting';
    this.paintOrder();
    this.paintPatience();
  }

  neededDishes() {
    const order = this.state.order;
    return order ? order.slots.filter((s) => !s.done).map((s) => s.dish) : [];
  }

  // On a narrow belt (portrait after "continue anyway", or right after a
  // rotation) the time-based interval alone would overlap plates. Hold the
  // next plate until the rightmost one has moved at least 1.3 plate-widths.
  hasRoomToSpawn() {
    // Rightmost plate = the one most recently on the belt.
    const newest = this.state.plates.reduce((a, p) => (!a || p.x > a.x ? p : a), null);
    const beltW = this.beltEl ? this.beltEl.clientWidth : 0;
    if (!newest || !beltW) return true;
    const minGap = (newest.el.offsetWidth * TUNING.belt.minGapPlates) / beltW;
    return 1.1 - newest.x >= minGap;
  }

  spawnPlate(x) {
    const needed = this.neededDishes();
    const dish =
      needed.length && Math.random() < TUNING.belt.neededChance ? pick(needed) : pick(MENU);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sushi-plate';
    el.dataset.dish = dish.key;
    el.setAttribute('aria-label', dish.he);
    el.innerHTML = '<span class="sushi-plate-dish" aria-hidden="true"></span>';
    el.firstChild.textContent = dish.emoji;
    this.beltEl.appendChild(el);
    const plate = { id: ++this.plateIdCounter, dish, x, el };
    this.state.plates.push(plate);
    this.positionPlate(plate);
  }

  positionPlate(p) {
    p.el.style.setProperty('--x', p.x.toFixed(4));
  }

  onBeltClick(e) {
    const el = e.target.closest('.sushi-plate');
    if (!el || !this.state.isRunning || this.state.isPaused) return;
    const idx = this.state.plates.findIndex((p) => p.el === el);
    if (idx === -1) return;
    const plate = this.state.plates[idx];
    this.state.plates.splice(idx, 1);

    const order = this.state.order;
    const slot = order && order.slots.find((s) => !s.done && s.dish === plate.dish);
    if (!slot) {
      el.classList.add('sushi-plate--wrong');
      setTimeout(() => el.remove(), 300);
      this.addStrike(order ? 'לא הזמינו את זה!' : 'אין הזמנה כרגע!');
      return;
    }

    el.classList.add('sushi-plate--taken');
    setTimeout(() => el.remove(), 300);
    slot.done = true;
    this.paintOrder();
    if (order.slots.every((s) => s.done)) this.serveOrder();
  }

  serveOrder() {
    this.state.order = null;
    this.state.served += 1;
    if (this.servedEl) this.servedEl.textContent = String(this.state.served);
    this.customerEl.dataset.mood = 'happy';
    this.showToast('בתיאבון!', true);
    if (this.state.served >= this.config.ordersToWin) {
      this.finish(() => this.config.onComplete && this.config.onComplete());
      return;
    }
    this.state.orderIn = TUNING.pacing.newOrderDelaySec;
  }

  addStrike(text) {
    this.state.strikes += 1;
    const pip = this.strikePipsEls[this.state.strikes - 1];
    if (pip) pip.classList.add('sushi-strike-pip--filled');
    this.showToast(text, false);
    if (this.state.strikes >= this.config.maxStrikes) {
      this.finish(() => this.config.onGameOver && this.config.onGameOver('הלקוחות יצאו רעבים!'));
    }
  }

  finish(callback) {
    this.state.isRunning = false;
    this.stopLoop();
    this.endTimeoutId = setTimeout(() => {
      this.endTimeoutId = null;
      callback();
    }, TUNING.pacing.endDelayMs);
  }

  // --- View ---

  paintOrder() {
    const order = this.state.order;
    if (!order) {
      this.orderEl.innerHTML = '';
      return;
    }
    this.orderEl.innerHTML = order.slots
      .map(
        (s) =>
          `<span class="sushi-slot${s.done ? ' sushi-slot--done' : ''}" data-dish="${s.dish.key}" title="${s.dish.he}">${s.dish.emoji}</span>`,
      )
      .join('');
  }

  paintPatience() {
    const order = this.state.order;
    const frac = order ? Math.max(0, order.patience / order.total) : 0;
    this.patienceEl.style.setProperty('--patience', frac.toFixed(3));
    this.patienceEl.dataset.low = frac < 0.3 ? 'true' : 'false';
  }

  showToast(text, good) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.className = `sushi-toast sushi-toast--${good ? 'good' : 'bad'}`;
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('sushi-toast--show');
  }

  render() {
    const pips = Array.from({ length: this.config.maxStrikes })
      .map(() => '<span class="sushi-strike-pip" aria-hidden="true"></span>')
      .join('');
    this.container.innerHTML = `
      <style>${START_OVERLAY_STYLES}\n${styles}</style>
      <div class="sushi-game" dir="rtl">
        <div class="sushi-hud">
          <div class="sushi-strikes" aria-label="פספוסים">${pips}</div>
          <span class="sushi-counter" dir="ltr" aria-label="הזמנות שהוגשו">
            🧾 <span id="sushi-served">0</span><span class="sushi-counter-sep">/</span><span>${this.config.ordersToWin}</span>
          </span>
        </div>
        <div class="sushi-counter-area">
          <div class="sushi-customer" data-mood="waiting" aria-hidden="true"></div>
          <div class="sushi-order">
            <div class="sushi-order-title">ההזמנה</div>
            <div class="sushi-order-slots" aria-live="polite"></div>
            <div class="sushi-patience" aria-label="סבלנות הלקוח"><span></span></div>
          </div>
          <div class="sushi-toast" aria-live="polite"></div>
        </div>
        <div class="sushi-belt"></div>
      </div>
    `;
  }

  destroy() {
    this.state.isRunning = false;
    this.stopLoop();
    clearTimeout(this.endTimeoutId);
    this.endTimeoutId = null;
    if (this.beltEl) this.beltEl.removeEventListener('click', this._onBeltClick);
    if (this.removeStartOverlay) {
      this.removeStartOverlay();
      this.removeStartOverlay = null;
    }
    this.state.plates = [];
    this.state.order = null;
    this.gameEl = null;
    this.beltEl = null;
    this.orderEl = null;
    this.patienceEl = null;
    this.customerEl = null;
    this.servedEl = null;
    this.toastEl = null;
    this.strikePipsEls = [];
    this.container.innerHTML = '';
  }
}
