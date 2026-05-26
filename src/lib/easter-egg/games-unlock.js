import './games-unlock.css';

const TAP_TARGET = 7;
const TAP_WINDOW_MS = 2000;
const UNLOCK_COOLDOWN_MS = 1500;
const BRAND_SELECTOR = 'header .logo, .drawer-brand';

let tapCount = 0;
let lastTapAt = 0;
let cooldownUntil = 0;

function reset() {
  tapCount = 0;
  lastTapAt = 0;
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
  if (now - lastTapAt > TAP_WINDOW_MS) tapCount = 0;
  lastTapAt = now;
  tapCount += 1;

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

    const flash = document.createElement('div');
    flash.className = 'games-unlock-flash';
    flash.style.left = `${cx}px`;
    flash.style.top = `${cy}px`;
    overlay.appendChild(flash);

    const burst = document.createElement('div');
    burst.className = 'games-unlock-burst';
    burst.style.left = `${cx}px`;
    burst.style.top = `${cy}px`;

    const SPARKLE_COUNT = 18;
    for (let i = 0; i < SPARKLE_COUNT; i += 1) {
      const sparkle = document.createElement('span');
      sparkle.className = 'games-unlock-sparkle';
      const angle = (360 / SPARKLE_COUNT) * i + (Math.random() * 8 - 4);
      const dist = 140 + Math.random() * 120;
      const delay = Math.random() * 120;
      sparkle.style.setProperty('--angle', `${angle}deg`);
      sparkle.style.setProperty('--dist', `${dist}px`);
      sparkle.style.setProperty('--delay', `${delay}ms`);
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
    }, 700);
  });
}

let initialized = false;

export function initGamesUnlock() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('click', handleClick, true);
}
