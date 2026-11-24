#!/usr/bin/env node
/**
 * Builds the 100% self-contained offline HTML host for all 8 Cookbook mini-games
 * and writes `apps/mobile/src/games-host/bundled-games-html.generated.ts`.
 *
 * - Recursively discovers PNG/SVG assets under `src/lib/games/assets/**`
 *   (root burger sprites, nested `pizzatron/*.png`, nested `knife/*.svg`)
 * - Bundles `src/lib/games/game_wrapper.js` + all 8 games + all CSS via esbuild
 * - Rewrites CSS `url('./assets/...')` to `:root` CSS custom properties backed by
 *   `window.__COOKBOOK_ASSETS__` (each base64 asset stored once, zero duplication)
 * - Rewrites `new URL('./assets/...', import.meta.url)` to `window.__resolveCookbookAsset(...)`
 * - Replaces `<rotate-prompt>` with a silent no-op custom element (native owns orientation)
 * - Installs an rAF + setTimeout + setInterval pause/resume host shim alongside game.pause()/resume()
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT_DIR, 'src/lib/games');
const ASSETS_DIR = path.join(GAMES_DIR, 'assets');
const TOKENS_CSS_PATH = path.join(ROOT_DIR, 'src/styles/tokens.css');
const OUT_FILE = path.join(ROOT_DIR, 'apps/mobile/src/games-host/bundled-games-html.generated.ts');

const require = createRequire(import.meta.url);
const esbuild = require(path.join(ROOT_DIR, 'node_modules/esbuild'));

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walkFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return null;
}

/**
 * Recursively scan `src/lib/games/assets/**` and collect all runtime sprites
 * (referenced in game CSS/JS + all knife SVGs + all `_small`/`_medium` sprites),
 * skipping unused multi-MB `_full.png` / raw source art that has a `_small.png` sibling.
 */
function buildAssetRegistry() {
  const allAssetFiles = walkFiles(ASSETS_DIR).filter((f) => getMimeType(f) !== null);
  const allRelSet = new Set(allAssetFiles.map((f) => toPosix(path.relative(GAMES_DIR, f))));

  // Collect every explicitly referenced asset path in CSS & JS under src/lib/games/
  const referencedRelPaths = new Set();
  for (const filePath of walkFiles(GAMES_DIR)) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.css' && ext !== '.js') continue;
    const text = fs.readFileSync(filePath, 'utf8');
    const urlMatches = text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g);
    for (const m of urlMatches) {
      const raw = m[1].trim();
      if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) {
        continue;
      }
      const abs = path.resolve(path.dirname(filePath), raw);
      const rel = toPosix(path.relative(GAMES_DIR, abs));
      referencedRelPaths.add(rel);
    }
  }

  // Always include every SVG under assets/knife/ (dynamically referenced via template literals)
  for (const rel of allRelSet) {
    if (rel.startsWith('assets/knife/') && rel.endsWith('.svg')) {
      referencedRelPaths.add(rel);
    }
  }

  // Verify every referenced asset exists on disk
  for (const rel of referencedRelPaths) {
    if (!allRelSet.has(rel)) {
      throw new Error(`Referenced game asset missing on disk: ${rel}`);
    }
  }

  // Include all referenced assets (and any `_small.png` / `_medium.png` runtime variants)
  const includedRelPaths = [...allRelSet].filter((rel) => {
    if (referencedRelPaths.has(rel)) return true;
    if (rel.endsWith('_small.png') || rel.endsWith('_medium.png') || rel.endsWith('.svg')) {
      return true;
    }
    return false;
  });

  const dataUris = {};
  const cssVars = {};
  let idx = 0;

  for (const rel of includedRelPaths) {
    const abs = path.join(GAMES_DIR, rel);
    const mime = getMimeType(abs);
    const b64 = fs.readFileSync(abs).toString('base64');
    dataUris[rel] = `data:${mime};base64,${b64}`;
    cssVars[rel] = `--cb-asset-${idx}`;
    idx += 1;
  }

  return { dataUris, cssVars, count: includedRelPaths.length };
}

