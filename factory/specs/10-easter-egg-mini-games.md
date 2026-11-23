# NLSpec 10 — 8 Easter-Egg Mini-Games Host & Native Orientation/Haptics Bridge

- **Wave:** 3 (Parallel Advanced)
- **Depends On:** Slice `00`
- **Web Semport Oracles:** `src/app/pages/games-page.js`, `src/lib/easter-egg/games-unlock.js`, `src/lib/games/{game_wrapper,memory_game,burger_stacker,pizzatron,knife_skills,chef_says,pancake_flip,garden_harvest,layer_cake}.js`, `src/lib/games/assets/*`

## 1. User Intent

Curious family members who tap the header brand logo 7 times rapidly within 2 seconds unlock a sparkling secret arcade (`/games`) featuring all 8 kitchen mini-games (and the same host powers the 2 random filler games during AI recipe extraction waits), running 100% offline with crisp native orientation locking and haptic feedback.

## 2. Behavioral Contract

1. **7-Tap Easter-Egg Unlock (`BrandLogoUnlock`):**
   - Mirrors `src/lib/easter-egg/games-unlock.js` exact constants:
     - `TAP_TARGET = 7`
     - `TAP_WINDOW_MS = 2000` (if gap since previous tap > 2000 ms, reset count to 0)
     - `UNLOCK_COOLDOWN_MS = 1500`
   - Escalating visual glow/pulse feedback on taps 3–4 (level 1), 5 (level 2), 6 (level 3) + light haptic tick per tap.
   - **6 taps does NOT unlock.** On the 7th tap within 2 s, plays sparkle burst + success haptic and navigates to `/games`.
   - `/games` is also reachable directly via URL scheme / deep link (`cookbook-e2e://games`).
2. **Games Chooser (`app/games.tsx`):**
   - Lists all 8 games matching `GameWrapper.list()` exact Hebrew names, icons, and descriptions:
     1. `memory` — `משחק זיכרון` (`🧠`)
     2. `burger` — `מגדל ההמבורגר` (`🍔`, preferred: `portrait`)
     3. `pizza` — `הפיצריה` (`🍕`, preferred: `landscape`)
     4. `knife` — `אמנות הסכין` (`🔪`, preferred: `portrait`)
     5. `chef-says` — `השף אומר` (`👨‍🍳`, any orientation)
     6. `pancake` — `מחבת הפנקייקים` (`🥞`, preferred: `portrait`)
     7. `garden` — `קציר בגינה` (`🥕`, preferred: `portrait`)
     8. `cake` — `עוגת שכבות` (`🎂`, preferred: `portrait`)
3. **Bundled Offline WebView Host (`src/games-host/` + `scripts/bundle-mobile-games.mjs`):**
   - Build-time bundler (`scripts/bundle-mobile-games.mjs`) bundles the real `src/lib/games/*.js`, CSS, and base64-inlined PNG sprite assets (`src/lib/games/assets/*.png`) into a single self-contained offline HTML/JS bundle loaded by `react-native-webview` (zero network dependency — works in airplane mode!).
   - Typed JSON `postMessage` RN↔WebView bridge:
     - `WebView -> RN`: `{ type: 'ready', gameKey, preferredOrientation }`, `{ type: 'haptic', style: 'light'|'medium'|'success'|'error' }`, `{ type: 'complete', elapsedMs }`, `{ type: 'gameover', reason }`, `{ type: 'close' }`.
     - `RN -> WebView`: `{ type: 'launch', gameKey, config }`, `{ type: 'pause' }`, `{ type: 'resume' }`, `{ type: 'restart' }`, `{ type: 'markAsyncReady' }`.
   - **Native Orientation Management (`expo-screen-orientation`):**
     - Launching `pizza` locks to `LANDSCAPE` (`OrientationLock.LANDSCAPE`) and exposes an observable `game-orientation-badge` (`landscape`) + restores `DEFAULT` on exit/unmount.
     - Launching portrait-preferred games locks to `PORTRAIT_UP` and restores `DEFAULT` on exit/unmount.
   - **App Lifecycle Pause/Resume:** Backgrounding the app (`AppState` change) sends `{ type: 'pause' }` to the active game so timers/falling objects freeze; foregrounding sends `{ type: 'resume' }`.
   - **Filler Mode (`GameHostModal`):** Used by Slice `06` AI import waits; picks randomly strictly from `{ memory, burger }` (never `excludeFromRandom` games).

## 3. Required `testID` Contracts

- `games-screen`, `games-grid`, `game-tile-<key>` (for all 8 keys: `memory`, `burger`, `pizza`, `knife`, `chef-says`, `pancake`, `garden`, `cake`)
- `game-host-modal`, `game-webview`, `game-close-btn`, `game-restart-btn`, `game-orientation-badge`, `game-status-indicator`

## 4. Acceptance & Edge Cases

- **P0:** 6 taps on `brand-logo` stays on current screen; 7 taps within 2 s unlocks `/games`.
- All 8 games load completely offline inside `game-webview` with zero console/WebView errors, respond to touch input, support restart, and cleanly release orientation lock on close.
- `pizza` activates landscape orientation lock cleanly and restores default orientation when dismissed.
