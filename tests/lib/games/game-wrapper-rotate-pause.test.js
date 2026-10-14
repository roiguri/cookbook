import { jest } from '@jest/globals';
import { GameWrapper } from 'src/lib/games/game_wrapper.js';

// jsdom has no matchMedia; <rotate-prompt> only reads it when mounted, so
// installing the stub after the import is enough. One controllable
// MediaQueryList stands in for every query, so `setMatches()` simulates
// rotating the phone.
let mqlMatches = false;
const mqlListeners = new Set();
function setMatches(value) {
  mqlMatches = value;
  for (const fn of mqlListeners) fn();
}
window.matchMedia = () => ({
  get matches() {
    return mqlMatches;
  },
  addEventListener: (_type, fn) => mqlListeners.add(fn),
  removeEventListener: (_type, fn) => mqlListeners.delete(fn),
});

class FakeGame {
  constructor(container, config) {
    this.config = config;
    this.pause = jest.fn();
    this.resume = jest.fn();
    FakeGame.last = this;
  }
  start() {
    this.config.onInteraction(); // starts the wrapper timer
  }
  destroy() {}
}

class FakeGameNoPause {
  constructor(container, config) {
    this.config = config;
  }
  start() {}
  destroy() {}
}

function mount(GameClass, preferredOrientation = 'landscape') {
  document.body.innerHTML = '<div id="host"></div>';
  const wrapper = new GameWrapper(document.getElementById('host'), GameClass, {
    preferredOrientation,
  });
  wrapper.init();
  return wrapper;
}

describe('GameWrapper pauses games behind the rotate prompt', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mqlListeners.clear();
    mqlMatches = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rotating into the wrong orientation pauses; rotating back resumes', () => {
    const wrapper = mount(FakeGame);
    expect(FakeGame.last.pause).not.toHaveBeenCalled();
    setMatches(true);
    expect(FakeGame.last.pause).toHaveBeenCalledTimes(1);
    setMatches(false);
    expect(FakeGame.last.resume).toHaveBeenCalledTimes(1);
    wrapper.destroy();
  });

  test('"continue anyway" resumes the game', () => {
    const wrapper = mount(FakeGame);
    setMatches(true);
    const prompt = document.querySelector('rotate-prompt');
    prompt.shadowRoot.querySelector('.rotate-prompt__dismiss').click();
    expect(FakeGame.last.resume).toHaveBeenCalledTimes(1);
    // Already dismissed: further rotations don't pause again.
    setMatches(false);
    setMatches(true);
    expect(FakeGame.last.pause).toHaveBeenCalledTimes(1);
    wrapper.destroy();
  });

  test('a game opened while the prompt is already up starts paused', () => {
    mqlMatches = true;
    const wrapper = mount(FakeGame);
    expect(FakeGame.last.pause).toHaveBeenCalledTimes(1);
    wrapper.destroy();
  });

  test('the wrapper timer does not count paused time', () => {
    const wrapper = mount(FakeGame);
    jest.advanceTimersByTime(3000);
    setMatches(true);
    jest.advanceTimersByTime(60000);
    setMatches(false);
    jest.advanceTimersByTime(2000);
    expect(document.querySelector('#game-timer').textContent).toBe('00:05');
    wrapper.destroy();
  });

  test('games without pause()/resume() are left alone', () => {
    const wrapper = mount(FakeGameNoPause);
    expect(() => setMatches(true)).not.toThrow();
    wrapper.destroy();
  });

  test('destroy unbinds the listener', () => {
    const wrapper = mount(FakeGame);
    const game = FakeGame.last;
    wrapper.destroy();
    setMatches(true);
    expect(game.pause).not.toHaveBeenCalled();
  });
});
