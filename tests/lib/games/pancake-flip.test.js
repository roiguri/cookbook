import { jest } from '@jest/globals';
import { PancakeFlipGame } from 'src/lib/games/pancake_flip.js';

// Fake timers also fake requestAnimationFrame (~16ms frames), so advancing
// time drives the game loop. Math.random = 0 → every pan pours after the
// shortest delay (0.3s at start, 0.6s after it frees up).
function setup(config = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host');
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const onComplete = jest.fn();
  const onGameOver = jest.fn();
  const onInteraction = jest.fn();
  const game = new PancakeFlipGame(host, {
    toServe: 2,
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

const pan = (host, i = 0) => host.querySelectorAll('.pancake-pan')[i];
const zone = (host, i = 0) => pan(host, i).dataset.zone;
const advance = (ms) => jest.advanceTimersByTime(ms);
const pips = (host) => host.querySelectorAll('.pancake-strike-pip--filled').length;
// Base side time is 3.4s; golden window opens at 60% ≈ 2.04s after pouring.
const POUR_MS = 400;
const TO_GOLDEN_MS = 2300;

describe('PancakeFlipGame', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    PancakeFlipGame.resetSession();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('start card gates play; pans stay empty until התחל', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const onInteraction = jest.fn();
    const game = new PancakeFlipGame(host, { onInteraction });
    game.start();
    advance(3000);
    expect(zone(host)).toBe('empty');
    expect(onInteraction).not.toHaveBeenCalled();
    host.querySelector('.game-start-btn').click();
    expect(onInteraction).toHaveBeenCalledTimes(1);
    advance(POUR_MS);
    expect(zone(host)).toBe('raw');
    game.destroy();
  });

  test('flip on golden, then serve on golden', () => {
    const { host, game } = setup({ toServe: 5 });
    advance(POUR_MS + TO_GOLDEN_MS);
    expect(zone(host)).toBe('golden');
    pan(host).click();
    expect(pan(host).dataset.side).toBe('2');
    expect(zone(host)).toBe('raw');
    advance(TO_GOLDEN_MS);
    pan(host).click();
    expect(host.querySelector('#pancake-served').textContent).toBe('1');
    expect(zone(host)).toBe('empty');
    game.destroy();
  });

  test('tapping a raw pancake is a strike and clears the pan', () => {
    const { host, game } = setup();
    advance(POUR_MS + 500);
    expect(zone(host)).toBe('raw');
    pan(host).click();
    expect(pips(host)).toBe(1);
    expect(zone(host)).toBe('empty');
    game.destroy();
  });

  test('tapping an empty pan does nothing', () => {
    const { host, game } = setup();
    pan(host).click();
    expect(pips(host)).toBe(0);
    game.destroy();
  });

  test('a pancake left on the heat burns and costs a strike', () => {
    const { host, game } = setup({ maxStrikes: 9 });
    advance(POUR_MS + 3500);
    expect(zone(host)).toBe('burnt');
    // All three pans poured at the same time, so all three burn.
    expect(pips(host)).toBe(3);
    advance(900);
    expect(zone(host)).toBe('empty');
    game.destroy();
  });

  test('three strikes ends the run', () => {
    const { onGameOver, onComplete, game } = setup();
    advance(POUR_MS + 3500 + 600);
    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    game.destroy();
  });

  test('serving toServe pancakes wins', () => {
    const { host, onComplete, onGameOver, game } = setup({ toServe: 2 });
    advance(POUR_MS + TO_GOLDEN_MS);
    pan(host, 0).click();
    pan(host, 1).click();
    advance(TO_GOLDEN_MS);
    pan(host, 0).click();
    pan(host, 1).click();
    advance(600);
    expect(onComplete).toHaveBeenCalledTimes(1);
    // Pan 2 was never touched, but the run stopped before it could burn.
    advance(5000);
    expect(onGameOver).not.toHaveBeenCalled();
    game.destroy();
  });

  test('pause freezes cooking and ignores taps; resume continues', () => {
    const { host, game } = setup();
    advance(POUR_MS + 1000);
    const before = pan(host).style.getPropertyValue('--progress');
    game.pause();
    advance(10000);
    expect(pan(host).style.getPropertyValue('--progress')).toBe(before);
    expect(zone(host)).toBe('raw');
    pan(host).click(); // would be a raw-tap strike if not paused
    expect(pips(host)).toBe(0);
    game.resume();
    advance(1500);
    expect(zone(host)).toBe('golden');
    game.destroy();
  });

  test('destroy stops the loop and pending callbacks', () => {
    const { host, game, onGameOver } = setup();
    advance(POUR_MS + 3500); // three burns → game over is pending
    game.destroy();
    advance(5000);
    expect(onGameOver).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe('');
  });
});
