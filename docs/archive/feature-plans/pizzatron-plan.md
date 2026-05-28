# Pizzatron — Design & Build Plan

Tracking issue: [#266](https://github.com/roiguri/cookbook/issues/266)
Umbrella: [#263](https://github.com/roiguri/cookbook/issues/263)

A Club-Penguin-Pizzatron-style conveyor builder mini-game. Empty pizzas ride a conveyor; the player drags toppings from a tray onto each pizza to match the order; pizzas ship when they reach the box at the end of the belt.

---

## 1. Game model (v1)

Conforms to the existing mini-game pattern (`burger_stacker`, `memory_game`):

- Complete **N orders** (target: 10) as fast as possible.
- **One wrong pizza** ends the run (`onGameOver`).
- Completion fires `onComplete`; the wrapper shows the time as the score.
- Timer is the only HUD element shared with the wrapper.

A future v2 may extend the wrapper with a score + 3-strikes endless mode, but that's deliberately out of scope for v1 to avoid touching shared infra before all three new games are in flight.

---

## 2. Locked decisions

| #   | Decision                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Game model: complete-N-orders, fastest wins, single-mistake game-over                                                                                                                                     |
| 2   | Input: drag-and-drop using Pointer Events (not native HTML5 DnD; not Touch Events)                                                                                                                        |
| 3   | Belt direction: left → right                                                                                                                                                                              |
| 4   | Topping placement: **automatic — sunflower spiral**, with 0–30° random rotation jitter per topping                                                                                                        |
| 5   | Zero toppings on box arrival = strike (treated as wrong)                                                                                                                                                  |
| 6   | Audio: silent in v1                                                                                                                                                                                       |
| 7   | Assets: AI-generated PNGs from day one (~13 sprites — see §10)                                                                                                                                            |
| 8   | Order display: **per-pizza label above each pizza** (alternative considered: top ticket showing next-to-ship; rejected because it ambiguates which pizza the order is for once the belt has 2+ in flight) |

---

## 3. Screen layout

Vertical bands; works in mobile portrait and desktop landscape with no reflow:

```
┌──────────────────────────────────────────────┐
│ ⏱ 00:00                          3 / 10       │  HUD (timer from wrapper + orders remaining)
├──────────────────────────────────────────────┤
│                                              │
│              🟥×3 🍄×2 🫒×1                  │  order label (per pizza, scrolls with it)
│   🔥  ⚪[🟥🟥] ⚪[🟥🍄]            ⚪    📦  │  belt: pulley · pizzas · pulley + box
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                              │
├──────────────────────────────────────────────┤
│        🟥    🍄    🫒    🌶️    🥓    🌿      │  topping tray (drag source)
└──────────────────────────────────────────────┘
```

- **HUD row** — timer (from `GameWrapper`) + orders-remaining counter (`3 / 10`)
- **Belt zone** — ~50% of game height, contains pulleys, belt body, in-flight pizzas with their order labels, optional kitchen-end graphic on the left, pizza box on the right
- **Tray** — bottom strip with one icon per topping type; press-to-grab source for drag

---

## 4. State model

```js
this.state = {
  belt: [
    // { id, x, requiredToppings, currentToppings: {tomato: 1}, labelEl, pizzaEl }
  ],
  ordersCompleted: 0,
  ordersToWin: 10,
  spawnCounter: 0, // drives difficulty curve
  isRunning: true,
};
```

Invariants:

- Each pizza on the belt carries **its own** order, captured at spawn time. There is no global "current order."
- Toppings are stored as **count maps** (`{tomato: 3, mushroom: 2}`), not arrays — enables strict equality validation.
- `belt` is the source of truth for rendering. The frame loop iterates this array and writes `transform: translateX(...)` to each pizza element.

---

## 5. Frame loop

Two cooperating loops, mirroring `burger_stacker`:

```js
// Main loop — rAF
loop() {
  if (!this.isRunning) return;
  this.advanceBelt();
  this.checkBoxArrival();
  this.gameLoopId = requestAnimationFrame(loop);
}

// Spawner — setInterval
spawner() {
  if (!this.isRunning) return;
  this.spawnPizza();
}
```

`advanceBelt`:

```js
advanceBelt() {
  this.beltOffset = (this.beltOffset + this.beltSpeed) % BELT_TILE_W;
  this.beltEl.style.backgroundPositionX = `${this.beltOffset}px`;

  this.state.belt.forEach(p => {
    p.x += this.beltSpeed;
    p.pizzaEl.style.transform = `translateX(${p.x}px)`;
    p.labelEl.style.transform = `translateX(${p.x}px)`; // label rides with pizza
  });
}
```

**Speed sync rule:** belt background scroll speed === pizza translation speed. Same `beltSpeed` constant for both. If they desync, pizzas look like they're skating on ice.

---

## 6. Drag-and-drop input

Use **Pointer Events** (`pointerdown` / `pointermove` / `pointerup`), not Touch Events. Pointer Events unify mouse and touch with one code path and support `setPointerCapture` for clean drag tracking.

### Tray topping → pointerdown

- Capture the pointer to the tray icon.
- Spawn a "ghost" div that follows the pointer (positioned with `translate`).
- Record `draggedToppingType`.

### pointermove

- Update ghost `translate` to match pointer x/y.

### pointerup

- Hit-test: iterate `state.belt`, find any pizza whose `getBoundingClientRect()` contains the pointer.
- If hit → call `addTopping(pizza, draggedToppingType)`.
- If miss → fade out the ghost.
- Always: release pointer, remove ghost.

### CSS guard

```css
.topping-tray {
  touch-action: none;
}
.belt-zone {
  touch-action: none;
}
```

Prevents the browser from scrolling / pinch-zooming while the player drags.

### Drop point doesn't matter

Per decision #4, the player just needs to drop on _any_ part of the pizza. The actual visual position is assigned by the sunflower algorithm (§7).

---

## 7. Topping placement — sunflower spiral

When a topping is added to a pizza, it goes to position `currentToppingCount + 1` on a golden-angle spiral:

```js
const GOLDEN_ANGLE = 137.5 * Math.PI / 180;

placeNthTopping(n, pizzaRadius) {
  const angle = n * GOLDEN_ANGLE;
  const r = Math.sqrt(n) * SPIRAL_SCALE;        // grows outward
  const clamped = Math.min(r, pizzaRadius - TOPPING_RADIUS);
  return {
    x: Math.cos(angle) * clamped,
    y: Math.sin(angle) * clamped,
    rotation: Math.random() * 30,                // visual variety
  };
}
```

Why:

- **No overlap, ever** — golden angle is mathematically optimal for packing.
- **Scales** with any count, 2 through 12+.
- **Deterministic** — the Nth topping always lands in the same spot, so the player can predict and plan.
- **Looks organic** — what sunflowers actually do, hence the name.

`SPIRAL_SCALE` is a tuning constant (~10–14 for a 80px-radius pizza). The clamp prevents the outermost topping from spilling off the edge.

---

## 8. Order generation & difficulty curve

```js
const POOL = ['tomato', 'mushroom', 'olive', 'pepper', 'sausage', 'basil'];

generateOrder(difficulty) {
  const numTypes = Math.min(2 + Math.floor(difficulty / 3), POOL.length); // 2..6
  const types = shuffle(POOL).slice(0, numTypes);
  const order = {};
  types.forEach(t => { order[t] = 1 + Math.floor(Math.random() * 3); });
  return order;
}
```

`difficulty` = `state.spawnCounter`. Three knobs scale with it:

| Knob                           | Order 1 | Order 5 | Order 10 |
| ------------------------------ | ------- | ------- | -------- |
| Belt speed (px/frame)          | 0.5     | 0.9     | 1.4      |
| Spawn rate (ms between pizzas) | 5000    | 3500    | 2000     |
| Order size (max topping types) | 2       | 3–4     | 4–5      |

Initial numbers are estimates — final tuning is vibes-driven after a playtest pass. Belt width is ~600px on desktop / ~320px on mobile; at order 10 a pizza spends ~5s on the belt — tight but possible for a 5-topping order with practice.

---

## 9. Validation

When a pizza reaches the box at the right edge:

```js
isCorrect(current, required) {
  const keys = new Set([...Object.keys(current), ...Object.keys(required)]);
  for (const k of keys) {
    if ((current[k] || 0) !== (required[k] || 0)) return false;
  }
  return true;
}
```

Strict equality. Extra = wrong, missing = wrong, exact match = correct. Zero toppings = wrong (treated as "missing everything"; satisfies decision #5).

On correct → `ordersCompleted++`; if `=== ordersToWin` → `onComplete()`.
On wrong → `onGameOver(reason)` with a Hebrew message identifying the failure (e.g. `"חסרים מרכיבים בפיצה!"`).

---

## 10. Assets

Following `burger_stacker`'s convention: flat PNGs in `src/lib/games/assets/`, both `_full` and `_small` variants kept (small is used in-game).

### Full asset list

| Asset                     | Filename                   | Approx size | Notes                                                                 |
| ------------------------- | -------------------------- | ----------- | --------------------------------------------------------------------- |
| Pizza base (empty)        | `pizza_base_small.png`     | 160×160     | Top-down circle, sauce + thin cheese, no toppings — **anchor sprite** |
| Topping: tomato           | `pizza_tomato_small.png`   | 40×40       | Top-down slice, red                                                   |
| Topping: mushroom         | `pizza_mushroom_small.png` | 40×40       | Top-down slice, cream / brown                                         |
| Topping: olive            | `pizza_olive_small.png`    | 40×40       | Top-down ring, black                                                  |
| Topping: pepper           | `pizza_pepper_small.png`   | 40×40       | Top-down ring, green                                                  |
| Topping: sausage          | `pizza_sausage_small.png`  | 40×40       | Top-down slice, brown / pink                                          |
| Topping: basil            | `pizza_basil_small.png`    | 40×40       | Single green leaf                                                     |
| Pizza box                 | `pizza_box_small.png`      | 140×140     | Open from above, brown cardboard                                      |
| Belt slat tile            | `pizza_belt_small.png`     | 128×80      | **Seamless** horizontal tile, dark metal with chevrons pointing →     |
| Pulley                    | `pizza_pulley_small.png`   | 80×80       | Round wheel; same sprite used at both ends (flip via CSS)             |
| Optional: kitchen end     | `pizza_kitchen_small.png`  | 120×120     | Oven hatch / pass-through at left end (polish, not required)          |
| Optional: order ticket bg | `pizza_ticket_small.png`   | n/a         | Can stay as CSS — pure design tokens                                  |

**Essential: 10 sprites.** Optional: +2.

### Style anchor prompt

Generate the pizza base first as the style anchor. Then for each topping, attach the base as a reference and prompt with "match this style."

```
Flat illustration, top-down view, transparent background,
soft drop shadow, warm cartoon style, single subject centered,
square aspect ratio.
Subject: [...]
```

### Color guidance

Stay within the project's warm palette:

- Reds / oranges around `--secondary` (#bc4749) for tomato / sausage
- Greens around `--primary` (#6a994e) for basil / pepper
- Moderate saturation — match the existing `burger_stacker` sprites, not neon

### Tooling

GPT-4o (ChatGPT) or Imagen 3 (Gemini) — both support transparent backgrounds directly. Generate at 512px+ and downsample to the table sizes for crisper edges. Budget ~45 min for generation, ~15 min for cleanup (remove.bg if any backgrounds aren't clean).

### Belt-specific notes

- **Chevrons must point in the belt direction** (→ for L→R) — primary visual cue for motion.
- **Dark belt, light pizza base** — strong contrast so pizzas pop. Belt = dark gray / charcoal, pizza base = warm cream / golden.
- **Drop shadow under pizzas onto the belt** via `filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3))` in CSS, not baked into the sprite.

### Preload

Add a small preload helper in `start()`:

```js
async preloadAssets() {
  const urls = [/* all _small.png imports */];
  await Promise.all(urls.map(url => new Promise(res => {
    const img = new Image();
    img.onload = res;
    img.onerror = res;
    img.src = url;
  })));
}
```

Optionally hold the wrapper's loading state until preload resolves to avoid pop-in on first frame.

---

## 11. Conveyor belt anatomy

Three visual sub-components:

1. **Belt body** — repeating slat tile, takes the middle ~80% of belt width
2. **Pulleys** — two rotating wheels at each end, same sprite mirrored
3. **Delivery target** — open pizza box at the right end

Optional **kitchen pass-through** at the left end (oven mouth / hatch) for polish.

### Belt motion + pizzas in sync

```js
// each frame, same beltSpeed for both layers
this.beltOffset = (this.beltOffset + beltSpeed) % BELT_TILE_W;
beltEl.style.backgroundPositionX = `${this.beltOffset}px`;
pizzas.forEach((p) => {
  p.x += beltSpeed;
  p.element.style.transform = `translateX(${p.x}px)`;
});
```

Pulleys spin via CSS `@keyframes rotation` — looped infinitely with a duration approximately matched to belt speed at base difficulty. Slight desync at high difficulty is acceptable; players don't notice.

---

## 12. Lifecycle integration

Maps cleanly onto the `GameWrapper` contract (`start` / `destroy` + `onInteraction` / `onComplete` / `onGameOver`):

```js
class PizzatronGame {
  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign({ ordersToWin: 10 }, config);
    // state init...
  }

  async start() {
    await this.preloadAssets();
    this.render();
    this.setupPointerInput();
    this.startGameLoop();
    this.startSpawner();
    this.spawnPizza(); // first pizza
    // onInteraction fires on first successful topping drag, not here —
    // gives the player a beat to read the first order
  }

  destroy() {
    this.isRunning = false;
    cancelAnimationFrame(this.gameLoopId);
    clearInterval(this.spawnerId);
    // remove pointer listeners on container
    this.container.innerHTML = '';
  }
}
```

Register in `GameWrapper`'s `REGISTRY`:

```js
{
  key: 'pizza',
  name: 'הפיצריה',                   // working title — TBD
  icon: '🍕',
  description: 'הרכיבו פיצות לפי ההזמנה',
  GameClass: PizzatronGame,
  defaultConfig: { ordersToWin: 10 },
  successMessage: 'כל הכבוד! משלוחים הושלמו',
  loadingText: 'מחממים את התנור... תפסו הזמנות בינתיים!',
}
```

Hebrew strings used in-game (matching `burger_stacker` style):

- Game over: `"בוצעה הזמנה שגויה!"` / `"חסרים מרכיבים בפיצה!"`
- Per-pizza order label: counts only (`"🟥×3 🍄×2"`), no Hebrew text needed
- Tray icons: no labels (icon-only)

---

## 13. File layout

```
src/lib/games/
  pizzatron.js               # game class
  pizzatron.css              # styles (imported as ?inline by game_wrapper.js)
  game_wrapper.js            # +import + REGISTRY entry
  assets/
    pizza_base_small.png
    pizza_base_full.png
    pizza_tomato_small.png
    pizza_tomato_full.png
    ... (etc per asset table)
    pizza_belt_small.png
    pizza_pulley_small.png
    pizza_box_small.png
```

`game_wrapper.js` change:

```js
import { PizzatronGame } from './pizzatron.js';
import pizzaCss from './pizzatron.css?inline';

export const GAME_STYLES = `${wrapperCss}\n${memoryCss}\n${burgerCss}\n${pizzaCss}`;

// + REGISTRY entry
```

(After #259 lands — `GameWrapper.random()` registry refactor — the registration may move; revisit then.)

---

## 14. Build phases

Each phase is reviewable independently. Don't start phase N+1 before phase N is approved.

### Phase 0 — art

- Generate the 10 essential sprites per §10
- Anchor on `pizza_base`, then variants
- Cleanup: transparent backgrounds, consistent sizes
- Drop into `src/lib/games/assets/`

**Done when:** all 10 sprites in repo, visually consistent, mobile-resolution.

### Phase 1 — skeleton + belt + spawn

- `pizzatron.js` + `pizzatron.css` scaffolded
- Wrapper registry updated
- Belt zone rendered: pulleys, belt body, box, optional kitchen end
- Belt + pizza speed sync working
- Empty pizzas spawn at left edge, ride belt L→R, reach box at right edge
- No interaction yet — just visual motion
- Each pizza carries its order label above it

**Done when:** game runs, pizzas visibly move on belt, labels follow.

### Phase 2 — drag-and-drop + validation

- Topping tray rendered
- Pointer Events: drag from tray → drop on pizza → topping appears via sunflower spiral
- Per-pizza order label updates as toppings added (e.g. struck-through when fulfilled)
- Validation on box arrival: correct → counter increments, wrong → `onGameOver`
- N = `ordersToWin` correct → `onComplete`

**Done when:** can play one full game start to win/lose state.

### Phase 3 — difficulty + polish

- Difficulty curve wired (belt speed, spawn rate, order size all scale with `spawnCounter`)
- Drop shadow under pizzas
- Visual feedback on correct ship (sparkle, brief flash)
- Visual feedback on wrong ship (red flash before game-over modal)
- Tray topping "active" state during drag
- Disable `touch-action` on belt + tray
- Hebrew strings finalized (with native speaker review if possible)
- Cross-browser test: Chrome, Safari (mobile + desktop), Firefox

**Done when:** the game feels good for ~5 minutes of solo play.

---

## 15. Out of scope for v1

- Audio (decision #6)
- Score + 3-strikes endless mode (decision #1; future v2)
- Sweet mode (candy toppings) — easy follow-up, just new sprites + a new pool
- Lenient validation ("extras ok") — future toggle
- Power-ups (slow belt, auto-cheese, skip order)
- Leaderboard / persistence
- Accessibility for screen readers (the game is fundamentally visual; consider a separate accessibility pass if mini-games become a core feature)

---

## 16. Open / deferred decisions

- **Game name** — placeholder is `"הפיצריה"`. Could be more playful. Park for now.
- **Tray topping count visibility during drag** — should the tray show how many of that topping are in the next order? Helps planning. Cuts down on guessing. **Recommended: yes, but as a v1.5 polish, not v1.**
- **Per-pizza label format** — counts-only vs. icon-only vs. both. Currently planned as both (`🟥×3`). Verify legibility at mobile sizes during phase 2.
