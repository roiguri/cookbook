import styles from './pizzatron.css?inline';

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
    };

    this.isRunning = false;
    this.beltEl = null;
    this.beltTrackEl = null;
    this.beltSpeed = 0.6; // px per frame at base difficulty
    this.beltOffset = 0;
    this.beltTileWidth = 0; // populated from --belt-tile-w after render
    this.gameLoopId = null;
    this.spawnerId = null;
    this.spawnRate = 4500; // ms between pizzas at base difficulty
    this.pizzaIdCounter = 0;
    this.pizzaSize = 110; // matches .pizzatron-pizza width/height in CSS
    this.pizzaStartX = -this.pizzaSize; // off-screen left at spawn
    this.pizzaArrivalX = 0; // computed at start from box position
    this.pizzaHoldMs = 900; // dwell time inside the box after arrival
  }

  start() {
    this.isRunning = true;
    this.render();
    this.beltEl = this.container.querySelector('#pizzatron-belt');
    this.beltTrackEl = this.container.querySelector('.pizzatron-belt-track');
    this.beltTileWidth = this.readBeltTileWidth();
    this.pizzaArrivalX = this.computeArrivalX();
    this.startGameLoop();
    this.startSpawner();
    this.spawnPizza();
  }

  computeArrivalX() {
    // Box center sits at trackWidth + box.right - box.width / 2 (with right
    // measured from the track's right edge). Current box: right -32px, width
    // 170 → box center ≈ trackW - 53. Pizza center should land there, and
    // pizza.x is the pizza's left edge.
    const trackW = this.beltTrackEl ? this.beltTrackEl.offsetWidth : 0;
    return trackW - 53 - this.pizzaSize / 2;
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
    this.beltOffset = (this.beltOffset + this.beltSpeed) % this.beltTileWidth;
    this.beltEl.style.backgroundPositionX = `${this.beltOffset}px`;

    for (const p of this.state.belt) {
      if (p.phase !== 'riding') continue;
      p.x += this.beltSpeed;
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
    p.removalTimer = setTimeout(() => this.removePizza(p), this.pizzaHoldMs);
  }

  removePizza(p) {
    if (p.removalTimer) {
      clearTimeout(p.removalTimer);
      p.removalTimer = null;
    }
    p.pizzaEl.classList.add('leaving');
    setTimeout(() => {
      p.pizzaEl.remove();
      const idx = this.state.belt.indexOf(p);
      if (idx >= 0) this.state.belt.splice(idx, 1);
    }, 220); // matches .pizzatron-pizza opacity transition
  }

  startSpawner() {
    this.spawnerId = setInterval(() => {
      if (!this.isRunning) return;
      this.spawnPizza();
    }, this.spawnRate);
  }

  spawnPizza() {
    if (!this.beltTrackEl) return;
    const id = ++this.pizzaIdCounter;
    const el = document.createElement('div');
    el.className = 'pizzatron-pizza';
    el.dataset.pizzaId = String(id);
    el.style.transform = `translateX(${this.pizzaStartX}px)`;

    const markEl = document.createElement('div');
    markEl.className = 'pizzatron-pizza-mark';
    el.appendChild(markEl);

    this.beltTrackEl.appendChild(el);
    this.state.belt.push({
      id,
      x: this.pizzaStartX,
      phase: 'riding',
      pizzaEl: el,
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
    for (const p of this.state.belt) {
      if (p.removalTimer) clearTimeout(p.removalTimer);
    }
    this.state.belt = [];
    this.beltEl = null;
    this.beltTrackEl = null;
    this.container.innerHTML = '';
  }
}