function rewriteCssAssetUrls(cssText, cssFilePath, assetRegistry) {
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (fullMatch, _quote, rawUrl) => {
    const trimmed = rawUrl.trim();
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('#')
    ) {
      return fullMatch;
    }
    const abs = path.resolve(path.dirname(cssFilePath), trimmed);
    const rel = toPosix(path.relative(GAMES_DIR, abs));
    const varName = assetRegistry.cssVars[rel];
    if (!varName) {
      throw new Error(`Unmapped CSS asset URL "${trimmed}" (resolved "${rel}") in ${cssFilePath}`);
    }
    return `var(${varName})`;
  });
}

function escapeForHtmlScript(text) {
  return text.replace(/<\/script/gi, '<\\/script');
}

function escapeForHtmlStyle(text) {
  return text.replace(/<\/style/gi, '<\\/style');
}

async function bundleGamesEngine(assetRegistry) {
  const virtualEntry = `
    import { GameWrapper, GAME_STYLES } from './src/lib/games/game_wrapper.js';
    window.__COOKBOOK_GAMES_ENGINE__ = { GameWrapper, GAME_STYLES };
  `;

  const result = await esbuild.build({
    stdin: {
      contents: virtualEntry,
      resolveDir: ROOT_DIR,
      sourcefile: 'mobile-games-entry.js',
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    define: {
      'import.meta.url': '"https://cookbook.local/src/lib/games/index.js"',
    },
    plugins: [
      {
        name: 'cookbook-mobile-games-offline',
        setup(build) {
          // 1. Suppress <rotate-prompt> web component inside native host
          build.onResolve({ filter: /rotate-prompt\.js$/ }, (args) => ({
            path: args.path,
            namespace: 'cookbook-rotate-prompt-stub',
          }));

          build.onLoad({ filter: /.*/, namespace: 'cookbook-rotate-prompt-stub' }, () => ({
            contents: `
              class RotatePromptStub extends HTMLElement {
                reset() {}
              }
              if (typeof customElements !== 'undefined' && !customElements.get('rotate-prompt')) {
                customElements.define('rotate-prompt', RotatePromptStub);
              }
              export { RotatePromptStub as RotatePrompt };
            `,
            loader: 'js',
          }));

          // 2. Inline `?inline` CSS imports with rewritten asset CSS variables
          build.onResolve({ filter: /\.css\?inline$/ }, (args) => {
            const cleanRel = args.path.replace(/\?inline$/, '');
            const resolved = path.resolve(args.resolveDir, cleanRel);
            return {
              path: resolved,
              namespace: 'cookbook-inline-css',
            };
          });

          build.onLoad({ filter: /.*/, namespace: 'cookbook-inline-css' }, (args) => {
            const rawCss = fs.readFileSync(args.path, 'utf8');
            const rewritten = rewriteCssAssetUrls(rawCss, args.path, assetRegistry);
            return {
              contents: `export default ${JSON.stringify(rewritten)};`,
              loader: 'js',
            };
          });

          // 3. Rewrite `new URL(<expr>, import.meta.url)` inside src/lib/games/*.js
          build.onLoad({ filter: /src[\\/]lib[\\/]games[\\/][^\\/]+\.js$/ }, (args) => {
            const source = fs.readFileSync(args.path, 'utf8');
            if (!source.includes('import.meta.url')) {
              return null;
            }
            const transformed = source.replace(
              /new\s+URL\(\s*([^,]+?)\s*,\s*import\.meta\.url\s*\)/g,
              'window.__resolveCookbookAsset($1)',
            );
            return {
              contents: transformed,
              loader: 'js',
              resolveDir: path.dirname(args.path),
            };
          });
        },
      },
    ],
  });

  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new Error('esbuild produced no output for mobile games bundle');
  }

  return result.outputFiles[0].text;
}

