# NLSpec 10 — 8 Easter-Egg Mini-Games Host & Native Orientation/Haptics Bridge

- **Wave:** 2 (Parallel Core — consumed by Wave 3B Slices `06` and `09`)
- **Depends On:** Slice `00`
- **Web Semport Oracles:** `src/app/pages/games-page.js`, `src/app/pages/games-page.html`, `src/lib/easter-egg/games-unlock.js`, `src/lib/easter-egg/games-unlock.css`, `src/lib/games/game_wrapper.js`, `src/lib/games/game_start_overlay.js`, `src/lib/games/game_start_overlay.css`, `src/lib/utilities/rotate-prompt/rotate-prompt.js`, `src/lib/games/memory_game.js`, `src/lib/games/burger_stacker.js`, `src/lib/games/pizzatron.js`, `src/lib/games/knife_skills.js`, `src/lib/games/chef_says.js`, `src/lib/games/pancake_flip.js`, `src/lib/games/garden_harvest.js`, `src/lib/games/layer_cake.js`, `src/lib/games/assets`

## 1. User Intent

Curious family members who tap the header brand logo 7 times rapidly within 2 seconds unlock a sparkling secret arcade (`/games`, **`פינת המשחקים`** — `מצאת את האיסטר אג. הנה הפסקה קטנה.`) featuring all 8 kitchen mini-games, while the exact same offline host powers the 2 random filler games during AI Recipe Import (Slice `06`) and AI Food Image Enhancement (Slice `09`) waits, running 100% offline with crisp native orientation locking and haptic feedback.

## 2. Behavioral Contract

1. **7-Tap Easter-Egg Unlock (`BrandLogoUnlock`):**
   - Mirrors `src/lib/easter-egg/games-unlock.js` exact constants:
     - `TAP_TARGET = 7`
     - `TAP_WINDOW_MS = 2000` (if gap since previous tap > 2000 ms, reset count to 0)
     - `UNLOCK_COOLDOWN_MS = 1500`
   - Escalating visual glow/pulse feedback on taps 3–4 (level 1), 5 (level 2), 6 (level 3) + light haptic tick per tap.
   - **6 taps does NOT unlock.** On the 7th tap within 2 s, plays sparkle burst + success haptic, suppresses stray extra taps during cooldown, and navigates to `/games` after ~250ms.
   - `/games` is also reachable directly via URL scheme / deep link (`cookbook-e2e://games`).
2. **Games Chooser (`app/games.tsx`):**
   - Header displays **`פינת המשחקים`**, subtitle **`מצאת את האיסטר אג. הנה הפסקה קטנה.`**, and in-game back button **`חזרה למשחקים`**.
   - Lists all 8 games matching `GameWrapper.list()` exact Hebrew names, icons, descriptions, and `preferredOrientation`:
     1. `memory` — `משחק זיכרון` (`🧠`)
     2. `burger` — `מגדל ההמבורגר` (`🍔`, preferred: `portrait`)
     3. `pizza` — `הפיצריה` (`🍕`, preferred: `landscape`)
     4. `knife` — `אמנות הסכין` (`🔪`, preferred: `portrait`)
     5. `chef-says` — `השף אומר` (`👨‍🍳`, any orientation)
     6. `pancake` — `מחבת הפנקייקים` (`🥞`, preferred: `portrait`)
     7. `garden` — `קציר בגינה` (`🥕`, preferred: `portrait`)
     8. `cake` — `עוגת שכבות` (`🎂`, preferred: `portrait`)
   - Invokes each game's static `resetSession()` hook on fresh tile launch (preserving one-time tutorial intro overlay behavior from `game_start_overlay.js`, NOT re-shown on restart).
3. **Bundled Offline WebView Host (`src/games-host/` + `scripts/bundle-mobile-games.mjs`):**
   - **Recursive Offline Asset Bundling (CRITICAL):** `scripts/bundle-mobile-games.mjs` recursively bundles ALL game JS modules, ALL 8 game CSS files + `game_wrapper.css` + `game_start_overlay.css`, AND **recursively inlines ALL sprite/artwork assets under `src/lib/games/assets/**`**:
     - Root burger sprites (`src/lib/games/assets/*.png`)
     - Nested Pizzatron sprites (`src/lib/games/assets/pizzatron/*.png`)
     - Nested Knife Skills SVGs (`src/lib/games/assets/knife/*.svg`) — providing an inlined asset URL map so `knife_skills.js`'s dynamic `new URL('./assets/knife/...svg', import.meta.url)` resolves 100% offline!
   - **Suppress Web `<rotate-prompt>` Inside Native Host:** Native `expo-screen-orientation` owns screen rotation, so the WebView host suppresses/disables `<rotate-prompt>` overlays to avoid flashing during orientation locks.
   - Typed JSON `postMessage` RN↔WebView bridge:
     - `WebView -> RN`: `{ type: 'ready', gameKey, preferredOrientation }`, `{ type: 'haptic', style: 'light'|'medium'|'success'|'error' }`, `{ type: 'complete', elapsedMs }`, `{ type: 'gameover', reason }`, `{ type: 'close' }`.
     - `RN -> WebView`: `{ type: 'launch', gameKey, config }`, `{ type: 'pause' }`, `{ type: 'resume' }`, `{ type: 'restart' }`, `{ type: 'markAsyncReady' }`.
   - **Native Orientation Management (`expo-screen-orientation`):**
     - Launching `pizza` locks to `LANDSCAPE` (`OrientationLock.LANDSCAPE`), exposes observable `game-orientation-badge` (`landscape`), and restores `DEFAULT` on exit/unmount.
     - Launching portrait-preferred games locks to `PORTRAIT_UP` and restores `DEFAULT` on exit/unmount.
   - **App Lifecycle Pause/Resume:** Backgrounding (`AppState`) sends `{ type: 'pause' }`. Calls `game.pause()`/`resume()` for the 3 games that implement it (`pancake`, `garden`, `cake`) AND freezes `requestAnimationFrame` / host timer dispatch in the WebView host shim for the remaining 5 games (`memory`, `burger`, `pizza`, `knife`, `chef-says`) so nothing burns or falls while backgrounded.
   - **Filler Mode (`GameHostModal`):** Shared by Slice `06` (AI Recipe Import) and Slice `09` (AI Food Image Enhancer); picks randomly strictly from `{ memory, burger }` (never `excludeFromRandom` games) and displays `markAsyncReady` banner (`המתכון מוכן!` / `התמונה המשופרת מוכנה!`).

## 3. Required `testID` Contracts

- `games-screen`, `games-grid`, `game-tile-<key>` (`memory`, `burger`, `pizza`, `knife`, `chef-says`, `pancake`, `garden`, `cake`)
- `game-host-modal`, `game-webview`, `game-close-btn`, `game-restart-btn`, `game-orientation-badge`, `game-status-indicator`

## 4. Acceptance & Edge Cases

- **P0:** 6 taps on `brand-logo` stays on current screen; 7 taps within 2 s unlocks `/games`.
- All 8 games (including `pizza` nested PNGs and `knife` nested SVGs!) load completely offline inside `game-webview` with zero console/WebView errors, respond to touch input, support restart, and cleanly release orientation lock on close.
- `pizza` activates landscape orientation lock cleanly and restores default orientation when dismissed.
