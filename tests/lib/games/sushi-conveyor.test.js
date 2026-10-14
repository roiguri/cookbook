import { jest } from '@jest/globals';
import { SushiConveyorGame } from 'src/lib/games/sushi_conveyor.js';

// Fake timers drive the rAF loop. Base patience is 16s.
function setup(config = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host');
  const onComplete = jest.fn();
  const onGameOver = jest.fn();
  const onInteraction = jest.fn();
  const game = new SushiConveyorGame(host, {
    ordersToWin: 2,
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
const pips = (host) => host.querySelectorAll('.sushi-strike-pip--filled').length;
const served = (host) => host.querySelector('#sushi-served').textContent;
const neededKeys = (host) =>
  [...host.querySelectorAll('.sushi-slot:not(.sushi-slot--done)')].map((s) => s.dataset.dish);
const livePlates = (host) => [
  ...host.querySelectorAll('.sushi-plate:not(.sushi-plate--taken):not(.sushi-plate--wrong)'),
];

// Tap plates that the order needs until it's served (or time runs out).
function serveCurrentOrder(host, maxMs = 15000) {
  const startServed = served(host);
  for (let t = 0; t < maxMs && served(host) === startServed; t += 100) {
    const need = neededKeys(host);
    const plate = livePlates(host).find((p) => need.includes(p.dataset.dish));
    if (plate) plate.click();
    else advance(100);
  }
}

describe('SushiConveyorGame', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    SushiConveyorGame.resetSession();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('start card gates play; order and belt appear on התחל', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const onInteraction = jest.fn();
    const game = new SushiConveyorGame(host, { onInteraction });
    game.start();
    advance(2000);
    expect(host.querySelectorAll('.sushi-plate')).toHaveLength(0);
    host.querySelector('.game-start-btn').click();
    expect(onInteraction).toHaveBeenCalledTimes(1);
    expect(neededKeys(host)).toHaveLength(3);
    expect(host.querySelectorAll('.sushi-plate').length).toBeGreaterThan(0);
    game.destroy();
  });

  test('order dishes are distinct', () => {
    const { host, game } = setup();
    expect(new Set(neededKeys(host)).size).toBe(3);
    game.destroy();
  });

  test('tapping an ordered dish checks it off; completing the order serves it', () => {
    const { host, game } = setup({ ordersToWin: 5 });
    serveCurrentOrder(host);
    expect(served(host)).toBe('1');
    expect(pips(host)).toBe(0);
    advance(700); // next order arrives
    expect(neededKeys(host)).toHaveLength(3);
    game.destroy();
  });

  test('tapping a dish that is not in the order is a strike', () => {
    const { host, game } = setup();
    let wrong;
    for (let t = 0; t < 10000 && !wrong; t += 100) {
      const need = neededKeys(host);
      wrong = livePlates(host).find((p) => !need.includes(p.dataset.dish));
      if (!wrong) advance(100);
    }
    wrong.click();
    expect(pips(host)).toBe(1);
    game.destroy();
  });

  test('running out of patience is a strike and brings a new order', () => {
    const { host, game } = setup();
    advance(16100);
    expect(pips(host)).toBe(1);
    expect(host.querySelector('.sushi-customer').dataset.mood).toBe('angry');
    advance(700);
    expect(neededKeys(host)).toHaveLength(3);
    game.destroy();
  });

  test('plates move right to left and leave the belt', () => {
    const { host, game } = setup();
    const plate = livePlates(host)[0];
    const x0 = Number(plate.style.getPropertyValue('--x'));
    advance(1000);
    expect(Number(plate.style.getPropertyValue('--x'))).toBeLessThan(x0);
    advance(13000);
    expect(plate.isConnected).toBe(false);
    game.destroy();
  });

  test('pause freezes belt and patience; taps are ignored; resume continues', () => {
    const { host, game } = setup();
    advance(1000);
    const plate = livePlates(host)[0];
    const x = plate.style.getPropertyValue('--x');
    const patience = host.querySelector('.sushi-patience').style.getPropertyValue('--patience');
    game.pause();
    advance(30000);
    expect(plate.style.getPropertyValue('--x')).toBe(x);
    expect(host.querySelector('.sushi-patience').style.getPropertyValue('--patience')).toBe(
      patience,
    );
    expect(pips(host)).toBe(0);
    plate.click();
    expect(pips(host)).toBe(0);
    game.resume();
    advance(500);
    expect(plate.style.getPropertyValue('--x')).not.toBe(x);
    game.destroy();
  });

  test('serving ordersToWin wins; three strikes loses', () => {
    const win = setup({ ordersToWin: 2 });
    serveCurrentOrder(win.host);
    advance(700);
    serveCurrentOrder(win.host);
    advance(500);
    expect(win.onComplete).toHaveBeenCalledTimes(1);
    win.game.destroy();

    const lose = setup();
    advance(3 * 16700);
    expect(lose.onGameOver).toHaveBeenCalledWith('הלקוחות יצאו רעבים!');
    expect(lose.onComplete).not.toHaveBeenCalled();
    lose.game.destroy();
  });

  test('destroy stops the loop and pending callbacks', () => {
    const { host, game, onGameOver } = setup({ maxStrikes: 1 });
    advance(16100); // game over pending
    game.destroy();
    advance(3000);
    expect(onGameOver).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe('');
  });
});