function buildHtmlDocument(tokensCss, assetRegistry, gamesBundleJs) {
  const bootstrapScript = `
(function () {
  'use strict';

  var ASSETS = ${JSON.stringify(assetRegistry.dataUris)};
  var ASSET_VARS = ${JSON.stringify(assetRegistry.cssVars)};
  window.__COOKBOOK_ASSETS__ = ASSETS;

  // Lazily inject ONLY the :root CSS custom properties needed by the active sprite-backed
  // game (burger / pizza / knife) so emoji/canvas games paint instantly and sprite games
  // avoid stalling WKWebView/Chromium on unrelated assets during orientation changes.
  var injectedAssetGroups = {};
  window.__ensureCookbookAssetVars = function (gameKey) {
    if (gameKey !== 'burger' && gameKey !== 'pizza' && gameKey !== 'knife') return;
    if (injectedAssetGroups[gameKey]) return;
    injectedAssetGroups[gameKey] = true;
    var varRules = [];
    for (var key in ASSET_VARS) {
      if (!Object.prototype.hasOwnProperty.call(ASSET_VARS, key) || !ASSETS[key]) continue;
      if (gameKey === 'pizza' && key.indexOf('assets/pizzatron/') !== 0) continue;
      if (gameKey === 'knife' && key.indexOf('assets/knife/') !== 0) continue;
      if (
        gameKey === 'burger' &&
        (key.indexOf('assets/pizzatron/') === 0 || key.indexOf('assets/knife/') === 0)
      ) {
        continue;
      }
      varRules.push(ASSET_VARS[key] + ':url("' + ASSETS[key] + '");');
    }
    if (varRules.length === 0) return;
    var assetStyleEl = document.createElement('style');
    assetStyleEl.id = 'cookbook-asset-vars-' + gameKey;
    assetStyleEl.textContent = ':root{' + varRules.join('') + '}';
    document.head.appendChild(assetStyleEl);
  };

  // Offline resolver for new URL('./assets/...', import.meta.url)
  window.__resolveCookbookAsset = function (relPath) {
    var normalized = String(relPath || '')
      .replace(/^\\.\\//, '')
      .replace(/^\\//, '');
    var dataUri = ASSETS[normalized] || ASSETS['assets/' + normalized];
    if (dataUri) {
      try {
        return new URL(dataUri);
      } catch (_err) {
        return { href: dataUri, toString: function () { return dataUri; } };
      }
    }
    return new URL(String(relPath || ''), 'https://cookbook.local/src/lib/games/');
  };

  // Host-level rAF + setTimeout + setInterval pause/resume shim so ALL 8 games freeze cleanly
  // when the mobile app goes to background (AppState !== 'active').
  var nativeRAF = window.requestAnimationFrame.bind(window);
  var nativeCancelRAF = window.cancelAnimationFrame.bind(window);
  var nativeSetTimeout = window.setTimeout.bind(window);
  var nativeClearTimeout = window.clearTimeout.bind(window);

  var hostPaused = false;
  var nextRafId = 1;
  var activeRafs = new Map();
  var pausedRafQueue = [];

  window.requestAnimationFrame = function (cb) {
    var id = nextRafId++;
    var entry = { cb: cb, nativeId: null };
    activeRafs.set(id, entry);
    if (hostPaused) {
      pausedRafQueue.push(id);
    } else {
      entry.nativeId = nativeRAF(function (ts) {
        if (!activeRafs.has(id)) return;
        if (hostPaused) {
          entry.nativeId = null;
          pausedRafQueue.push(id);
          return;
        }
        activeRafs.delete(id);
        cb(ts);
      });
    }
    return id;
  };

  window.cancelAnimationFrame = function (id) {
    var entry = activeRafs.get(id);
    if (entry) {
      if (entry.nativeId !== null) nativeCancelRAF(entry.nativeId);
      activeRafs.delete(id);
    }
  };

  var nextTimerId = 1;
  var activeTimeouts = new Map();
  var activeIntervals = new Map();

  function scheduleTimeout(id, entry) {
    entry.fireAt = Date.now() + entry.remaining;
    entry.nativeId = nativeSetTimeout(function () {
      if (!activeTimeouts.has(id)) return;
      if (hostPaused) {
        entry.remaining = 0;
        entry.nativeId = null;
        return;
      }
      activeTimeouts.delete(id);
      if (typeof entry.fn === 'function') {
        entry.fn.apply(window, entry.args);
      }
    }, entry.remaining);
  }

  function scheduleInterval(id, entry) {
    entry.nextFireAt = Date.now() + entry.remaining;
    entry.nativeId = nativeSetTimeout(function () {
      if (!activeIntervals.has(id)) return;
      if (hostPaused) {
        entry.remaining = 0;
        entry.nativeId = null;
        return;
      }
      entry.remaining = entry.interval;
      scheduleInterval(id, entry);
      if (typeof entry.fn === 'function') {
        entry.fn.apply(window, entry.args);
      }
    }, entry.remaining);
  }

  window.setTimeout = function (fn, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    var id = nextTimerId++;
    var ms = Math.max(0, Number(delay) || 0);
    var entry = {
      fn: fn,
      args: args,
      remaining: ms,
      fireAt: Date.now() + ms,
      nativeId: null,
    };
    activeTimeouts.set(id, entry);
    if (!hostPaused) {
      scheduleTimeout(id, entry);
    }
    return id;
  };

  window.clearTimeout = function (id) {
    var entry = activeTimeouts.get(id);
    if (entry) {
      if (entry.nativeId !== null) nativeClearTimeout(entry.nativeId);
      activeTimeouts.delete(id);
    }
  };

  window.setInterval = function (fn, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    var id = nextTimerId++;
    var ms = Math.max(10, Number(delay) || 0);
    var entry = {
      fn: fn,
      args: args,
      interval: ms,
      remaining: ms,
      nextFireAt: Date.now() + ms,
      nativeId: null,
    };
    activeIntervals.set(id, entry);
    if (!hostPaused) {
      scheduleInterval(id, entry);
    }
    return id;
  };

  window.clearInterval = function (id) {
    var entry = activeIntervals.get(id);
    if (entry) {
      if (entry.nativeId !== null) nativeClearTimeout(entry.nativeId);
      activeIntervals.delete(id);
    }
  };

  window.__COOKBOOK_TIMER_SHIM__ = {
    nativeSetTimeout: nativeSetTimeout,
    nativeRAF: nativeRAF,
    isPaused: function () {
      return hostPaused;
    },
    pause: function () {
      if (hostPaused) return;
      hostPaused = true;
      var now = Date.now();

      activeRafs.forEach(function (entry, id) {
        if (entry.nativeId !== null) {
          nativeCancelRAF(entry.nativeId);
          entry.nativeId = null;
          pausedRafQueue.push(id);
        }
      });

      activeTimeouts.forEach(function (entry) {
        if (entry.nativeId !== null) {
          nativeClearTimeout(entry.nativeId);
          entry.nativeId = null;
        }
        entry.remaining = Math.max(0, entry.fireAt - now);
      });

      activeIntervals.forEach(function (entry) {
        if (entry.nativeId !== null) {
          nativeClearTimeout(entry.nativeId);
          entry.nativeId = null;
        }
        entry.remaining = Math.max(0, entry.nextFireAt - now);
      });
    },
    resume: function () {
      if (!hostPaused) return;
      hostPaused = false;

      activeTimeouts.forEach(function (entry, id) {
        if (entry.nativeId === null) {
          scheduleTimeout(id, entry);
        }
      });

      activeIntervals.forEach(function (entry, id) {
        if (entry.nativeId === null) {
          scheduleInterval(id, entry);
        }
      });

      var queue = pausedRafQueue.splice(0, pausedRafQueue.length);
      var seen = new Set();
      for (var i = 0; i < queue.length; i++) {
        var id = queue[i];
        if (seen.has(id)) continue;
        seen.add(id);
        var entry = activeRafs.get(id);
        if (entry && entry.nativeId === null) {
          (function (rafId, rafEntry) {
            rafEntry.nativeId = nativeRAF(function (ts) {
              if (!activeRafs.has(rafId)) return;
              if (hostPaused) {
                rafEntry.nativeId = null;
                pausedRafQueue.push(rafId);
                return;
              }
              activeRafs.delete(rafId);
              rafEntry.cb(ts);
            });
          })(id, entry);
        }
      }
    },
  };
})();
`;

  const bridgeScript = `
(function () {
  'use strict';

  var engine = window.__COOKBOOK_GAMES_ENGINE__;
  if (!engine || !engine.GameWrapper) {
    return;
  }

  var GameWrapper = engine.GameWrapper;
  var GAME_STYLES = engine.GAME_STYLES || '';
  var timerShim = window.__COOKBOOK_TIMER_SHIM__;

  // Inject GameWrapper + Memory/Burger/Pizzatron/Knife shared CSS
  var gameStyleEl = document.createElement('style');
  gameStyleEl.id = 'cookbook-game-styles';
  gameStyleEl.textContent = GAME_STYLES;
  document.head.appendChild(gameStyleEl);

  var rootEl = document.getElementById('cookbook-game-root');
  var currentWrapper = null;
  var currentGameKey = null;
  var currentPreferredOrientation = null;
  var pendingAsyncReady = false;

  function postToNative(payload) {
    try {
      var json = JSON.stringify(payload);
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        window.ReactNativeWebView.postMessage(json);
      }
    } catch (_err) {
      // Ignore postMessage failure outside ReactNativeWebView
    }
  }

  window.addEventListener('error', function (event) {
    postToNative({
      type: 'error',
      message: (event && event.message) ? String(event.message) : 'WebView script error',
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason ? String(event.reason) : 'Unhandled promise rejection';
    postToNative({ type: 'error', message: reason });
  });

  function wireWrapperCallbacks(wrapper) {
    var origComplete = wrapper.onGameComplete.bind(wrapper);
    wrapper.onGameComplete = function () {
      var elapsedMs = wrapper.startTime ? Math.max(0, Date.now() - wrapper.startTime) : 0;
      if (!wrapper.startTime) {
        wrapper.startTime = Date.now();
      }
      origComplete();
      postToNative({ type: 'haptic', style: 'success' });
      postToNative({ type: 'complete', elapsedMs: elapsedMs });
    };

    var origGameOver = wrapper.onGameOver.bind(wrapper);
    wrapper.onGameOver = function (reason) {
      origGameOver(reason);
      postToNative({ type: 'haptic', style: 'error' });
      postToNative({ type: 'gameover', reason: reason || 'המשחק נגמר' });
    };
  }

  function destroyCurrent() {
    if (timerShim && timerShim.isPaused()) {
      timerShim.resume();
    }
    if (currentWrapper) {
      try {
        currentWrapper.destroy();
      } catch (_err) {
        // Ignore cleanup errors
      }
      currentWrapper = null;
    }
    if (rootEl) {
      rootEl.innerHTML = '';
    }
  }

  function launchGame(gameKey, config) {
    if (!rootEl || !gameKey) return;
    destroyCurrent();

    var safeConfig = config && typeof config === 'object' ? Object.assign({}, config) : {};
    if (safeConfig.asyncReady && typeof safeConfig.asyncReady === 'object') {
      safeConfig.asyncReady = Object.assign({}, safeConfig.asyncReady, {
        onDismiss: function () {
          postToNative({ type: 'haptic', style: 'medium' });
          postToNative({ type: 'close' });
        },
      });
    }

    if (typeof window.__ensureCookbookAssetVars === 'function') {
      window.__ensureCookbookAssetVars(gameKey);
    }

    currentGameKey = gameKey;
    currentWrapper = GameWrapper.create(gameKey, rootEl, safeConfig);
    currentPreferredOrientation = currentWrapper.config.preferredOrientation || null;
    wireWrapperCallbacks(currentWrapper);
    currentWrapper.init();

    if (pendingAsyncReady) {
      currentWrapper.markAsyncReady();
    }

    // Trigger resize and wait for a real compositor frame (with 150ms safety fallback so
    // iOS orientation-rotation animations never starve rAF and stall 'ready').
    var readySent = false;
    var emitReady = function () {
      if (readySent) return;
      readySent = true;
      window.dispatchEvent(new Event('resize'));
      postToNative({
        type: 'ready',
        gameKey: currentGameKey,
        preferredOrientation: currentPreferredOrientation,
      });
    };
    if (timerShim && typeof timerShim.nativeRAF === 'function') {
      timerShim.nativeRAF(function () {
        timerShim.nativeRAF(emitReady);
      });
    }
    if (timerShim && timerShim.nativeSetTimeout) {
      timerShim.nativeSetTimeout(emitReady, 150);
    } else if (!timerShim || typeof timerShim.nativeRAF !== 'function') {
      emitReady();
    }
  }

  function pauseGame() {
    if (currentWrapper) {
      if (currentWrapper.game && typeof currentWrapper.game.pause === 'function') {
        try {
          currentWrapper.game.pause();
        } catch (_err) {}
      }
      if (typeof currentWrapper.pauseTimer === 'function') {
        try {
          currentWrapper.pauseTimer();
        } catch (_err) {}
      }
    }
    if (timerShim) {
      timerShim.pause();
    }
  }

  function resumeGame() {
    if (timerShim) {
      timerShim.resume();
    }
    if (currentWrapper) {
      if (currentWrapper.game && typeof currentWrapper.game.resume === 'function') {
        try {
          currentWrapper.game.resume();
        } catch (_err) {}
      }
      if (typeof currentWrapper.resumeTimer === 'function') {
        try {
          currentWrapper.resumeTimer();
        } catch (_err) {}
      }
    }
  }

  function restartGame() {
    if (!currentWrapper) return;
    if (timerShim && timerShim.isPaused()) {
      timerShim.resume();
    }
    // Always reset synchronously (even if a game-over/win overlay is open) so no stale
    // overlay lingers behind a 300ms fade timer. Session state stays intact (no resetSession).
    currentWrapper.destroy();
    currentWrapper.init();
    if (pendingAsyncReady) {
      currentWrapper.markAsyncReady();
    }
    var emitReady = function () {
      window.dispatchEvent(new Event('resize'));
      postToNative({
        type: 'ready',
        gameKey: currentGameKey,
        preferredOrientation: currentPreferredOrientation,
      });
    };
    if (timerShim && typeof timerShim.nativeRAF === 'function') {
      timerShim.nativeRAF(emitReady);
    } else {
      emitReady();
    }
  }

  function markAsyncReady() {
    pendingAsyncReady = true;
    document.documentElement.dataset.asyncReady = 'true';
    if (currentWrapper && typeof currentWrapper.markAsyncReady === 'function') {
      currentWrapper.markAsyncReady();
    }
  }

  function receive(raw) {
    var msg = raw;
    if (typeof raw === 'string') {
      try {
        msg = JSON.parse(raw);
      } catch (_err) {
        return;
      }
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'launch':
        pendingAsyncReady = false;
        delete document.documentElement.dataset.asyncReady;
        launchGame(msg.gameKey, msg.config);
        break;
      case 'pause':
        pauseGame();
        break;
      case 'resume':
        resumeGame();
        break;
      case 'restart':
        restartGame();
        break;
      case 'markAsyncReady':
        markAsyncReady();
        break;
      default:
        break;
    }
  }

  // Delegated tactile haptic feedback for game interactions
  if (rootEl) {
    rootEl.addEventListener(
      'pointerdown',
      function (event) {
        var target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (
          target.closest(
            '.game-start-btn, .pizzatron-start-btn, .knife-start-btn, .overlay-btn, .game-ready-btn',
          )
        ) {
          postToNative({ type: 'haptic', style: 'medium' });
          return;
        }
        if (
          target.closest(
            '.memory-card, .chef-pad, .pancake-pan, .garden-hole, .pizzatron-tray-basket, .cake-field',
          )
        ) {
          postToNative({ type: 'haptic', style: 'light' });
        }
      },
      { passive: true },
    );
  }

  window.__COOKBOOK_HOST__ = { receive: receive };

  function handleMessageEvent(event) {
    if (event && event.data !== undefined) {
      receive(event.data);
    }
  }
  window.addEventListener('message', handleMessageEvent);
  document.addEventListener('message', handleMessageEvent);

  if (Array.isArray(window.__COOKBOOK_PENDING_MSGS__)) {
    var pending = window.__COOKBOOK_PENDING_MSGS__.splice(0);
    for (var i = 0; i < pending.length; i++) {
      receive(pending[i]);
    }
  }

  if (
    window.__COOKBOOK_INITIAL_GAME__ &&
    typeof window.__COOKBOOK_INITIAL_GAME__.gameKey === 'string'
  ) {
    launchGame(
      window.__COOKBOOK_INITIAL_GAME__.gameKey,
      window.__COOKBOOK_INITIAL_GAME__.config,
    );
  }

  postToNative({ type: 'host-booted', launchedGameKey: currentGameKey });
})();
`;

  const hostStyles = `
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: var(--surface-0, #faf6ec);
  color: var(--ink, #1f1d18);
  font-family: var(--font-ui-he, system-ui, -apple-system, sans-serif);
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  overscroll-behavior: none;
}

#cookbook-game-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px 12px 12px;
  box-sizing: border-box;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

#cookbook-game-root .game-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  justify-content: center;
  isolation: isolate;
}

#cookbook-game-root .game-wrapper .game-header {
  flex: 0 0 auto;
  padding-top: 4px;
  margin-bottom: 4px;
}

#cookbook-game-root .game-wrapper .game-content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

#cookbook-game-root .knife-game,
#cookbook-game-root .cake-game {
  height: calc(100vh - 76px);
  min-height: 360px;
}

#cookbook-game-root .memory-game-board {
  width: 100%;
  max-width: 360px;
}

#cookbook-game-root .memory-card {
  min-height: 70px;
}

#cookbook-game-root .memory-card-front,
#cookbook-game-root .memory-card-back {
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
}

/* Native expo-screen-orientation owns screen rotation inside the mobile host */
rotate-prompt {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

@media (max-height: 500px) {
  #cookbook-game-root {
    padding: 4px 10px 6px;
  }

  #cookbook-game-root .game-wrapper {
    gap: 4px;
  }

  #cookbook-game-root .game-wrapper .game-header {
    padding-top: 2px;
    margin-bottom: 0;
  }

  #cookbook-game-root .timer {
    font-size: 0.95rem;
    padding: 2px 10px;
  }

  #cookbook-game-root .knife-game,
  #cookbook-game-root .cake-game {
    height: calc(100vh - 54px);
    min-height: 0;
  }
}
`;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>פינת המשחקים</title>
  <style id="cookbook-tokens">${escapeForHtmlStyle(tokensCss)}</style>
  <style id="cookbook-host-styles">${escapeForHtmlStyle(hostStyles)}</style>
</head>
<body>
  <div id="cookbook-game-root"></div>
  <script id="cookbook-bootstrap">${escapeForHtmlScript(bootstrapScript)}</script>
  <script id="cookbook-games-bundle">${escapeForHtmlScript(gamesBundleJs)}</script>
  <script id="cookbook-bridge">${escapeForHtmlScript(bridgeScript)}</script>
</body>
</html>`;
}

async function main() {
  const tokensCss = fs.readFileSync(TOKENS_CSS_PATH, 'utf8');
  const assetRegistry = buildAssetRegistry();
  const gamesBundleJs = await bundleGamesEngine(assetRegistry);
  const html = buildHtmlDocument(tokensCss, assetRegistry, gamesBundleJs);

  const generatedTs = `/* eslint-disable */
// AUTO-GENERATED BY scripts/bundle-mobile-games.mjs — DO NOT EDIT MANUALLY.
// Run \`node scripts/bundle-mobile-games.mjs\` to regenerate.

export const BUNDLED_GAMES_ASSET_COUNT: number = ${assetRegistry.count};

export const BUNDLED_GAMES_KEYS = [
  'memory',
  'burger',
  'pizza',
  'knife',
  'chef-says',
  'pancake',
  'garden',
  'cake',
] as const;

export const BUNDLED_GAMES_HTML: string = ${JSON.stringify(html)};
`;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, generatedTs, 'utf8');

  const kb = (Buffer.byteLength(generatedTs, 'utf8') / 1024).toFixed(1);
  console.log(
    `[bundle-mobile-games] Generated ${path.relative(ROOT_DIR, OUT_FILE)} (${assetRegistry.count} inlined assets, ${kb} KB)`,
  );
}

main().catch((err) => {
  console.error('[bundle-mobile-games] Failed:', err);
  process.exit(1);
});
