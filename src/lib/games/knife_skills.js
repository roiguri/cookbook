import styles from './knife_skills.css?inline';

// Pool order is meaningful: spawns pick uniformly from these arrays. Reorder
// to bias toward visually-clearer fruits if the playtest pass calls for it.
const PRODUCE_POOL = [
  'apple',
  'lemon',
  'watermelon',
  'strawberry',
  'kiwi',
  'banana',
  'orange',
  'pineapple',
];
const HAZARD_POOL = ['chili', 'onion'];

// Hebrew display names — used in failure reasons.
const HAZARD_HE = {
  chili: 'פלפל חריף',
  onion: 'בצל',
};

// One-stop gameplay tuning. Visual sizes (fruit width/height) live in
// knife_skills.css under .knife-fruit. Keep TUNING.fruit.sizePx in sync.
const TUNING = {
  win: { toSlice: 30 },
  miss: { maxStrikes: 3 },
  fruit: {
    sizePx: 72, // matches .knife-fruit width/height in CSS
    hitRadiusPx: 32, // generous-ish hit circle for slice detection
  },
  physics: {
    gravity: 0.18, // px/frame^2
    spawnMargin: 0.1, // % of field width kept clear at each edge
    minUpwardVel: 8.2, // base upward velocity (px/frame)
    upwardVelJitter: 3, // additional random upward velocity
    angularVelMax: 4, // deg/frame
    sliceKick: 1.2, // perpendicular velocity added to each half on slice
    halfAngularBoost: 1.5,
  },
  spawn: {
    baseIntervalMs: 1400,
    decreasePerSpawnMs: 25,
    minIntervalMs: 700,
    multiSpawnBaseChance: 0,
    multiSpawnPerSpawn: 0.014, // chance at spawn N = base + perSpawn*N
    multiSpawnCap: 0.4,
    multiSpawnOffsetMs: 90, // stagger inside a multi-spawn burst
  },
  hazard: {
    baseChance: 0.05,
    perSpawn: 0.005,
    cap: 0.2,
  },
  stroke: {
    minVelocityPxPerMs: 0.4,
    trailMaxPoints: 14,
    trailFadeMs: 220,
  },
  juice: {
    particleCount: 7,
    speedMin: 1.4,
    speedRange: 2.4,
    lifetimeMs: 360,
  },
  combo: {
    minToShow: 2,
    floatMs: 720,
  },
};

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Squared distance from `point` to the segment p1→p2. Used by the slice hit
// test — segment-to-circle reduces to distance(segment, center) ≤ radius.
function segmentPointDistanceSq(p1x, p1y, p2x, p2y, cx, cy) {
  const dx = p2x - p1x;
  const dy = p2y - p1y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ax = cx - p1x;
    const ay = cy - p1y;
    return ax * ax + ay * ay;
  }
  let t = ((cx - p1x) * dx + (cy - p1y) * dy) / lenSq;
  t = clamp(t, 0, 1);
  const closestX = p1x + t * dx;
  const closestY = p1y + t * dy;
  const ex = cx - closestX;
  const ey = cy - closestY;
  return ex * ex + ey * ey;
}

export class KnifeSkillsGame {
  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign(
      {
        toSlice: TUNING.win.toSlice,
        maxStrikes: TUNING.miss.maxStrikes,
        onComplete: null,
        onGameOver: null,
        onInteraction: null,
      },
      config,
    );

    this.state = {
      fruits: [],
      sliced: 0,
      strikes: 0,
      spawnCounter: 0,
      isRunning: false,
    };

