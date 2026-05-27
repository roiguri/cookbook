import styles from './pizzatron.css?inline';

// Order matters: only the first TUNING.order.activeIngredients items appear
// in the tray. Items beyond that index are kept as a deferred reserve so they
// can be promoted into the active set later by reordering this array.
const TOPPING_POOL = ['basil', 'mushroom', 'olive', 'pepper', 'sausage', 'tomato'];

// One-stop gameplay tuning. Visual sizing of the order label lives in
// pizzatron.css (.pizzatron-pizza-order*). Pizza diameter is tuned here AND
// in CSS — keep .pizzatron-pizza width/height in sync with pizza.sizePx.
const TUNING = {
  belt: {
    // speed grows linearly from baseSpeed toward (baseSpeed + ramp*rampMax)
    // as state.spawnCounter rises, then clamps.
    baseSpeedPxPerFrame: 0.6,
    rampPerSpawn: 0.06,
    maxRampSpawns: 10,
  },
  spawn: {
    // interval shrinks from baseIntervalMs toward minIntervalMs as
    // state.spawnCounter rises (also linear, also clamped).
    baseIntervalMs: 6000,
    decreasePerSpawnMs: 250,
    minIntervalMs: 3500,
  },
  pizza: { sizePx: 110, holdMsOnArrival: 900, fadeOutMs: 220 },
  order: {
    // Only the first `activeIngredients` items of TOPPING_POOL appear in
    // the tray. typesCap limits how many distinct types appear in any single
    // ORDER (independent of how many baskets are in the tray).
    activeIngredients: 5,
    baseTypes: 2,
    rampPerSpawns: 4, // +1 topping type every N spawns
    typesCap: 3,
    perTypeMin: 1,
    perTypeRange: 2, // result is perTypeMin..(perTypeMin + perTypeRange - 1)
  },
  topping: {
    sizePx: 22, // displayed size of a topping on a pizza
    spiralScale: 9, // tune so toppings stay within the pizza at high counts
    rotationJitterDeg: 30,
  },
};

const GOLDEN_ANGLE = (137.5 * Math.PI) / 180;

// Module-level: the start overlay is an onboarding cue, not a per-game gate.
// Show it the first time Pizzatron mounts in a page session; restarts via
// "שחק שוב" (which destroy+re-init the game instance) skip straight into play.
let pizzatronIntroPending = true;

