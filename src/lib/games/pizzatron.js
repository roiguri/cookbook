import styles from './pizzatron.css?inline';

const TOPPING_POOL = ['tomato', 'mushroom', 'olive', 'pepper', 'sausage', 'basil'];

// One-stop gameplay tuning. Visual sizing of the order label lives in
// pizzatron.css (.pizzatron-pizza-order*). Pizza diameter is tuned here AND
// in CSS — keep .pizzatron-pizza width/height in sync with pizza.sizePx.
const TUNING = {
  belt: { speedPxPerFrame: 0.6 },
  spawn: { intervalMs: 6000 },
  pizza: { sizePx: 110, holdMsOnArrival: 900, fadeOutMs: 220 },
  order: {
    baseTypes: 2,
    rampPerSpawns: 4, // +1 topping type every N spawns
    typesCap: 5,
    perTypeMin: 1,
    perTypeRange: 2, // result is perTypeMin..(perTypeMin + perTypeRange - 1)
  },
};

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class PizzatronGame {
  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        ordersToWin: 10,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      ordersCompleted: 0,
      ordersToWin: this.config.ordersToWin,
      belt: [],
      spawnCounter: 0,
    };

    this.isRunning = false;
    this.beltEl = null;
    this.beltTrackEl = null;
    this.beltOffset = 0;
    this.beltTileWidth = 0; // populated from --belt-tile-w after render
    this.gameLoopId = null;
    this.spawnerId = null;
    this.pizzaIdCounter = 0;
    this.pizzaArrivalX = 0; // computed at start from box position
  }

  start() {
    this.isRunning = true;
    this.render();
    this.beltEl = this.container.querySelector('#pizzatron-belt');
    this.beltTrackEl = this.container.querySelector('.pizzatron-belt-track');
    this.boxEl = this.container.querySelector('.pizzatron-box');
    this.beltTileWidth = this.readBeltTileWidth();
    this.pizzaArrivalX = this.computeArrivalX();
    this._onResize = () => {
      this.pizzaArrivalX = this.computeArrivalX();
    };
    window.addEventListener('resize', this._onResize);
    this.startGameLoop();
    this.startSpawner();
    this.spawnPizza();
  }

  computeArrivalX() {
    // Derive the arrival point from the box element's actual layout so the
    // pizza stops in the same spot regardless of window width or any future
    // CSS tweak to box positioning. offsetLeft/offsetWidth are relative to
    // the belt-track (the nearest positioned ancestor), matching pizza.x.
    if (!this.boxEl) return 0;
    const boxCenter = this.boxEl.offsetLeft + this.boxEl.offsetWidth / 2;
    return boxCenter - TUNING.pizza.sizePx / 2;
  }

  readBeltTileWidth() {
    if (!this.beltEl) return 192;
    const raw = getComputedStyle(this.beltEl).getPropertyValue('--belt-tile-w').trim();
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 192;
  }

  startGameLoop() {
    const loop = () => {
      if (!this.isRunning) return;
      this.advanceBelt();
      this.gameLoopId = requestAnimationFrame(loop);
    };
    this.gameLoopId = requestAnimationFrame(loop);
  }

  advanceBelt() {
    if (!this.beltEl || this.beltTileWidth <= 0) return;
    const speed = TUNING.belt.speedPxPerFrame;
    this.beltOffset = (this.beltOffset + speed) % this.beltTileWidth;
    this.beltEl.style.backgroundPositionX = `${this.beltOffset}px`;

    for (const p of this.state.belt) {
      if (p.phase !== 'riding') continue;
      p.x += speed;
      if (p.x >= this.pizzaArrivalX) {
        p.x = this.pizzaArrivalX;
        this.handlePizzaArrival(p);
      }
      p.pizzaEl.style.transform = `translateX(${p.x}px)`;
    }
  }

  handlePizzaArrival(p) {
    p.phase = 'arrived';
    p.pizzaEl.classList.add('arrived');
    // Placeholder: every arrival shows the success mark for now. Step 2d will
    // compute isCorrect() here and swap in --bad + onGameOver for failures.
    p.markEl.textContent = '✓';
    p.removalTimer = setTimeout(() => this.removePizza(p), TUNING.pizza.holdMsOnArrival);
  }

  removePizza(p) {
    if (p.removalTimer) {
      clearTimeout(p.removalTimer);
      p.removalTimer = null;
    }
    p.pizzaEl.classList.add('leaving');
    // setTimeout duration must match the .pizzatron-pizza opacity transition.
    setTimeout(() => {
      p.pizzaEl.remove();
      const idx = this.state.belt.indexOf(p);
      if (idx >= 0) this.state.belt.splice(idx, 1);
    }, TUNING.pizza.fadeOutMs);
  }

  startSpawner() {
    this.spawnerId = setInterval(() => {
      if (!this.isRunning) return;
      this.spawnPizza();
    }, TUNING.spawn.intervalMs);
  }

  generateOrder(difficulty) {
    const cfg = TUNING.order;
    const numTypes = Math.min(
      cfg.baseTypes + Math.floor(difficulty / cfg.rampPerSpawns),
      cfg.typesCap,
    );
    const types = shuffleInPlace([...TOPPING_POOL]).slice(0, numTypes);
    const order = {};
    for (const t of types) {
      order[t] = cfg.perTypeMin + Math.floor(Math.random() * cfg.perTypeRange);
    }
    return order;
  }

  buildOrderLabel(requiredToppings) {
    const label = document.createElement('div');
    label.className = 'pizzatron-pizza-order';
    for (const [type, count] of Object.entries(requiredToppings)) {
      const item = document.createElement('span');
      item.className = 'pizzatron-pizza-order-item';
      const icon = document.createElement('span');
      icon.className = `pizzatron-pizza-order-icon pizzatron-pizza-order-icon--${type}`;
      const countEl = document.createElement('span');
      countEl.className = 'pizzatron-pizza-order-count';
      countEl.textContent = `×${count}`;
      item.appendChild(icon);
      item.appendChild(countEl);
      label.appendChild(item);
    }
    return label;
  }

  spawnPizza() {
    if (!this.beltTrackEl) return;
    const id = ++this.pizzaIdCounter;
    const requiredToppings = this.generateOrder(this.state.spawnCounter);
    this.state.spawnCounter += 1;

    const el = document.createElement('div');
    el.className = 'pizzatron-pizza';
    el.dataset.pizzaId = String(id);
    el.style.transform = `translateX(${-TUNING.pizza.sizePx}px)`;

    const labelEl = this.buildOrderLabel(requiredToppings);
    el.appendChild(labelEl);

    const markEl = document.createElement('div');
    markEl.className = 'pizzatron-pizza-mark';
    el.appendChild(markEl);

    this.beltTrackEl.appendChild(el);
    this.state.belt.push({
      id,
      x: -TUNING.pizza.sizePx,
      phase: 'riding',
      requiredToppings,
      currentToppings: {},
      pizzaEl: el,
      labelEl,
      markEl,
      removalTimer: null,
    });
  }

  render() {
    this.container.innerHTML = `
      <style>${styles}</style>
      <div class="pizzatron-game" dir="rtl">
        <div class="pizzatron-hud">
          <span class="pizzatron-counter" dir="ltr" aria-label="הזמנות שהושלמו">
            <span id="pizzatron-orders-done">${this.state.ordersCompleted}</span><span class="pizzatron-counter-sep">/</span><span id="pizzatron-orders-total">${this.state.ordersToWin}</span>
          </span>
        </div>
        <div class="pizzatron-belt-zone" id="pizzatron-belt-zone">
          <div class="pizzatron-belt-track">
            <div class="pizzatron-belt" id="pizzatron-belt"></div>
            <div class="pizzatron-box"></div>
          </div>
        </div>
        <div class="pizzatron-tray" id="pizzatron-tray"></div>
      </div>
    `;
  }

  destroy() {
    this.isRunning = false;
    if (this.gameLoopId) {
      cancelAnimationFrame(this.gameLoopId);
      this.gameLoopId = null;
    }
    if (this.spawnerId) {
      clearInterval(this.spawnerId);
      this.spawnerId = null;
    }
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    for (const p of this.state.belt) {
      if (p.removalTimer) clearTimeout(p.removalTimer);
    }
    this.state.belt = [];
    this.beltEl = null;
    this.beltTrackEl = null;
    this.boxEl = null;
    this.container.innerHTML = '';
  }
}
