import { jest } from '@jest/globals';
import { MarketSortGame } from 'src/lib/games/market_sort.js';

// Fake timers drive the rAF loop. Base fall speed is 0.2 field-heights per
// second, so an untouched item lands after ~5s.
function setup(config = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host');
  const onComplete = jest.fn();
  const onGameOver = jest.fn();
  const onInteraction = jest.fn();
  const game = new MarketSortGame(host, {
    toSort: 3,
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

const advance = (ms) => jest.advanceTimersByTime(ms);
const current = (host) => host.querySelector('.market-item:not([class*="market-item--"])');
const pips = (host) => host.querySelectorAll('.market-strike-pip--filled').length;
const sorted = (host) => host.querySelector('#market-sorted').textContent;
const basket = (host, kind) => host.querySelector(`.market-basket--${kind}`);
const other = (kind) => (kind === 'fruit' ? 'veg' : 'fruit');
const NEXT_MS = 450; // nextItemDelaySec + a frame

describe('MarketSortGame', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MarketSortGame.resetSession();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('start card gates play; first item drops on התחל', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const onInteraction = jest.fn();
    const game = new MarketSortGame(host, { onInteraction });
    game.start();
    advance(2000);
    expect(host.querySelector('.market-item')).toBeNull();
    host.querySelector('.game-start-btn').click();
    expect(onInteraction).toHaveBeenCalledTimes(1);
    expect(current(host)).not.toBeNull();
    game.destroy();
  });

  test('correct basket counts; wrong basket is a strike', () => {
    const { host, game } = setup({ toSort: 10 });
    const kind = current(host).dataset.kind;
    basket(host, kind).click();
    expect(sorted(host)).toBe('1');
    expect(current(host)).toBeNull(); // short gap before the next item
    advance(NEXT_MS);
    const kind2 = current(host).dataset.kind;
    basket(host, other(kind2)).click();
    expect(sorted(host)).toBe('1');
    expect(pips(host)).toBe(1);
    game.destroy();
  });

  test('arrow keys and swipes sort too', () => {
    const { host, game } = setup({ toSort: 10 });
    const key = (kind) =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: kind === 'fruit' ? 'ArrowRight' : 'ArrowLeft' }),
      );
    key(current(host).dataset.kind);
    expect(sorted(host)).toBe('1');
    advance(NEXT_MS);

    const field = host.querySelector('.market-field');
    const kind = current(host).dataset.kind;
    const dx = kind === 'fruit' ? 80 : -80;
    // jsdom lacks PointerEvent; a MouseEvent with pointerId set is enough.
    const ev = (type, x) => {
      const e = new MouseEvent(type, { clientX: x, bubbles: true });
      e.pointerId = 1;
      return e;
    };
    field.dispatchEvent(ev('pointerdown', 200));
    field.dispatchEvent(ev('pointerup', 200 + dx));
    expect(sorted(host)).toBe('2');
    game.destroy();
  });

  test('a short drag is not a swipe', () => {
    const { host, game } = setup();
    const field = host.querySelector('.market-field');
    const ev = (type, x) => {
      const e = new MouseEvent(type, { clientX: x, bubbles: true });
      e.pointerId = 1;
      return e;
    };
    field.dispatchEvent(ev('pointerdown', 200));
    field.dispatchEvent(ev('pointerup', 215));
    expect(sorted(host)).toBe('0');
    expect(pips(host)).toBe(0);
    game.destroy();
  });

  test('an item that reaches the floor is a strike', () => {
    const { host, game } = setup();
    advance(5300);
    expect(pips(host)).toBe(1);
    game.destroy();
  });

  test('sorting toSort items wins', () => {
    const { host, onComplete, onGameOver, game } = setup({ toSort: 3 });
    for (let i = 0; i < 3; i++) {
      basket(host, current(host).dataset.kind).click();
      advance(NEXT_MS);
    }
    advance(500);
    expect(onComplete).toHaveBeenCalledTimes(1);
    advance(20000);
    expect(onGameOver).not.toHaveBeenCalled();
    game.destroy();
  });

  test('three strikes loses; input after the end is ignored', () => {
    const { host, onGameOver, onComplete, game } = setup();
    for (let i = 0; i < 3; i++) {
      basket(host, other(current(host).dataset.kind)).click();
      advance(NEXT_MS);
    }
    advance(500);
    expect(onGameOver).toHaveBeenCalledWith('יותר מדי טעויות במיון!');
    basket(host, 'fruit').click();
    expect(onComplete).not.toHaveBeenCalled();
    game.destroy();
  });

  test('pause freezes the fall and ignores input; resume continues', () => {
    const { host, game } = setup();
    advance(1000);
    const y = current(host).style.getPropertyValue('--y');
    game.pause();
    advance(20000);
    expect(current(host).style.getPropertyValue('--y')).toBe(y);
    expect(pips(host)).toBe(0);
    basket(host, current(host).dataset.kind).click();
    expect(sorted(host)).toBe('0');
    game.resume();
    advance(500);
    expect(Number(current(host).style.getPropertyValue('--y'))).toBeGreaterThan(Number(y));
    game.destroy();
  });

  test('destroy removes the key listener and pending callbacks', () => {
    const { host, game, onComplete } = setup({ toSort: 1 });
    basket(host, current(host).dataset.kind).click(); // win pending
    game.destroy();
    advance(2000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })),
    ).not.toThrow();
    expect(host.innerHTML).toBe('');
  });
});