    this.fieldEl = null;
    this.fieldRect = null; // {width, height} cached
    this.trailPathEl = null;
    this.strikePipsEls = [];
    this.slicedCountEl = null;
    this.startOverlayEl = null;
    this.gameLoopId = null;
    this.spawnerId = null;
    this.fruitIdCounter = 0;
    this.firstInteractionFired = false;
    this.stroke = null; // active swipe: { points, slicedThisStroke, pointerId }
    this.pendingMultiSpawns = []; // timeouts for staggered multi-spawn entries

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onResize = this.onResize.bind(this);
  }

  async start() {
    this.state.isRunning = false;
    this.render();
    this.fieldEl = this.container.querySelector('#knife-field');
    this.trailPathEl = this.container.querySelector('#knife-trail-path');
    this.slicedCountEl = this.container.querySelector('#knife-sliced-count');
    this.strikePipsEls = Array.from(this.container.querySelectorAll('.knife-strike-pip'));
    this.measureField();

    this.fieldEl.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('resize', this._onResize);

    await this.preloadAssets();
    this.showStartOverlay();
  }

  measureField() {
    if (!this.fieldEl) return;
    const rect = this.fieldEl.getBoundingClientRect();
    this.fieldRect = { width: rect.width, height: rect.height };
  }

  onResize() {
    this.measureField();
  }

  async preloadAssets() {
    const urls = [...PRODUCE_POOL, ...HAZARD_POOL].map((type) =>
      type === 'chili' || type === 'onion'
        ? new URL(`./assets/knife/hazard_${type}.svg`, import.meta.url).href
        : new URL(`./assets/knife/${type}.svg`, import.meta.url).href,
    );
    await Promise.all(
      urls.map(
        (url) =>
          new Promise((res) => {
            const img = new Image();
            img.onload = res;
            img.onerror = res;
            img.src = url;
          }),
      ),
    );
  }

  showStartOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'knife-start-overlay';
    overlay.innerHTML = `
      <div class="knife-start-card">
        <div class="knife-start-emoji" aria-hidden="true">🔪</div>
        <h3 class="knife-start-title">אמן הסכין</h3>
        <p class="knife-start-instructions">
          החליקו את האצבע על הפירות כדי לחתוך אותם.
          היזהרו מהפלפל החריף והבצל — חתיכה אחת והמשחק נגמר.
        </p>
        <button class="knife-start-btn" type="button">התחל</button>
      </div>
    `;
    const gameEl = this.container.querySelector('.knife-game');
    if (!gameEl) return;
    gameEl.appendChild(overlay);
    this.startOverlayEl = overlay;
    this._onStartClick = () => this.beginPlay();
    overlay.querySelector('.knife-start-btn').addEventListener('click', this._onStartClick);
  }

  beginPlay() {
    if (this.startOverlayEl) {
      this.startOverlayEl.remove();
      this.startOverlayEl = null;
    }
    if (this.state.isRunning) return;
    this.state.isRunning = true;
    if (!this.firstInteractionFired && this.config.onInteraction) {
      this.firstInteractionFired = true;
      this.config.onInteraction();
    }
    this.startGameLoop();
    this.startSpawner();
    // Spawn one fruit immediately so the player isn't staring at an empty field.
    this.spawnFruit();
  }

  startGameLoop() {
    const loop = () => {
      if (!this.state.isRunning) return;
      this.advancePhysics();
      this.cullOffscreen();
      this.gameLoopId = requestAnimationFrame(loop);
    };
    this.gameLoopId = requestAnimationFrame(loop);
  }

  currentSpawnInterval() {
    const { baseIntervalMs, decreasePerSpawnMs, minIntervalMs } = TUNING.spawn;
    return Math.max(minIntervalMs, baseIntervalMs - this.state.spawnCounter * decreasePerSpawnMs);
  }

  currentHazardChance() {
    const { baseChance, perSpawn, cap } = TUNING.hazard;
    return Math.min(cap, baseChance + this.state.spawnCounter * perSpawn);
  }

  currentMultiSpawnChance() {
    const { multiSpawnBaseChance, multiSpawnPerSpawn, multiSpawnCap } = TUNING.spawn;
    return Math.min(
      multiSpawnCap,
      multiSpawnBaseChance + this.state.spawnCounter * multiSpawnPerSpawn,
    );
  }

  startSpawner() {
    const tick = () => {
      if (!this.state.isRunning) return;
      this.spawnFruit();
      // Multi-spawn roll: chain 1–2 extra spawns staggered slightly.
      if (Math.random() < this.currentMultiSpawnChance()) {
        const extras = 1 + Math.floor(Math.random() * 2);
        for (let i = 1; i <= extras; i++) {
          const t = setTimeout(() => {
            this.pendingMultiSpawns = this.pendingMultiSpawns.filter((id) => id !== t);
            if (this.state.isRunning) this.spawnFruit();
          }, TUNING.spawn.multiSpawnOffsetMs * i);
          this.pendingMultiSpawns.push(t);
        }
      }
      this.spawnerId = setTimeout(tick, this.currentSpawnInterval());
    };
    this.spawnerId = setTimeout(tick, this.currentSpawnInterval());
  }

  spawnFruit() {
    if (!this.fieldEl || !this.fieldRect) return;
    const isHazard = Math.random() < this.currentHazardChance();
    const type = isHazard ? randomFrom(HAZARD_POOL) : randomFrom(PRODUCE_POOL);

    const { width, height } = this.fieldRect;
    const { spawnMargin, minUpwardVel, upwardVelJitter, angularVelMax, gravity } = TUNING.physics;
    const usableWidth = width * (1 - 2 * spawnMargin);
    const startX = width * spawnMargin + Math.random() * usableWidth - TUNING.fruit.sizePx / 2;
    const startY = height + TUNING.fruit.sizePx; // just below the field

    const vy = -(minUpwardVel + Math.random() * upwardVelJitter);
    // Estimate flight time so we can aim horizontal velocity at a target X.
    // Up-time: vy → 0 under gravity. Total flight ≈ 2 * vy / gravity (returns to start).
    const flightFrames = Math.max(60, (2 * Math.abs(vy)) / gravity);
    const aimX = width * (spawnMargin + Math.random() * (1 - 2 * spawnMargin));
    const vx = ((aimX - startX) / flightFrames) * 0.7; // dampened so arcs aren't too steep
    const angularVel = (Math.random() - 0.5) * 2 * angularVelMax;

    const el = document.createElement('div');
    el.className = `knife-fruit knife-fruit--${type}${isHazard ? ' knife-fruit--hazard' : ''}`;
    el.style.transform = `translate(${startX}px, ${startY}px) rotate(0deg)`;
    this.fieldEl.appendChild(el);

    const id = ++this.fruitIdCounter;
    this.state.fruits.push({
      id,
      type,
      isHazard,
      x: startX,
      y: startY,
      vx,
      vy,
      rotation: 0,
      angularVel,
      sliced: false,
      el,
      halves: null,
    });
    this.state.spawnCounter += 1;
  }

  advancePhysics() {
    const { gravity } = TUNING.physics;
    for (const f of this.state.fruits) {
      if (!f.sliced) {
        f.vy += gravity;
        f.x += f.vx;
        f.y += f.vy;
        f.rotation += f.angularVel;
        f.el.style.transform = `translate(${f.x}px, ${f.y}px) rotate(${f.rotation}deg)`;
      } else if (f.halves) {
        for (const h of f.halves) {
          h.vy += gravity;
          h.x += h.vx;
          h.y += h.vy;
          h.rotation += h.angularVel;
          h.el.style.transform = `translate(${h.x}px, ${h.y}px) rotate(${h.rotation}deg)`;
        }
      }
    }
  }

  cullOffscreen() {
    if (!this.fieldRect) return;
    const fieldH = this.fieldRect.height;
    const margin = TUNING.fruit.sizePx * 1.5;
    for (let i = this.state.fruits.length - 1; i >= 0; i--) {
      const f = this.state.fruits[i];
      if (!f.sliced) {
        // Only count as missed once the fruit has actually risen and is falling
        // past the bottom. vy > 0 = falling.
        if (f.y > fieldH + margin) {
          f.el.remove();
          this.state.fruits.splice(i, 1);
          if (!f.isHazard) this.handleMiss();
        }
      } else if (f.halves) {
        let allGone = true;
        for (const h of f.halves) {
          if (h.y > fieldH + margin) {
            h.el.remove();
          } else {
            allGone = false;
          }
        }
        if (allGone) this.state.fruits.splice(i, 1);
      }
    }
  }

  handleMiss() {
    if (!this.state.isRunning) return;
    this.state.strikes += 1;
    const pip = this.strikePipsEls[this.state.strikes - 1];
    if (pip) pip.classList.add('knife-strike-pip--filled');
    if (this.state.strikes >= this.config.maxStrikes) {
      this.endRun('miss');
    }
  }

  endRun(kind, sliceContext = null) {
    this.state.isRunning = false;
    if (this.spawnerId) {
      clearTimeout(this.spawnerId);
      this.spawnerId = null;
    }
    if (this.gameLoopId) {
      cancelAnimationFrame(this.gameLoopId);
      this.gameLoopId = null;
    }
    for (const id of this.pendingMultiSpawns) clearTimeout(id);
    this.pendingMultiSpawns = [];

    if (kind === 'miss') {
      if (this.config.onGameOver) this.config.onGameOver('פספסת יותר מדי פירות!');
    } else if (kind === 'hazard') {
      const heName = sliceContext ? HAZARD_HE[sliceContext.type] || 'מכשול' : 'מכשול';
      if (this.config.onGameOver) this.config.onGameOver(`פגעת ב${heName}!`);
    }
  }

  // --- Pointer input ---

  onPointerDown(e) {
    if (!this.state.isRunning) return;
    e.preventDefault();
    try {
      this.fieldEl.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture may throw if the pointer is no longer active */
    }
    const local = this.toFieldLocal(e.clientX, e.clientY);
    this.stroke = {
      pointerId: e.pointerId,
      points: [{ x: local.x, y: local.y, t: performance.now() }],
      slicedThisStroke: 0,
      lastSlicePoint: null,
    };
    this.trailPathEl.setAttribute('d', '');
    this.trailPathEl.classList.add('knife-trail-path--active');
    this.fieldEl.addEventListener('pointermove', this._onPointerMove);
    this.fieldEl.addEventListener('pointerup', this._onPointerUp);
    this.fieldEl.addEventListener('pointercancel', this._onPointerUp);
  }

  onPointerMove(e) {
    if (!this.stroke || e.pointerId !== this.stroke.pointerId) return;
    const local = this.toFieldLocal(e.clientX, e.clientY);
    const now = performance.now();
    const prev = this.stroke.points[this.stroke.points.length - 1];
    const dt = Math.max(1, now - prev.t);
    const dxs = local.x - prev.x;
    const dys = local.y - prev.y;
    const dist = Math.sqrt(dxs * dxs + dys * dys);
    const velocity = dist / dt;

    this.stroke.points.push({ x: local.x, y: local.y, t: now });
    if (this.stroke.points.length > TUNING.stroke.trailMaxPoints) {
      this.stroke.points.shift();
    }

    // Only run the hit test if the segment moved fast enough. Slow hovers
    // (mouse idle, accidental brush) don't slice.
    if (velocity >= TUNING.stroke.minVelocityPxPerMs) {
      this.checkSliceHits(prev, { x: local.x, y: local.y });
    }

    this.updateTrailPath();
  }

  onPointerUp(e) {
    if (!this.stroke || e.pointerId !== this.stroke.pointerId) return;
    const slicedThisStroke = this.stroke.slicedThisStroke;
    const lastPoint = this.stroke.lastSlicePoint;

    try {
      this.fieldEl.releasePointerCapture(this.stroke.pointerId);
    } catch {
      /* already released */
    }
    this.fieldEl.removeEventListener('pointermove', this._onPointerMove);
    this.fieldEl.removeEventListener('pointerup', this._onPointerUp);
    this.fieldEl.removeEventListener('pointercancel', this._onPointerUp);

    this.trailPathEl.classList.remove('knife-trail-path--active');
    // Clear trail after fade animation finishes.
    setTimeout(() => {
      if (this.trailPathEl) this.trailPathEl.setAttribute('d', '');
    }, TUNING.stroke.trailFadeMs);

    this.stroke = null;

    if (slicedThisStroke >= TUNING.combo.minToShow && lastPoint) {
      this.showCombo(slicedThisStroke, lastPoint);
    }
  }

  toFieldLocal(clientX, clientY) {
    const rect = this.fieldEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  checkSliceHits(prev, current) {
    const radius = TUNING.fruit.hitRadiusPx;
    const radiusSq = radius * radius;
    for (const f of this.state.fruits) {
      if (f.sliced) continue;
      const cx = f.x + TUNING.fruit.sizePx / 2;
      const cy = f.y + TUNING.fruit.sizePx / 2;
      const distSq = segmentPointDistanceSq(prev.x, prev.y, current.x, current.y, cx, cy);
      if (distSq <= radiusSq) {
        this.sliceFruit(f, prev, current);
      }
    }
  }

  // --- Slicing ---

  sliceFruit(fruit, p1, p2) {
    if (fruit.sliced) return;
    fruit.sliced = true;
    fruit.el.remove();

    const angleRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const angleDeg = (angleRad * 180) / Math.PI;
    const perpX = -Math.sin(angleRad) * TUNING.physics.sliceKick;
    const perpY = Math.cos(angleRad) * TUNING.physics.sliceKick;
    const halfAngular = fruit.angularVel * TUNING.physics.halfAngularBoost;

    const halfTop = this.buildHalfElement(fruit.type, angleDeg, 'top', fruit.isHazard);
    const halfBottom = this.buildHalfElement(fruit.type, angleDeg, 'bottom', fruit.isHazard);

    halfTop.style.transform = `translate(${fruit.x}px, ${fruit.y}px) rotate(${fruit.rotation}deg)`;
    halfBottom.style.transform = `translate(${fruit.x}px, ${fruit.y}px) rotate(${fruit.rotation}deg)`;

    this.fieldEl.appendChild(halfTop);
    this.fieldEl.appendChild(halfBottom);

    fruit.halves = [
      {
        el: halfTop,
        x: fruit.x,
        y: fruit.y,
        vx: fruit.vx + perpX,
        vy: fruit.vy + perpY,
        rotation: fruit.rotation,
        angularVel: halfAngular,
      },
      {
        el: halfBottom,
        x: fruit.x,
        y: fruit.y,
        vx: fruit.vx - perpX,
        vy: fruit.vy - perpY,
        rotation: fruit.rotation,
        angularVel: -halfAngular,
      },
    ];

    // Juice particles centered on the fruit.
    const centerX = fruit.x + TUNING.fruit.sizePx / 2;
    const centerY = fruit.y + TUNING.fruit.sizePx / 2;
    this.spawnJuiceParticles(centerX, centerY, fruit.type, fruit.isHazard);

    if (this.stroke) {
      this.stroke.slicedThisStroke += 1;
      this.stroke.lastSlicePoint = { x: centerX, y: centerY };
    }

    if (fruit.isHazard) {
      this.fieldEl.classList.add('knife-field--shake');
      setTimeout(() => this.fieldEl && this.fieldEl.classList.remove('knife-field--shake'), 320);
      this.endRun('hazard', fruit);
    } else {
      this.handleProduceSlice();
    }
  }

  buildHalfElement(type, cutAngleDeg, side, isHazard) {
    const wrap = document.createElement('div');
    wrap.className = `knife-fruit-half knife-fruit-half--${side}${isHazard ? ' knife-fruit-half--hazard' : ''}`;
    wrap.style.setProperty('--cut-angle', `${cutAngleDeg}deg`);
    const mask = document.createElement('div');
    mask.className = 'knife-fruit-half-mask';
    const sprite = document.createElement('div');
    sprite.className = `knife-fruit-half-sprite knife-fruit-half-sprite--${type}`;
    mask.appendChild(sprite);
    wrap.appendChild(mask);
    return wrap;
  }

  spawnJuiceParticles(cx, cy, type, isHazard) {
    const cls = isHazard ? 'knife-juice--hazard' : `knife-juice--${type}`;
    for (let i = 0; i < TUNING.juice.particleCount; i++) {
      const p = document.createElement('div');
      p.className = `knife-juice ${cls}`;
      const angle = Math.random() * Math.PI * 2;
      const speed = TUNING.juice.speedMin + Math.random() * TUNING.juice.speedRange;
      const dx = Math.cos(angle) * speed * 30;
      const dy = Math.sin(angle) * speed * 30;
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.setProperty('--juice-dx', `${dx}px`);
      p.style.setProperty('--juice-dy', `${dy}px`);
      this.fieldEl.appendChild(p);
      setTimeout(() => p.remove(), TUNING.juice.lifetimeMs + 60);
    }
  }

  handleProduceSlice() {
    if (!this.state.isRunning) return;
    this.state.sliced += 1;
    if (this.slicedCountEl) this.slicedCountEl.textContent = String(this.state.sliced);
    if (this.state.sliced >= this.config.toSlice) {
      this.state.isRunning = false;
      if (this.spawnerId) {
        clearTimeout(this.spawnerId);
        this.spawnerId = null;
      }
      for (const id of this.pendingMultiSpawns) clearTimeout(id);
      this.pendingMultiSpawns = [];
      if (this.config.onComplete) this.config.onComplete();
    }
  }

  showCombo(count, point) {
    const el = document.createElement('div');
    el.className = 'knife-combo';
    el.textContent = `קומבו! ×${count}`;
    el.style.left = `${point.x}px`;
    el.style.top = `${point.y}px`;
    this.fieldEl.appendChild(el);
    setTimeout(() => el.remove(), TUNING.combo.floatMs + 60);
  }

  // --- Slash trail ---

  updateTrailPath() {
    if (!this.stroke || !this.trailPathEl) return;
    const pts = this.stroke.points;
    if (pts.length < 2) {
      this.trailPathEl.setAttribute('d', '');
      return;
    }
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    }
    this.trailPathEl.setAttribute('d', d);
  }

  // --- Render ---

  render() {
    const totalToSlice = this.config.toSlice;
    const maxStrikes = this.config.maxStrikes;
    const strikePips = Array.from({ length: maxStrikes })
      .map(() => '<span class="knife-strike-pip" aria-hidden="true"></span>')
      .join('');
    this.container.innerHTML = `
      <style>${styles}</style>
      <div class="knife-game" dir="rtl">
        <div class="knife-hud">
          <div class="knife-strikes" aria-label="פספוסים">${strikePips}</div>
          <span class="knife-counter" dir="ltr" aria-label="פירות שנחתכו">
            <span id="knife-sliced-count">0</span><span class="knife-counter-sep">/</span><span>${totalToSlice}</span>
          </span>
        </div>
        <div class="knife-field" id="knife-field">
          <svg class="knife-trail" aria-hidden="true">
            <path id="knife-trail-path" d=""></path>
          </svg>
        </div>
      </div>
    `;
  }

  destroy() {
    this.state.isRunning = false;
    if (this.gameLoopId) {
      cancelAnimationFrame(this.gameLoopId);
      this.gameLoopId = null;
    }
    if (this.spawnerId) {
      clearTimeout(this.spawnerId);
      this.spawnerId = null;
    }
    for (const id of this.pendingMultiSpawns) clearTimeout(id);
    this.pendingMultiSpawns = [];

    if (this.fieldEl) {
      this.fieldEl.removeEventListener('pointerdown', this._onPointerDown);
      this.fieldEl.removeEventListener('pointermove', this._onPointerMove);
      this.fieldEl.removeEventListener('pointerup', this._onPointerUp);
      this.fieldEl.removeEventListener('pointercancel', this._onPointerUp);
    }
    window.removeEventListener('resize', this._onResize);

    if (this.startOverlayEl) {
      this.startOverlayEl.remove();
      this.startOverlayEl = null;
    }

    this.state.fruits = [];
    this.fieldEl = null;
    this.fieldRect = null;
    this.trailPathEl = null;
    this.strikePipsEls = [];
    this.slicedCountEl = null;
    this.stroke = null;
    this.container.innerHTML = '';
  }
}
