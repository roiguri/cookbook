import { jest } from '@jest/globals';
import { GardenHarvestGame } from 'src/lib/games/garden_harvest.js';

// Fake timers drive the rAF loop. Math.random is scripted per test:
// with 0.5 every pop is a vegetable (worm chance 0.22) in a middle hole.
function setup(config = {}, random = 0.5) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host');
  jest.spyOn(Math, 'random').mockReturnValue(random);
  const onComplete = jest.fn();
  const onGameOver = jest.fn();
  const onInteraction = jest.fn();
  const game = new GardenHarvestGame(host, {
    toHarvest: 3,
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
const upHoles = (host) => [...host.querySelectorAll('.garden-hole[data-state="up"]')];
const pips = (host) => host.querySelectorAll('.garden-strike-pip--filled').length;
const harvested = (host) => host.querySelector('#garden-harvested').textContent;
const FIRST_POP_MS = 450;

describe('GardenHarvestGame', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    GardenHarvestGame.resetSession();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('start card gates play; nothing pops before התחל', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const onInteraction = jest.fn();
    const game = new GardenHarvestGame(host, { onInteraction });
    game.start();
    advance(3000);
    expect(upHoles(host)).toHaveLength(0);
    host.querySelector('.game-start-btn').click();
    expect(onInteraction).toHaveBeenCalledTimes(1);
    advance(FIRST_POP_MS);
    expect(upHoles(host)).toHaveLength(1);
    game.destroy();
  });

  test('tapping a vegetable harvests it', () => {
    const { host, game } = setup({ toHarvest: 10 });
    advance(FIRST_POP_MS);
    const [hole] = upHoles(host);
    expect(hole.dataset.kind).toBe('veg');
    hole.click();
    expect(harvested(host)).toBe('1');
    expect(hole.dataset.state).toBe('hit');
    hole.click(); // double tap on the same item counts once
    expect(harvested(host)).toBe('1');
    game.destroy();
  });

  test('a vegetable that sinks unpicked is a strike', () => {
    const { host, game } = setup({ maxStrikes: 9 });
    advance(FIRST_POP_MS + 1750);
    expect(pips(host)).toBeGreaterThanOrEqual(1);
    game.destroy();
  });

  test('tapping a worm is a strike; an untouched worm is not', () => {
    // random 0.1 → every pop is a worm.
    const { host, game } = setup({ maxStrikes: 9 }, 0.1);
    advance(FIRST_POP_MS);
    const [worm] = upHoles(host);
    expect(worm.dataset.kind).toBe('worm');
    worm.click();
    expect(pips(host)).toBe(1);
    advance(5000); // more worms pop and sink on their own
    expect(pips(host)).toBe(1);
    game.destroy();
  });

  test('tapping an empty hole does nothing', () => {
    const { host, game } = setup();
    host.querySelector('.garden-hole').click();
    expect(pips(host)).toBe(0);
    expect(harvested(host)).toBe('0');
    game.destroy();
  });

  test('never more than three items above ground', () => {
    const { host, game } = setup({ maxStrikes: 99 }, 0.1);
    for (let i = 0; i < 40; i++) {
      advance(100);
      expect(
        host.querySelectorAll('.garden-hole:not([data-state="empty"])').length,
      ).toBeLessThanOrEqual(3);
    }
    game.destroy();
  });

  test('harvesting toHarvest wins; strikes up to maxStrikes lose', () => {
    const win = setup({ toHarvest: 2 });
    let picked = 0;
    for (let i = 0; i < 50 && picked < 2; i++) {
      advance(100);
      for (const h of upHoles(win.host)) {
        h.click();
        picked++;
      }
    }
    advance(500);
    expect(win.onComplete).toHaveBeenCalledTimes(1);
    win.game.destroy();

    const lose = setup({ maxStrikes: 2 }, 0.1);
    advance(FIRST_POP_MS);
    upHoles(lose.host)[0].click();
    advance(1000);
    upHoles(lose.host)[0].click();
    advance(500);
    expect(lose.onGameOver).toHaveBeenCalledWith('הגינה נשארה בלי קציר!');
    lose.game.destroy();
  });

  test('destroy stops the loop and pending callbacks', () => {
    const { host, game, onComplete } = setup({ toHarvest: 1 });
    advance(FIRST_POP_MS);
    upHoles(host)[0].click(); // win pending
    game.destroy();
    advance(3000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe('');
  });
});
