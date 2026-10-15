import { jest } from '@jest/globals';
import { ChefSaysGame } from 'src/lib/games/chef_says.js';

// Drive the game with fake timers and a scripted Math.random so the sequence
// is known: each round appends the next value from `picks`.
function setup({ picks = [0, 1, 2, 3, 0, 1, 2], roundsToWin = 3 } = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host');
  let i = 0;
  jest.spyOn(Math, 'random').mockImplementation(() => (picks[i++ % picks.length] + 0.5) / 4);
  const onComplete = jest.fn();
  const onGameOver = jest.fn();
  const onInteraction = jest.fn();
  const game = new ChefSaysGame(host, { roundsToWin, onComplete, onGameOver, onInteraction });
  return { host, game, onComplete, onGameOver, onInteraction };
}

const board = (host) => host.querySelector('.chef-board');
const pad = (host, index) => host.querySelector(`.chef-pad[data-index="${index}"]`);
const tap = (host, index) => pad(host, index).click();
const finishPlayback = () => jest.advanceTimersByTime(20000);

describe('ChefSaysGame', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    ChefSaysGame.resetSession();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('shows the start card first; nothing plays until התחל', () => {
    const { host, game, onInteraction } = setup();
    game.start();
    expect(host.querySelector('.game-start-overlay')).not.toBeNull();
    expect(board(host).dataset.phase).toBe('idle');
    expect(onInteraction).not.toHaveBeenCalled();

    host.querySelector('.game-start-btn').click();
    expect(host.querySelector('.game-start-overlay')).toBeNull();
    expect(onInteraction).toHaveBeenCalledTimes(1);
    expect(board(host).dataset.phase).toBe('showing');
  });

  test('restart within a session skips the start card', () => {
    const first = setup();
    first.game.start();
    first.game.destroy();

    const second = setup();
    second.game.start();
    expect(second.host.querySelector('.game-start-overlay')).toBeNull();
    expect(board(second.host).dataset.phase).toBe('showing');
  });

  test('taps are ignored while the chef is showing the sequence', () => {
    const { host, game, onGameOver } = setup();
    game.start();
    host.querySelector('.game-start-btn').click();
    tap(host, 3); // wrong pad, but input is not open yet
    expect(onGameOver).not.toHaveBeenCalled();
  });

  test('lights the sequence pads during playback', () => {
    const { host, game } = setup();
    game.start();
    host.querySelector('.game-start-btn').click();
    jest.advanceTimersByTime(650); // past firstDelayMs
    expect(pad(host, 0).classList.contains('chef-pad--lit')).toBe(true);
    finishPlayback();
    expect(board(host).dataset.phase).toBe('input');
  });

  test('repeating every round wins after roundsToWin', () => {
    const { host, game, onComplete, onGameOver } = setup({ roundsToWin: 3 });
    game.start();
    host.querySelector('.game-start-btn').click();

    const seq = [0, 1, 2];
    for (let round = 1; round <= 3; round++) {
      finishPlayback();
      expect(host.querySelector('#chef-round').textContent).toBe(String(round));
      seq.slice(0, round).forEach((p) => tap(host, p));
    }
    jest.advanceTimersByTime(1000);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onGameOver).not.toHaveBeenCalled();
  });

  test('a wrong tap ends the run and names the expected ingredient', () => {
    const { host, game, onGameOver, onComplete } = setup();
    game.start();
    host.querySelector('.game-start-btn').click();
    finishPlayback();
    tap(host, 2); // expected 0 (tomato)
    expect(pad(host, 0).classList.contains('chef-pad--hint')).toBe(true);
    // Further taps after the mistake do nothing.
    tap(host, 0);
    jest.advanceTimersByTime(1000);
    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(onGameOver.mock.calls[0][0]).toContain('עגבנייה');
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('destroy mid-playback clears pending timers', () => {
    const { host, game, onGameOver, onComplete } = setup();
    game.start();
    host.querySelector('.game-start-btn').click();
    game.destroy();
    expect(jest.getTimerCount()).toBe(0);
    expect(host.innerHTML).toBe('');
    jest.advanceTimersByTime(20000);
    expect(onGameOver).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
