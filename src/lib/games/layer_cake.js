import styles from './layer_cake.css?inline';
import { START_OVERLAY_STYLES, showStartOverlay } from './game_start_overlay.js';

// Stacking game: a cake layer slides back and forth above the cake. Tap to
// drop it. Whatever hangs over the layer below is trimmed off and falls, so
// the cake narrows with every sloppy drop. A drop that misses the cake
// entirely loses; stacking `toStack` layers wins. A near-perfect drop snaps
// into place with no trim.
//
// Horizontal positions and widths are fractions of the field width, and the
// layer height is a fraction of the field height (CSS container units), so a
// rotation or resize just rescales the cake. Everything moves in one rAF
// loop on elapsed time; pause() (rotate prompt) or a hidden tab freezes it.

const FLAVORS = ['sponge', 'pistachio', 'chocolate', 'strawberry'];

const TUNING = {
  win: { toStack: 20 },
  base: { width: 0.6 },
  slide: {
    // Field widths per second; speeds up with every layer.
    baseSpeed: 0.55,
    speedPerLayer: 0.045,
    maxSpeed: 1.35,
    // How far past each edge a layer may slide, as a fraction of its width.
    overhang: 0.75,
    // Distance the layer travels past the cake's edge at each end.
    clearance: 0.05,
    maxFrameSec: 0.1,
  },
  perfect: { tolerance: 0.012 },
  camera: { keepBelow: 6 }, // start scrolling once the cake is this tall
  pacing: { trimFallMs: 700, endDelayMs: 650 },
};

let layerCakeIntroPending = true;

