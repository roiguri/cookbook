import { jest } from '@jest/globals';
import { LayerCakeGame } from 'src/lib/games/layer_cake.js';

// The base layer spans 0.2–0.8 of the field. Tests place the moving layer
// exactly by writing state.moving.left before dropping, so outcomes don't
// depend on slide timing.
function setup(config = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host');
  const onComplete = jest.fn();
  const onGameOver = jest.fn();
  const onInteraction = jest.fn();
  const game = new LayerCakeGame(host, {
    toStack: 3,
    onComplete,
    onGameOver,
    onInteraction,
    ...config,
  });
  game.start();
  host.querySelector('.game-start-btn')?.click();
  return { host, game, onComplete, onGameOver, onInteraction };
}

const advance = (ms) => jest.advanceTimersByTime(ms);
const field = (host) => host.querySelector('.cake-field');
const tap = (host) => {
  const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
  field(host).dispatchEvent(e);
};
const dropAt = (game, host, left) => {
  game.state.moving.left = left;
  tap(host);
};
const top = (game) => game.state.layers[game.state.layers.length - 1];
const stacked = (host) => host.querySelector('#cake-stacked').textContent;

describe('LayerCakeGame', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    LayerCakeGame.resetSession();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('start card gates play; base layer on the plate, no moving layer yet', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const onInteraction = jest.fn();
    const game = new LayerCakeGame(host, { onInteraction });
    game.start();
    expect(game.state.layers).toHaveLength(1);
    expect(game.state.moving).toBeNull();
    tap(host);
    expect(game.state.layers).toHaveLength(1);
    host.querySelector('.game-start-btn').click();
    expect(onInteraction).toHaveBeenCalledTimes(1);
    expect(game.state.moving).not.toBeNull();
    game.destroy();
  });

  test('the moving layer slides and bounces within its range', () => {
    const { game } = setup();
    const start = game.state.moving.left;
    advance(300);
    expect(game.state.moving.left).not.toBe(start);
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      advance(50);
      seen.add(game.state.moving.dir);
      // Base 0.2–0.8, layer width 0.6: slides from fully left of the cake
      // (−0.45) to fully right of it (0.85).
      expect(game.state.moving.left).toBeGreaterThanOrEqual(-0.45 - 1e-9);
      expect(game.state.moving.left).toBeLessThanOrEqual(0.85 + 1e-9);
    }
    expect(seen).toEqual(new Set([1, -1]));
    game.destroy();
  });

  test('an offset drop trims the overhang', () => {
    const { host, game } = setup({ toStack: 5 });
    dropAt(game, host, 0.3); // 0.3–0.9 over 0.2–0.8 → keeps 0.3–0.8
    expect(top(game).left).toBeCloseTo(0.3);
    expect(top(game).width).toBeCloseTo(0.5);
    expect(stacked(host)).toBe('1');
    expect(host.querySelectorAll('.cake-layer--falling')).toHaveLength(1);
    advance(800);
    expect(host.querySelectorAll('.cake-layer--falling')).toHaveLength(0);
    // Next layer has the trimmed width.
    expect(game.state.moving.width).toBeCloseTo(0.5);
    game.destroy();
  });

  test('a near-perfect drop snaps with no trim', () => {
    const { host, game } = setup({ toStack: 5 });
    dropAt(game, host, 0.205);
    expect(top(game).left).toBeCloseTo(0.2);
    expect(top(game).width).toBeCloseTo(0.6);
    expect(host.querySelectorAll('.cake-layer--falling')).toHaveLength(0);
    expect(host.querySelector('.cake-toast').textContent).toContain('מושלם');
    game.destroy();
  });

  test('missing the cake entirely loses — possible from the first layer', () => {
    const { host, game, onGameOver, onComplete } = setup();
    // The slide reaches fully past the base on both sides.
    advance(5000);
    dropAt(game, host, -0.45); // −0.45–0.15 vs base 0.2–0.8: no overlap
    advance(800);
    expect(onGameOver).toHaveBeenCalledWith('השכבה נפלה מהעוגה!');
    expect(onComplete).not.toHaveBeenCalled();
    game.destroy();
  });

  test('stacking toStack layers wins and shows the cherry', () => {
    const { host, game, onComplete } = setup({ toStack: 3 });
    for (let i = 0; i < 3; i++) dropAt(game, host, top(game).left);
    expect(host.querySelector('.cake-game').classList.contains('cake-game--done')).toBe(true);
    advance(800);
    expect(onComplete).toHaveBeenCalledTimes(1);
    tap(host); // no more drops after the end
    expect(game.state.layers).toHaveLength(4);
    game.destroy();
  });

  test('space and enter drop too', () => {
    const { game } = setup({ toStack: 5 });
    for (const init of [{ code: 'Space', key: ' ' }, { key: 'Enter' }]) {
      const n = game.state.layers.length;
      game.state.moving.left = top(game).left;
      window.dispatchEvent(new KeyboardEvent('keydown', init));
      expect(game.state.layers.length).toBe(n + 1);
    }
    game.destroy();
  });

  test('camera scrolls once the cake is tall', () => {
    const { host, game } = setup({ toStack: 20 });
    for (let i = 0; i < 8; i++) dropAt(game, host, top(game).left);
    expect(Number(host.querySelector('.cake-stack').style.getPropertyValue('--cam'))).toBe(3);
    game.destroy();
  });

  test('pause freezes the slide and ignores drops; resume continues', () => {
    const { host, game } = setup();
    advance(200);
    const left = game.state.moving.left;
    game.pause();
    advance(5000);
    expect(game.state.moving.left).toBe(left);
    tap(host);
    expect(game.state.layers).toHaveLength(1);
    game.resume();
    advance(200);
    expect(game.state.moving.left).not.toBe(left);
    game.destroy();
  });

  test('destroy removes listeners and pending callbacks', () => {
    const { host, game, onComplete } = setup({ toStack: 1 });
    dropAt(game, host, top(game).left); // win pending
    game.destroy();
    advance(2000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })),
    ).not.toThrow();
    expect(host.innerHTML).toBe('');
  });
});
