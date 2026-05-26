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
    };

    this.isRunning = false;
    this.beltEl = null;
    this.beltSpeed = 0.6; // px per frame at base difficulty
    this.beltOffset = 0;
    this.beltTileWidth = 0; // populated from --belt-tile-w after render
    this.gameLoopId = null;
  }

  start() {
    this.isRunning = true;
    this.render();
    this.beltEl = this.container.querySelector('#pizzatron-belt');
    this.beltTileWidth = this.readBeltTileWidth();
    this.startGameLoop();
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
    this.beltEl = null;
    this.container.innerHTML = '';
  }
}