export class LayerCakeGame {
  static resetSession() {
    layerCakeIntroPending = true;
  }

  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        toStack: TUNING.win.toStack,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      layers: [], // placed: { left, width } — index 0 is the base
      moving: null, // { left, width, dir, el }
      isRunning: false,
      isPaused: false,
      perfectStreak: 0,
    };

    this.fieldEl = null;
    this.stackEl = null;
    this.stackedEl = null;
    this.toastEl = null;
    this.removeStartOverlay = null;
    this.rafId = null;
    this.lastTs = null;
    this.timeouts = new Set();
    this.firstInteractionFired = false;

    this._loop = this.loop.bind(this);
    this._onPointerDown = this.onPointerDown.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  start() {
    this.render();
    this.gameEl = this.container.querySelector('.cake-game');
    this.fieldEl = this.container.querySelector('.cake-field');
    this.stackEl = this.container.querySelector('.cake-stack');
    this.stackedEl = this.container.querySelector('#cake-stacked');
    this.toastEl = this.container.querySelector('.cake-toast');
    this.fieldEl.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('keydown', this._onKeyDown);

    // Base layer sits on the plate from the start.
    const baseWidth = TUNING.base.width;
    this.placeLayer({ left: (1 - baseWidth) / 2, width: baseWidth });

    if (layerCakeIntroPending) {
      layerCakeIntroPending = false;
      this.removeStartOverlay = showStartOverlay(this.gameEl, {
        emoji: '🎂',
        title: 'עוגת שכבות',
        instructions: `שכבה זזה מעל העוגה — הקישו כדי להניח אותה. מה שבולט מעבר לשכבה שמתחת נחתך. פספסתם לגמרי? העוגה נגמרה. בנו ${this.config.toStack} שכבות!`,
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
    this.spawnMoving();
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

  stackedCount() {
    // The base doesn't count toward the goal.
    return this.state.layers.length - 1;
  }

  speed() {
    const { baseSpeed, speedPerLayer, maxSpeed } = TUNING.slide;
    return Math.min(maxSpeed, baseSpeed + this.stackedCount() * speedPerLayer);
  }

  loop(ts) {
    this.rafId = null;
    if (!this.state.isRunning || this.state.isPaused) return;
    const dt =
      this.lastTs === null ? 0 : Math.min(TUNING.slide.maxFrameSec, (ts - this.lastTs) / 1000);
    this.lastTs = ts;

    const m = this.state.moving;
    if (m) {
      const { minLeft, maxLeft } = this.slideRange(m.width);
      m.left += m.dir * this.speed() * dt;
      if (m.left <= minLeft) {
        m.left = minLeft;
        m.dir = 1;
      } else if (m.left >= maxLeft) {
        m.left = maxLeft;
        m.dir = -1;
      }
      this.positionLayer(m.el, m.left, m.width, this.state.layers.length);
    }
    this.rafId = requestAnimationFrame(this._loop);
  }

  // The slide always carries the layer fully clear of the cake on both
  // sides (so a full miss is possible from the first layer), but never more
  // than `overhang` of it off the field, so it stays visible.
  slideRange(width) {
    const top = this.state.layers[this.state.layers.length - 1];
    const gap = TUNING.slide.clearance;
    return {
      minLeft: Math.min(-width * TUNING.slide.overhang, top.left - width - gap),
      maxLeft: Math.max(1 - width * TUNING.slide.overhang, top.left + top.width + gap),
    };
  }

  // --- Layers ---

  flavorFor(index) {
    return FLAVORS[index % FLAVORS.length];
  }

  makeLayerEl(index, extraClass = '') {
    const el = document.createElement('div');
    el.className = `cake-layer cake-layer--${this.flavorFor(index)} ${extraClass}`.trim();
    this.stackEl.appendChild(el);
    return el;
  }

  positionLayer(el, left, width, index) {
    el.style.setProperty('--l', left.toFixed(4));
    el.style.setProperty('--w', width.toFixed(4));
    el.style.setProperty('--i', String(index));
  }

  placeLayer({ left, width }) {
    const index = this.state.layers.length;
    const el = this.makeLayerEl(index, 'cake-layer--placed');
    this.positionLayer(el, left, width, index);
    this.state.layers.push({ left, width, el });
    this.updateCamera();
  }

  spawnMoving() {
    const top = this.state.layers[this.state.layers.length - 1];
    const index = this.state.layers.length;
    // Enter from alternating sides so the rhythm changes each layer.
    const fromLeft = index % 2 === 1;
    const { minLeft, maxLeft } = this.slideRange(top.width);
    const left = fromLeft ? minLeft : maxLeft;
    const el = this.makeLayerEl(index, 'cake-layer--moving');
    this.state.moving = { left, width: top.width, dir: fromLeft ? 1 : -1, el };
    this.positionLayer(el, left, top.width, index);
  }

  updateCamera() {
    const offset = Math.max(0, this.state.layers.length - TUNING.camera.keepBelow);
    this.stackEl.style.setProperty('--cam', String(offset));
  }

  // --- Input ---

  onPointerDown(e) {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    this.drop();
  }

  onKeyDown(e) {
    if (e.code !== 'Space' && e.key !== ' ' && e.key !== 'Enter') return;
    if (!this.state.isRunning) return;
    e.preventDefault();
    if (!e.repeat) this.drop();
  }

  drop() {
    const m = this.state.moving;
    if (!m || !this.state.isRunning || this.state.isPaused) return;
    this.state.moving = null;
    const below = this.state.layers[this.state.layers.length - 1];
    const index = this.state.layers.length;

    // Near-perfect: snap onto the layer below, no trim.
    if (Math.abs(m.left - below.left) <= TUNING.perfect.tolerance) {
      m.el.remove();
      this.state.perfectStreak += 1;
      this.placeLayer({ left: below.left, width: below.width });
      this.showToast(
        this.state.perfectStreak > 1 ? `מושלם ×${this.state.perfectStreak}!` : 'מושלם!',
        true,
      );
      this.afterPlace();
      return;
    }
    this.state.perfectStreak = 0;

    const overlapLeft = Math.max(m.left, below.left);
    const overlapRight = Math.min(m.left + m.width, below.left + below.width);
    const overlap = overlapRight - overlapLeft;

    if (overlap <= 0) {
      // Missed the cake entirely: the whole layer falls.
      this.dropPiece(m.el, m.left, m.width, index);
      this.showToast('השכבה נפלה!', false);
      this.finish(() => this.config.onGameOver && this.config.onGameOver('השכבה נפלה מהעוגה!'));
      return;
    }

    // Trim the overhang and let it fall.
    m.el.remove();
    if (m.left < below.left) this.dropPiece(null, m.left, below.left - m.left, index);
    else this.dropPiece(null, overlapRight, m.left + m.width - overlapRight, index);
    this.placeLayer({ left: overlapLeft, width: overlap });
    this.afterPlace();
  }

  afterPlace() {
    const stacked = this.stackedCount();
    if (this.stackedEl) this.stackedEl.textContent = String(stacked);
    if (stacked >= this.config.toStack) {
      // Cherry on top, centred on the last layer.
      const top = this.state.layers[this.state.layers.length - 1];
      const cherry = this.container.querySelector('.cake-cherry');
      if (cherry) {
        cherry.style.setProperty('--i', String(this.state.layers.length));
        cherry.style.setProperty('--c', (top.left + top.width / 2).toFixed(4));
      }
      this.gameEl.classList.add('cake-game--done');
      this.finish(() => this.config.onComplete && this.config.onComplete());
      return;
    }
    this.spawnMoving();
  }

  // A falling piece: either an existing element (whole layer) or a new
  // trimmed sliver. Removed once its fall animation ends.
  dropPiece(el, left, width, index) {
    const piece = el || this.makeLayerEl(index);
    piece.classList.remove('cake-layer--moving');
    piece.classList.add(
      'cake-layer--falling',
      left < 0.5 ? 'cake-layer--fall-left' : 'cake-layer--fall-right',
    );
    this.positionLayer(piece, left, width, index);
    this.later(() => piece.remove(), TUNING.pacing.trimFallMs);
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

  showToast(text, good) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.className = `cake-toast cake-toast--${good ? 'good' : 'bad'}`;
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('cake-toast--show');
  }

  render() {
    this.container.innerHTML = `
      <style>${START_OVERLAY_STYLES}\n${styles}</style>
      <div class="cake-game" dir="rtl">
        <div class="cake-hud">
          <span class="cake-hint">הקישו כדי להניח שכבה</span>
          <span class="cake-counter" dir="ltr" aria-label="שכבות">
            🎂 <span id="cake-stacked">0</span><span class="cake-counter-sep">/</span><span>${this.config.toStack}</span>
          </span>
        </div>
        <div class="cake-field" role="button" aria-label="הקישו כדי להניח שכבה">
          <div class="cake-stack">
            <div class="cake-plate" aria-hidden="true"></div>
            <div class="cake-cherry" aria-hidden="true">🍒</div>
          </div>
          <div class="cake-toast" aria-live="polite"></div>
        </div>
      </div>
    `;
  }

  destroy() {
    this.state.isRunning = false;
    this.stopLoop();
    for (const id of this.timeouts) clearTimeout(id);
    this.timeouts.clear();
    if (this.fieldEl) this.fieldEl.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.removeStartOverlay) {
      this.removeStartOverlay();
      this.removeStartOverlay = null;
    }
    this.state.layers = [];
    this.state.moving = null;
    this.gameEl = null;
    this.fieldEl = null;
    this.stackEl = null;
    this.stackedEl = null;
    this.toastEl = null;
    this.container.innerHTML = '';
  }
}
