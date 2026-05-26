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
  }

  start() {
    this.isRunning = true;
    this.render();
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
    this.container.innerHTML = '';
  }
}
