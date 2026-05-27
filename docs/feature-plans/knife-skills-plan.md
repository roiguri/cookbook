# Knife Skills — Design & Build Plan

Tracking issue: [#266](https://github.com/roiguri/My-Cook-Book/issues/266)
Umbrella: [#263](https://github.com/roiguri/My-Cook-Book/issues/263)

A Fruit-Ninja-style slicing mini-game. Produce arcs up from the bottom of the play field; the player swipes a finger / mouse across them to slice them in half; hazards (chili, onion) end the run. The game tests pointer-path tracking, simple physics, and a clip-path trick that gives us two halves per ingredient from a single sprite.

---

## 1. Game model (v1)

Conforms to the existing mini-game pattern (`pizzatron`, `burger_stacker`, `memory_game`):

- **Slice N produce items** (target: 30) as fast as possible.
- **One hazard slice OR M missed items** ends the run (`onGameOver`). Hazards are an instant fail; missed items use a 3-strike counter to give the player some slack.
- Completion fires `onComplete`; the wrapper shows the time as the score.
- Combos (multiple items sliced in a single swipe) are pure feel — no scoring impact in v1. Wrapper currently scores by time only and we don't want to touch shared HUD infra mid-flight.
- Timer is the only HUD element shared with the wrapper. Strike counter (`x x x`) lives inside the game canvas.

A future v2 may extend the wrapper to surface combo bonuses or a high-score number; out of scope here.

---

## 2. Locked decisions

| #   | Decision                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Game model: slice 30 produce, fastest wins. Hazard touched = instant fail. 3 missed items = fail.                                                                                  |
| 2   | Input: Pointer Events (same as pizzatron — unifies mouse + touch, no Touch Events).                                                                                                |
| 3   | Field orientation: produce arcs up from bottom (gravity pulls back down). Fixed origin band along the bottom edge with random x.                                                   |
| 4   | Slice detection: pointer-path segment must intersect a fruit's bounding circle AND meet a minimum velocity threshold. No "tap to slice" — the swipe must travel through the fruit. |
| 5   | Halves: one sprite per fruit, split visually with `clip-path: inset(...)` along the cut line. Saves ~2/3 of art budget vs separate half sprites.                                   |
| 6   | Hazards: 2 types — chili 🌶️ and onion 🧅. Same physics as fruit. Sliced hazard = game over.                                                                                        |
| 7   | Audio: silent in v1 (matches pizzatron). Sound infra deferred to a shared pass later.                                                                                              |
| 8   | Assets: Twemoji set (CC-BY-4.0, SVG). ~8 fruits + 2 hazards. Side-on view, no AI-generation cost. Falls back to text emoji if SVG loading fails.                                   |
| 9   | Combo: a "combo" is N≥2 items sliced within a single pointerdown→pointerup session. Shown as floating text `קומבו! ×N`. No score impact in v1.                                     |
| 10  | Game start: same start overlay pattern as pizzatron — title, instructions, start button. Timer starts on press, not on first slice.                                                |

---

## 3. Screen layout

Vertical band layout, works mobile portrait and desktop landscape with no reflow:

```
┌──────────────────────────────────────────────┐
│ ⏱ 00:00                  ✗ ✗ ✗    5 / 30      │  HUD (timer from wrapper + strikes + sliced count)
├──────────────────────────────────────────────┤
│                                              │
│             🍎                               │
│                  /                            │  in-flight fruit (arcs)
│         🍋    ↗                              │
│   🥝                                          │
│                       ✂ ─ ─ ─ ─ ─ ─ ─ ─ ─    │  swipe trail (fades)
│                                              │
│                                              │
│            ↑     ↑     ↑     ↑                │
│            spawn band (bottom edge)           │
└──────────────────────────────────────────────┘
```

- **HUD row** — timer (from `GameWrapper`) + in-game strike pips + sliced/total counter
- **Play field** — ~85% of game height, full width. Pointer-event surface. Fruits and the slash trail render here.
- **No tray** — slicing replaces dragging; the entire field is the input surface.

---

## 4. State model

```js
this.state = {
  fruits: [
    // { id, x, y, vx, vy, angularVel, rotation, type, isHazard, sliced, sliceAngle, halves: [...] }
  ],
  combos: [], // floating combo text elements being animated out
  sliced: 0,
  toWin: 30,
  strikes: 0,
  maxStrikes: 3,
  spawnCounter: 0, // drives difficulty curve
  isRunning: false,
};
```

Each fruit object also carries DOM refs (`el`, `halfTopEl`, `halfBottomEl`) so the loop can update transforms directly. Halves are created lazily on slice — until then there's just `el`.

Invariants:

- `fruits` is the source of truth. Frame loop iterates it, writes `transform` to each element, removes anything past the bottom of the field.
- A `sliced` fruit transitions from "live" (single `el`, scored on slice) to "two halves" (two elements, both still under physics, ignored for hit-testing). Sliced fruits don't score again.
- `strikes` only increments for **unsliced** items that fall past the bottom. Sliced halves falling off-screen are just garbage-collected.

---

## 5. Frame loop

One rAF main loop + one `setTimeout`-driven spawner — mirrors pizzatron.

```js
loop() {
  if (!this.isRunning) return;
  this.advancePhysics();
  this.cullOffscreen();
  this.gameLoopId = requestAnimationFrame(loop);
}

spawnerTick() {
  if (!this.isRunning) return;
  this.spawnFruit();
  this.spawnerId = setTimeout(spawnerTick, this.currentSpawnInterval());
}
```

`advancePhysics`:

```js
advancePhysics() {
  const dt = 1; // single-frame unit; tune all constants in this unit
  for (const f of this.state.fruits) {
    f.vy += GRAVITY * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rotation += f.angularVel * dt;
    f.el.style.transform = `translate(${f.x}px, ${f.y}px) rotate(${f.rotation}deg)`;
    if (f.halves) this.advanceHalves(f);
  }
}
```

`advanceHalves` runs the same physics on each half element with the half's own `(vx, vy)` plus a small lateral push at slice time to make them diverge.

**Why not one rAF + an internal `setInterval` for spawns?** Same as pizzatron — `setTimeout` recursion lets us vary the spawn interval per tick as the difficulty ramps. `setInterval` locks the cadence.

---

## 6. Slice input — pointer path tracking

Use **Pointer Events** (`pointerdown` / `pointermove` / `pointerup`), consistent with pizzatron.

### pointerdown on play field

- Capture pointer on the field element.
- Start a new "stroke": `this.stroke = { points: [{x, y, t: now()}], slicedThisStroke: 0 }`.
- Show the slash trail.

### pointermove

- Append `{x, y, t}` to `stroke.points`.
- Compute the **segment** from the previous point to the current point.
- For each live (unsliced, non-half) fruit, run `segmentHitsCircle(segment, fruitBounds)`. If hit AND `segmentVelocity > MIN_SLICE_VELOCITY` → call `sliceFruit(fruit, segment)`.
- Update the slash trail to include the new point.
- Trim `stroke.points` to the last ~10 — anything older is invisible in the trail anyway and only bloats hit tests.

### pointerup / pointercancel

- If `stroke.slicedThisStroke ≥ 2`, fire a combo: `showCombo(stroke.slicedThisStroke)`.
- Clear the slash trail (fade it out).
- Release the pointer, drop the stroke.

### Slice math

```js
segmentHitsCircle(p1, p2, center, radius) {
  // distance from segment p1→p2 to point `center`
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return false;
  let t = ((center.x - p1.x) * dx + (center.y - p1.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = p1.x + t * dx;
  const closestY = p1.y + t * dy;
  const distSq = (center.x - closestX) ** 2 + (center.y - closestY) ** 2;
  return distSq <= radius * radius;
}
```

`MIN_SLICE_VELOCITY` ≈ 0.4 px/ms (tunable). Below that, the pointer is hovering or scrolling — not slicing. Mouse hover should never trigger a slice.

### CSS guard

```css
.knife-field {
  touch-action: none;
}
```

Same as pizzatron — prevents the browser from scrolling/pinch-zooming while the player swipes.

---

## 7. Clip-path half trick

On slice, replace the single fruit element with two half elements that share the same sprite but with complementary `clip-path` masks aligned to the slice angle.

```js
sliceFruit(fruit, segment) {
  const angle = Math.atan2(segment.p2.y - segment.p1.y, segment.p2.x - segment.p1.x);

  fruit.sliced = true;
  fruit.el.remove();

  const halfA = this.makeHalfElement(fruit.type, angle, 'top');
  const halfB = this.makeHalfElement(fruit.type, angle, 'bottom');

  // give the halves diverging lateral velocity perpendicular to the cut
  const perpX = -Math.sin(angle) * SLICE_KICK;
  const perpY =  Math.cos(angle) * SLICE_KICK;

  fruit.halves = [
    { el: halfA, x: fruit.x, y: fruit.y, vx: fruit.vx + perpX, vy: fruit.vy + perpY, rotation: fruit.rotation, angularVel: fruit.angularVel * 1.4 },
    { el: halfB, x: fruit.x, y: fruit.y, vx: fruit.vx - perpX, vy: fruit.vy - perpY, rotation: fruit.rotation, angularVel: fruit.angularVel * 1.4 },
  ];

  this.fieldEl.appendChild(halfA);
  this.fieldEl.appendChild(halfB);

  this.spawnJuiceParticles(fruit, angle);

  if (fruit.isHazard) this.handleHazardSlice(fruit);
  else this.handleProduceSlice();
}
```

`makeHalfElement`:

```js
makeHalfElement(type, angle, side) {
  const el = document.createElement('div');
  el.className = `knife-fruit-half knife-fruit-half--${type}`;
  // rotate the clip basis to the cut angle, then clip one half
  const deg = (angle * 180) / Math.PI;
  // clip-path: polygon defining a rectangle that covers exactly one side
  // of an infinite line through the center at `angle`.
  el.style.setProperty('--cut-angle', `${deg}deg`);
  el.classList.add(`knife-fruit-half--${side}`);
  return el;
}
```

The actual clipping uses a wrapper trick: an inner element rotates by `--cut-angle`, an outer element clips `inset(0 0 50% 0)` (top half) or `inset(50% 0 0 0)` (bottom half). The result is one half visible, aligned to the slice direction. Cleaner than computing dynamic polygon vertices and works on every modern browser.

### Juice particles

5–8 small absolute-positioned dots, each with a random outward velocity, fade out over ~300ms via CSS animation. Color matched per fruit (`--juice-color-apple`, etc.) defined alongside the sprite imports.

---

## 8. Spawn pattern & difficulty curve

Spawn band: bottom edge of field, with random x within the inner 80% of the width (10% margin per side so fruits don't graze the borders).

```js
spawnFruit() {
  const type = this.pickSpawnType();        // weighted: produce | hazard
  const fromLeft = 0.1 + Math.random() * 0.8;
  const x = fromLeft * this.fieldWidth - FRUIT_SIZE / 2;
  const y = this.fieldHeight + FRUIT_SIZE;  // just below field

  // velocity: enough upward push to clear ~70-90% of field height
  const vy = -(this.minUpwardVel() + Math.random() * 4);
  // lateral drift — arcs are more interesting when fruits don't go straight up
  const targetX = this.fieldWidth * (0.2 + Math.random() * 0.6);
  const flightFrames = this.estimateFlightFrames(vy);
  const vx = (targetX - x) / flightFrames;

  // rotation — slow tumble
  const angularVel = (Math.random() - 0.5) * 4;

  // ... push to state.fruits, append element ...
}

pickSpawnType() {
  const hazardOdds = this.currentHazardOdds();   // 0.05 → 0.20
  if (Math.random() < hazardOdds) return randomFrom(HAZARD_POOL);
  return randomFrom(PRODUCE_POOL);
}
```

Three knobs scale with `state.spawnCounter`:

| Knob                | Spawn 1 | Spawn 15 | Spawn 30 |
| ------------------- | ------- | -------- | -------- |
| Spawn interval (ms) | 1400    | 1000     | 700      |
| Hazard odds         | 5%      | 12%      | 20%      |
| Multi-spawn chance  | 0%      | 20%      | 40%      |

`multi-spawn` = sometimes spawn 2–3 fruits in the same tick, slightly staggered in x, so the player gets combo opportunities. Triggered as a roll on each spawn — if it hits, queue 1–2 extra spawns at 80–120ms offsets.

Numbers are estimates — final tuning is vibes-driven after a playtest pass. Initial gravity is ~0.18 px/frame² with starting upward velocity ~9 px/frame, which clears a typical mobile field height in roughly 1.5s up + 1.5s down. The 3-strike system softens the high-spawn-rate end.

---

## 9. Validation

Three terminal conditions:

| Condition                                      | Outcome                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `sliced >= toWin`                              | `onComplete()` — game won, wrapper shows time                               |
| Hazard sliced                                  | `onGameOver('פגעת בפלפל חריף!')` — instant fail                             |
| Unsliced produce reaches `y > fieldHeight + N` | `strikes++`; if `strikes >= maxStrikes` → `onGameOver('פספסת יותר מדי...')` |

Hazards that fall off-screen unsliced are **not** counted as missed (they're a trap, not a target). Implementation: `cullOffscreen()` only increments `strikes` for non-hazard, non-sliced fruits.

---

## 10. Assets

### Source: Twemoji

[Twemoji](https://github.com/twitter/twemoji) — CC-BY-4.0 SVGs. Drop the SVG files directly into `src/lib/games/assets/knife/`. SVG keeps file sizes tiny (~3–8 KB each), scales cleanly to any size, and renders consistently across platforms (vs platform-specific native emoji rendering).

| Asset         | Filename           | Unicode | Notes                              |
| ------------- | ------------------ | ------- | ---------------------------------- |
| Apple         | `apple.svg`        | 1f34e   | Red apple, side view               |
| Lemon         | `lemon.svg`        | 1f34b   |                                    |
| Watermelon    | `watermelon.svg`   | 1f349   | High-contrast, ideal for slice viz |
| Strawberry    | `strawberry.svg`   | 1f353   |                                    |
| Kiwi          | `kiwi.svg`         | 1f95d   | (kiwifruit)                        |
| Banana        | `banana.svg`       | 1f34c   |                                    |
| Orange        | `orange.svg`       | 1f34a   | (tangerine)                        |
| Pineapple     | `pineapple.svg`    | 1f34d   |                                    |
| Hazard: chili | `hazard_chili.svg` | 1f336   |                                    |
| Hazard: onion | `hazard_onion.svg` | 1f9c5   |                                    |

**Total: 10 SVGs.** Free, instant, no generation step.

### Visual consistency vs pizzatron

Pizzatron uses AI-generated PNGs in a warm cartoon style. Twemoji has a flatter, more saturated look. **This is fine** — each game can have a distinct visual identity, and the issue explicitly suggests Twemoji for knife to save art budget. The game shell (`game_wrapper`, HUD) keeps the apps cohesive. If consistency becomes a problem later, we can re-skin in a follow-up.

### Slash trail

No sprite. Drawn live as an SVG `<path>` (or canvas) with stroke gradient from white → soft glow. Path data updates from `stroke.points`.

### Juice particles

CSS — no SVG. Small `<div>` elements with `background-color: var(--juice-color-{type})`. Defined per fruit (apple = `--secondary` red, lemon = warm yellow, etc.) in `knife_skills.css`.

### Preload

SVGs preload via the same pattern as pizzatron (Image element with onload). Optional but recommended for the first-frame pop.

```js
async preloadAssets() {
  const urls = [/* SVG imports via new URL(..., import.meta.url) */];
  await Promise.all(urls.map(url => new Promise(res => {
    const img = new Image();
    img.onload = res;
    img.onerror = res;
    img.src = url;
  })));
}
```

---

## 11. Lifecycle integration

Maps onto the `GameWrapper` contract — same shape as pizzatron:

```js
class KnifeSkillsGame {
  constructor(container, config = {}) {
    this.container = container;
    this.config = Object.assign({ toWin: 30, maxStrikes: 3 }, config);
    // state init...
  }

  async start() {
    await this.preloadAssets();
    this.render();
    this.setupPointerInput();
    this.showStartOverlay(); // game loops don't fire until player presses Start
  }

  destroy() {
    this.isRunning = false;
    cancelAnimationFrame(this.gameLoopId);
    clearTimeout(this.spawnerId);
    // remove pointer listeners, clear stroke, remove all DOM
    this.container.innerHTML = '';
  }
}
```

Register in `GameWrapper`'s `REGISTRY`:

```js
{
  key: 'knife',
  name: 'אמן הסכין',
  icon: '🔪',
  description: 'חתכו את הפירות, היזהרו מהמכשולים',
  GameClass: KnifeSkillsGame,
  defaultConfig: { toWin: 30, maxStrikes: 3 },
  successMessage: 'כל הכבוד! חיתוך מושלם',
  loadingText: 'משחיזים את הסכינים... חכה רגע!',
}
```

Hebrew strings used in-game:

- Start title: `"אמן הסכין"`
- Start instructions: `"החליקו את האצבע על הפירות לחתוך אותם. היזהרו מהפלפל החריף והבצל!"`
- Game over (hazard): `"פגעת בפלפל חריף!"` / `"פגעת בבצל!"`
- Game over (misses): `"פספסת יותר מדי פירות!"`
- Combo: `"קומבו! ×N"`

---

## 12. File layout

```
src/lib/games/
  knife_skills.js            # game class
  knife_skills.css           # styles (imported as ?inline by game_wrapper.js)
  game_wrapper.js            # +import + REGISTRY entry
  assets/
    knife/
      apple.svg
      lemon.svg
      watermelon.svg
      strawberry.svg
      kiwi.svg
      banana.svg
      orange.svg
      pineapple.svg
      hazard_chili.svg
      hazard_onion.svg
```

`game_wrapper.js` change:

```js
import { KnifeSkillsGame } from './knife_skills.js';
import knifeCss from './knife_skills.css?inline';

export const GAME_STYLES = `${wrapperCss}\n${memoryCss}\n${burgerCss}\n${pizzaCss}\n${knifeCss}`;
// + REGISTRY entry
```

(After the `GameWrapper.random()` registry refactor lands per #259, registration may move; revisit then.)

---

## 13. Scope checklist (single delivery)

Built as one PR — no phase gating. Sub-bullets are the acceptance criteria.

- **Assets (10 SVGs)** — Twemoji set in `src/lib/games/assets/knife/`, attribution recorded.
- **Skeleton** — `knife_skills.js` + `knife_skills.css` follow the pizzatron/burger-stacker class shape.
- **Wrapper registration** — `game_wrapper.js` REGISTRY entry + `GAME_STYLES` append + static CSS import in `games-page.js` so the chooser preloads styles.
- **Physics + spawn** — fruits arc up from the bottom band, gravity pulls back, missed fruits cull off the bottom and increment strikes.
- **Slice input** — Pointer Events with stroke tracking; segment-circle intersection + min-velocity gate; slash trail rendered live.
- **Halves via clip-path** — single sprite per fruit, two halves diverge with kick perpendicular to cut angle, both fall under physics.
- **Hazards** — 2 types in spawn pool; slicing one ends the run instantly.
- **Combo** — per-stroke count, floating "קומבו! ×N" text on stroke end.
- **Difficulty curve** — spawn interval, hazard odds, multi-spawn chance scale with `spawnCounter`.
- **Polish** — juice particles per fruit, strike-pip flash, hazard field flash, `touch-action: none` on the field.
- **Hebrew strings** — start overlay, hazard fail, miss fail, combo text.
- **Verify** — lint clean, format clean, build green, smoke test via Playwright on `/games`.

---

## 14. Out of scope for v1

- Audio (matches pizzatron decision #6)
- Score / combo multiplier surfaced to the wrapper (would need shared HUD change)
- Power-ups (slow time, double-blade, freeze hazards)
- Variable fruit sizes / "rare giant fruit" bonus
- Leaderboard / persistence
- Background scenery (kitchen counter, etc.)
- Accessibility for screen readers — game is fundamentally visual; consider a separate pass if mini-games become a core feature

---

## 15. Open / deferred decisions

- **Hebrew name** — placeholder is `"אמן הסכין"` (Knife Master). Alternatives: `"סושי שף"`, `"חיתוך מהיר"`. Park for now.
- **Strike count** — 3 is the default. Some Fruit-Ninja variants use 0 (any miss = fail). Worth a tuning pass after first playtest.
- **Combo display position** — floating from the slice end-point vs fixed center of HUD. Trying floating first; revisit if it competes with the slash trail.
- **Hazard slice fail vs hazard touch fail** — currently fail only on slice (requires min-velocity, so accidental hovers don't fail). If players complain "I didn't mean to swipe through it", we keep the velocity gate strict. If they complain "I dodged it and still failed", we may need a "did the segment cross with intent" heuristic. Park; iterate after playtest.
- **Shared pointer-input helper extraction** — issue #266 lists this as shared infra. Pizzatron's drag and knife's swipe share _Pointer Events_ primitives but the rest is different. Extraction recommended **after** game #3 (Latte Art) ships, so we have three concrete consumers to design against rather than two.
