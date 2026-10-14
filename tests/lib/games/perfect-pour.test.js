import { jest } from '@jest/globals';
import { PerfectPourGame } from 'src/lib/games/perfect_pour.js';

// Math.random = 0.5 → band centre 0.62, first band 0.54–0.70. Base pour rate
// is 0.3 glass/sec, so the band is reached after ~1.8–2.3s of holding.
function setup(config = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host');
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  const onComplete = jest.fn();
  const onGameOver = jest.fn();
  const onInteraction = jest.fn();
  const game = new PerfectPourGame(host, {
    toFill: 2,
    maxStrikes: 3,
    onComplete,
    onGameOver,
    onInteraction,
    ...config,
  });
  game.start();
  host.querySelector('.game-start-btn')?.click();
  return { host, game, onComplete, onGameOver, onInteraction };
}

// jsdom lacks PointerEvent; a MouseEvent carrying pointerId is enough.
function pointer(target, type, id = 1) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true });
  e.pointerId = id;
  target.dispatchEvent(e);
}

const stage = (host) => host.querySelector('.pour-stage');
const level = (host) => Number(host.querySelector('.pour-glass').style.getPropertyValue('--level'));
const filled = (host) => host.querySelector('#pour-filled').textContent;
const pips = (host) => host.querySelectorAll('.pour-strike-pip--filled').length;
const advance = (ms) => jest.advanceTimersByTime(ms);
const hold = (host, ms) => {
  pointer(stage(host), 'pointerdown');
  advance(ms);
};
const release = () => pointer(window, 'pointerup');
const IN_BAND_MS = 2050;
const NEXT_GLASS_MS = 800;

describe('PerfectPourGame', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    PerfectPourGame.resetSession();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('start card gates play; holding before התחל pours nothing', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const onInteraction = jest.fn();
    const game = new PerfectPourGame(host, { onInteraction });
    game.start();
    hold(host, 1000);
    release();
    expect(level(host)).toBe(0);
    host.querySelector('.game-start-btn').click();
    expect(onInteraction).toHaveBeenCalledTimes(1);
    game.destroy();
  });

  test('releasing inside the band fills the glass', () => {
    const { host, game } = setup({ toFill: 5 });
    hold(host, IN_BAND_MS);
    expect(level(host)).toBeGreaterThan(0.54);
    expect(level(host)).toBeLessThan(0.7);
    release();
    expect(filled(host)).toBe('1');
    expect(pips(host)).toBe(0);
    advance(NEXT_GLASS_MS);
    expect(level(host)).toBe(0); // fresh glass
    game.destroy();
  });

  test('releasing short of the band is a strike', () => {
    const { host, game } = setup();
    hold(host, 800);
    release();
    expect(pips(host)).toBe(1);
    expect(filled(host)).toBe('0');
    game.destroy();
  });

  test('a quick tap is not judged', () => {
    const { host, game } = setup();
    hold(host, 60);
    release();
    expect(pips(host)).toBe(0);
    game.destroy();
  });

  test('releasing above the band is a strike; overflow judges without a release', () => {
    const { host, game } = setup();
    hold(host, 2800);
    release();
    expect(pips(host)).toBe(1);
    advance(NEXT_GLASS_MS);
    hold(host, 4000); // never let go → glass overflows
    expect(pips(host)).toBe(2);
    expect(host.querySelector('.pour-game').classList.contains('pour-game--spill')).toBe(true);
    release();
    expect(pips(host)).toBe(2);
    game.destroy();
  });

  test('pointercancel (e.g. rotation mid-touch) stops without judging; holding again tops up', () => {
    const { host, game } = setup({ toFill: 5 });
    hold(host, 1000);
    pointer(window, 'pointercancel');
    const afterCancel = level(host);
    advance(2000);
    expect(level(host)).toBe(afterCancel);
    expect(pips(host)).toBe(0);
    hold(host, 1050);
    release();
    expect(filled(host)).toBe('1');
    game.destroy();
  });

  test('window blur and hidden tab stop the pour without judging', () => {
    const { host, game } = setup();
    hold(host, 600);
    window.dispatchEvent(new Event('blur'));
    const l = level(host);
    advance(3000);
    expect(level(host)).toBe(l);
    expect(pips(host)).toBe(0);
    game.destroy();
  });

  test('space key pours and judges on release', () => {
    const { host, game } = setup({ toFill: 5 });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
    advance(IN_BAND_MS);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
    expect(filled(host)).toBe('1');
    game.destroy();
  });

  test('filling toFill glasses wins; three misses lose', () => {
    const win = setup({ toFill: 2 });
    for (let i = 0; i < 2; i++) {
      hold(win.host, IN_BAND_MS);
      release();
      advance(NEXT_GLASS_MS);
    }
    expect(win.onComplete).toHaveBeenCalledTimes(1);
    win.game.destroy();

    const lose = setup();
    for (let i = 0; i < 3; i++) {
      hold(lose.host, 600);
      release();
      advance(NEXT_GLASS_MS);
    }
    expect(lose.onGameOver).toHaveBeenCalledWith('יותר מדי כוסות הלכו לפח!');
    // Input after the end does nothing.
    hold(lose.host, IN_BAND_MS);
    release();
    expect(lose.onComplete).not.toHaveBeenCalled();
    lose.game.destroy();
  });

  test('destroy removes window listeners and pending callbacks', () => {
    const { host, game, onComplete } = setup({ toFill: 1 });
    hold(host, IN_BAND_MS);
    release(); // win pending
    game.destroy();
    advance(2000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(() => pointer(window, 'pointerup')).not.toThrow();
    expect(host.innerHTML).toBe('');
  });
});