function getActiveToppings() {
  return TOPPING_POOL.slice(0, TUNING.order.activeIngredients);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class PizzatronGame {
  // GameWrapper.create() calls this on every fresh tile click so the intro
  // overlay re-appears on each new entry to the game. wrapper.restart()
  // doesn't call this — restarts within a session stay intro-free.
  static resetSession() {
    pizzatronIntroPending = true;
  }

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
    this.drag = null; // active drag: { type, ghost, pointerId, originEl }
    this.firstInteractionFired = false;

    this._onTrayPointerDown = this.onTrayPointerDown.bind(this);
    this._onDragMove = this.onDragMove.bind(this);
    this._onDragEnd = this.onDragEnd.bind(this);
  }

  start() {
    // start() does layout + listener setup only. The actual gameplay loops
    // don't fire until the player presses the Start overlay button — that
    // way they have a beat to read the controls and we sync the wrapper
    // timer to "press to begin" rather than "first drag".
    this.isRunning = false;
    this.render();
    this.beltEl = this.container.querySelector('#pizzatron-belt');
    this.beltTrackEl = this.container.querySelector('.pizzatron-belt-track');
    this.boxEl = this.container.querySelector('.pizzatron-box');
    this.trayEl = this.container.querySelector('#pizzatron-tray');
    this.renderTray();
    this.beltTileWidth = this.readBeltTileWidth();
    this.pizzaArrivalX = this.computeArrivalX();
    this._onResize = () => {
      this.pizzaArrivalX = this.computeArrivalX();
    };
    window.addEventListener('resize', this._onResize);
    this.trayEl.addEventListener('pointerdown', this._onTrayPointerDown);
    if (pizzatronIntroPending) {
      pizzatronIntroPending = false;
      this.showStartOverlay();
    } else {
      this.beginPlay();
    }
  }

  showStartOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'pizzatron-start-overlay';
    overlay.innerHTML = `
      <div class="pizzatron-start-card">
        <div class="pizzatron-start-emoji" aria-hidden="true">🍕</div>
        <h3 class="pizzatron-start-title">הפיצריה</h3>
        <p class="pizzatron-start-instructions">
          גררו את המרכיבים מהסלסלות לפיצות כדי להשלים הזמנות.
          השלימו 10 הזמנות מהר ככל האפשר.
        </p>
        <button class="pizzatron-start-btn" type="button">התחל</button>
      </div>
    `;
    const gameEl = this.container.querySelector('.pizzatron-game');
    if (!gameEl) return;
    gameEl.appendChild(overlay);
    this.startOverlayEl = overlay;
    this._onStartClick = () => this.beginPlay();
    overlay.querySelector('.pizzatron-start-btn').addEventListener('click', this._onStartClick);
  }

  beginPlay() {
    if (this.startOverlayEl) {
      this.startOverlayEl.remove();
      this.startOverlayEl = null;
    }
    if (this.isRunning) return;
    // Recompute the arrival point right before play starts. When the games
    // page launches us inside a fullscreen modal, init() runs while the
    // modal is still display:none, so the box element reports width=0 and
    // pizzaArrivalX gets pinned to a small negative value. By the time the
    // player presses Start the modal is open and layout is settled, so
    // this read finally returns the real position.
    this.pizzaArrivalX = this.computeArrivalX();
    this.isRunning = true;
    // Fire onInteraction here so the wrapper timer starts at "press Start"
    // rather than waiting for the first topping drag.
    if (!this.firstInteractionFired && this.config.onInteraction) {
      this.firstInteractionFired = true;
      this.config.onInteraction();
    }
    this.startGameLoop();
    this.startSpawner();
    this.spawnPizza();
  }

  renderTray() {
    if (!this.trayEl) return;
    this.trayEl.innerHTML = '';
    const content = document.createElement('div');
    content.className = 'pizzatron-tray-content';
    for (const type of getActiveToppings()) {
      const basket = document.createElement('div');
      basket.className = `pizzatron-tray-basket pizzatron-tray-basket--${type}`;
      basket.dataset.topping = type;
      basket.setAttribute('role', 'button');
      basket.setAttribute('aria-label', `סלסלת ${type}`);
      content.appendChild(basket);
    }
    this.trayEl.appendChild(content);
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

  currentBeltSpeed() {
    const { baseSpeedPxPerFrame, rampPerSpawn, maxRampSpawns } = TUNING.belt;
    const t = Math.min(this.state.spawnCounter, maxRampSpawns);
    return baseSpeedPxPerFrame + t * rampPerSpawn;
  }

  currentSpawnInterval() {
    const { baseIntervalMs, decreasePerSpawnMs, minIntervalMs } = TUNING.spawn;
    return Math.max(minIntervalMs, baseIntervalMs - this.state.spawnCounter * decreasePerSpawnMs);
  }

  advanceBelt() {
    if (!this.beltEl || this.beltTileWidth <= 0) return;
    const speed = this.currentBeltSpeed();
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
    const correct = this.isCorrect(p.currentToppings, p.requiredToppings);
    if (correct) {
      p.markEl.textContent = '✓';
      p.removalTimer = setTimeout(() => {
        this.removePizza(p);
        this.onCorrectOrder();
      }, TUNING.pizza.holdMsOnArrival);
    } else {
      p.markEl.textContent = '✗';
      p.markEl.classList.add('pizzatron-pizza-mark--bad');
      // Freeze the rest of the game immediately so other pizzas don't keep
      // sliding during the hold — but leave this pizza visible as evidence.
      this.isRunning = false;
      if (this.spawnerId) {
        clearTimeout(this.spawnerId);
        this.spawnerId = null;
      }
      p.removalTimer = setTimeout(() => this.onWrongOrder(p), TUNING.pizza.holdMsOnArrival);
    }
  }

  isCorrect(current, required) {
    const keys = new Set([...Object.keys(current), ...Object.keys(required)]);
    for (const k of keys) {
      if ((current[k] || 0) !== (required[k] || 0)) return false;
    }
    return true;
  }

  onCorrectOrder() {
    this.state.ordersCompleted += 1;
    const doneEl = this.container.querySelector('#pizzatron-orders-done');
    if (doneEl) doneEl.textContent = String(this.state.ordersCompleted);
    if (this.state.ordersCompleted >= this.state.ordersToWin) {
      this.isRunning = false;
      if (this.spawnerId) {
        clearTimeout(this.spawnerId);
        this.spawnerId = null;
      }
      if (this.config.onComplete) this.config.onComplete();
    }
  }

  onWrongOrder(pizza) {
    const reason = this.buildFailureReason(pizza);
    if (this.config.onGameOver) this.config.onGameOver(reason);
  }

  buildFailureReason(pizza) {
    const required = pizza.requiredToppings;
    const current = pizza.currentToppings;
    const keys = new Set([...Object.keys(required), ...Object.keys(current)]);
    let hasMissing = false;
    let hasExtra = false;
    for (const k of keys) {
      const r = required[k] || 0;
      const c = current[k] || 0;
      if (c < r) hasMissing = true;
      else if (c > r) hasExtra = true;
    }
    if (hasMissing && !hasExtra) return 'חסרים מרכיבים בפיצה!';
    if (hasExtra && !hasMissing) return 'יותר מדי מרכיבים בפיצה!';
    return 'בוצעה הזמנה שגויה!';
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
    const tick = () => {
      if (!this.isRunning) return;
      this.spawnPizza();
      this.spawnerId = setTimeout(tick, this.currentSpawnInterval());
    };
    this.spawnerId = setTimeout(tick, this.currentSpawnInterval());
  }

  generateOrder(difficulty) {
    const cfg = TUNING.order;
    const active = getActiveToppings();
    const numTypes = Math.min(
      cfg.baseTypes + Math.floor(difficulty / cfg.rampPerSpawns),
      cfg.typesCap,
      active.length,
    );
    const types = shuffleInPlace([...active]).slice(0, numTypes);
    const order = {};
    for (const t of types) {
      order[t] = cfg.perTypeMin + Math.floor(Math.random() * cfg.perTypeRange);
    }
    return order;
  }

  buildOrderLabel(requiredToppings) {
    const label = document.createElement('div');
    label.className = 'pizzatron-pizza-order';
    const itemEls = {};
    for (const [type, count] of Object.entries(requiredToppings)) {
      const item = document.createElement('span');
      item.className = 'pizzatron-pizza-order-item';
      item.dataset.toppingType = type;
      const icon = document.createElement('span');
      icon.className = `pizzatron-pizza-order-icon pizzatron-pizza-order-icon--${type}`;
      const countEl = document.createElement('span');
      countEl.className = 'pizzatron-pizza-order-count';
      countEl.textContent = `×${count}`;
      item.appendChild(icon);
      item.appendChild(countEl);
      label.appendChild(item);
      itemEls[type] = item;
    }
    return { label, itemEls };
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

    const { label: labelEl, itemEls: labelItemEls } = this.buildOrderLabel(requiredToppings);
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
      placedTotal: 0, // total toppings placed; drives the sunflower spiral index
      pizzaEl: el,
      labelEl,
      labelItemEls,
      markEl,
      removalTimer: null,
    });
  }

  // --- Drag and drop ---

  onTrayPointerDown(e) {
    const basket = e.target.closest('.pizzatron-tray-basket');
    if (!basket) return;
    const type = basket.dataset.topping;
    if (!type) return;
    e.preventDefault();

    const ghost = document.createElement('div');
    ghost.className = `pizzatron-drag-ghost pizzatron-drag-ghost--${type}`;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    document.body.appendChild(ghost);

    this.drag = { type, ghost, pointerId: e.pointerId, originEl: basket };

    try {
      basket.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture may throw if the pointer is no longer active */
    }
    basket.addEventListener('pointermove', this._onDragMove);
    basket.addEventListener('pointerup', this._onDragEnd);
    basket.addEventListener('pointercancel', this._onDragEnd);
  }

  onDragMove(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.drag.ghost.style.left = `${e.clientX}px`;
    this.drag.ghost.style.top = `${e.clientY}px`;
  }

  onDragEnd(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const { type, ghost, pointerId, originEl } = this.drag;

    const target = this.findPizzaUnder(e.clientX, e.clientY);
    if (target) {
      this.addTopping(target, type);
    }

    ghost.remove();
    try {
      originEl.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
    originEl.removeEventListener('pointermove', this._onDragMove);
    originEl.removeEventListener('pointerup', this._onDragEnd);
    originEl.removeEventListener('pointercancel', this._onDragEnd);
    this.drag = null;
  }

  findPizzaUnder(clientX, clientY) {
    // Iterate in reverse so newer (rightmost) pizzas win when overlapping.
    for (let i = this.state.belt.length - 1; i >= 0; i--) {
      const p = this.state.belt[i];
      if (p.phase !== 'riding') continue;
      const rect = p.pizzaEl.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return p;
      }
    }
    return null;
  }

  addTopping(pizza, type) {
    pizza.currentToppings[type] = (pizza.currentToppings[type] || 0) + 1;
    pizza.placedTotal += 1;

    const pos = this.placeNthTopping(pizza.placedTotal);
    const toppingEl = document.createElement('div');
    toppingEl.className = `pizzatron-topping pizzatron-topping--${type}`;
    toppingEl.style.transform = `translate(${pos.x}px, ${pos.y}px) rotate(${pos.rotation}deg)`;
    pizza.pizzaEl.appendChild(toppingEl);

    // Mark this topping fulfilled in the order label once the count matches.
    const required = pizza.requiredToppings[type] || 0;
    const current = pizza.currentToppings[type];
    const itemEl = pizza.labelItemEls[type];
    if (itemEl && required > 0 && current >= required) {
      itemEl.classList.add('fulfilled');
    }

    if (!this.firstInteractionFired && this.config.onInteraction) {
      this.firstInteractionFired = true;
      this.config.onInteraction();
    }
  }

  placeNthTopping(n) {
    const pizzaRadius = TUNING.pizza.sizePx / 2;
    const toppingRadius = TUNING.topping.sizePx / 2;
    const angle = n * GOLDEN_ANGLE;
    const r = Math.sqrt(n) * TUNING.topping.spiralScale;
    const clamped = Math.min(r, pizzaRadius - toppingRadius);
    return {
      x: Math.cos(angle) * clamped,
      y: Math.sin(angle) * clamped,
      rotation: Math.random() * TUNING.topping.rotationJitterDeg,
    };
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
      clearTimeout(this.spawnerId);
      this.spawnerId = null;
    }
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this.trayEl) {
      this.trayEl.removeEventListener('pointerdown', this._onTrayPointerDown);
    }
    if (this.startOverlayEl) {
      this.startOverlayEl.remove();
      this.startOverlayEl = null;
    }
    if (this.drag) {
      this.drag.ghost.remove();
      try {
        this.drag.originEl.releasePointerCapture(this.drag.pointerId);
      } catch {
        /* already released */
      }
      this.drag.originEl.removeEventListener('pointermove', this._onDragMove);
      this.drag.originEl.removeEventListener('pointerup', this._onDragEnd);
      this.drag.originEl.removeEventListener('pointercancel', this._onDragEnd);
      this.drag = null;
    }
    for (const p of this.state.belt) {
      if (p.removalTimer) clearTimeout(p.removalTimer);
    }
    this.state.belt = [];
    this.beltEl = null;
    this.beltTrackEl = null;
    this.boxEl = null;
    this.trayEl = null;
    this.container.innerHTML = '';
  }
}
