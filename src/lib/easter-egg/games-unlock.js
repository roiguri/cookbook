import './games-unlock.css';

const TAP_TARGET = 7;
const TAP_WINDOW_MS = 2000;
const UNLOCK_COOLDOWN_MS = 1500;
const BRAND_SELECTOR = 'header .logo, .drawer-brand';

let tapCount = 0;
let lastTapAt = 0;
let cooldownUntil = 0;
let lastBrand = null;
let glowTimer = null;

function reset() {
  tapCount = 0;
  lastTapAt = 0;
  clearGlow();
}

function clearGlow() {
  if (glowTimer) {
    clearTimeout(glowTimer);
    glowTimer = null;
  }
  if (lastBrand) {
    delete lastBrand.dataset.unlockGlow;
  }
}

function pulseBrand(brand) {
  if (typeof brand.animate !== 'function') return;
  const reduceMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;
  brand.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.08)', offset: 0.4 },
      { transform: 'scale(1)' },
    ],
    { duration: 220, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  );
}

function updateGlow(brand, count) {
  // Subtle hint that something is happening, escalating as the user nears unlock.
  // Level 0 (no glow) for taps 1-2 keeps single-click home feeling normal.
  let level = 0;
  if (count >= 6) level = 3;
  else if (count >= 5) level = 2;
  else if (count >= 3) level = 1;

  if (level === 0) {
    delete brand.dataset.unlockGlow;
  } else {
    brand.dataset.unlockGlow = String(level);
  }
}

function scheduleGlowReset() {
  if (glowTimer) clearTimeout(glowTimer);
  glowTimer = setTimeout(() => {
    clearGlow();
    tapCount = 0;
  }, TAP_WINDOW_MS);
}

function handleClick(event) {
  const brand = event.target.closest(BRAND_SELECTOR);
  if (!brand) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  // Suppress any further logo clicks while the unlock animation/navigation is in flight,
  // otherwise a stray 8th+ tap re-triggers the normal /home interception.
  if (Date.now() < cooldownUntil) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const now = Date.now();
  if (now - lastTapAt > TAP_WINDOW_MS) {
    if (lastBrand && lastBrand !== brand) delete lastBrand.dataset.unlockGlow;
    tapCount = 0;
  }
  lastTapAt = now;
  lastBrand = brand;
  tapCount += 1;

  pulseBrand(brand);
  updateGlow(brand, tapCount);
  scheduleGlowReset();

  if (tapCount < TAP_TARGET) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  reset();
  cooldownUntil = Date.now() + UNLOCK_COOLDOWN_MS;

  runUnlockAnimation(brand).then(() => {
    if (window.spa?.router) {
      window.spa.router.navigate('/games');
    } else {
      window.location.href = '/games';
    }
  });
}

function runUnlockAnimation(origin) {
  return new Promise((resolve) => {
    const reduceMotion =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      resolve();
      return;
    }

    const rect = origin.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const overlay = document.createElement('div');
    overlay.className = 'games-unlock-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const dim = document.createElement('div');
    dim.className = 'games-unlock-dim';
    overlay.appendChild(dim);

    const flash = document.createElement('div');
    flash.className = 'games-unlock-flash';
    flash.style.left = `${cx}px`;
    flash.style.top = `${cy}px`;
    overlay.appendChild(flash);

    const burst = document.createElement('div');
    burst.className = 'games-unlock-burst';
    burst.style.left = `${cx}px`;
    burst.style.top = `${cy}px`;

    const SPARKLE_COUNT = 22;
    for (let i = 0; i < SPARKLE_COUNT; i += 1) {
      const sparkle = document.createElement('span');
      sparkle.className = 'games-unlock-sparkle';
      const angle = (360 / SPARKLE_COUNT) * i + (Math.random() * 10 - 5);
      const dist = 220 + Math.random() * 140;
      const delay = Math.random() * 140;
      sparkle.style.setProperty('--angle', `${angle}deg`);
      sparkle.style.setProperty('--dist', `${dist}px`);
      sparkle.style.setProperty('--delay', `${delay}ms`);
      if (i % 3 === 0) sparkle.style.setProperty('--sparkle-color', '#fbbf24');
      burst.appendChild(sparkle);
    }
    overlay.appendChild(burst);

    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.classList.add('games-unlock-fade');
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 320);
    }, 780);
  });
}

let initialized = false;

export function initGamesUnlock() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('click', handleClick, true);
}
