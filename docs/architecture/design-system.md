# Design System

All design decisions are encoded as CSS custom properties in **`src/styles/tokens.css`**. New CSS — whether in global stylesheets, page CSS, or component shadow roots — must reference tokens. Raw hex colours and hardcoded pixel values are not acceptable for anything a token covers.

There is also a live token reference at `src/styles/design-system.html`.

## Colour

### Palette (raw)

| Token                                    | Value     | Use                         |
| ---------------------------------------- | --------- | --------------------------- |
| `--primary`                              | `#6a994e` | Brand green; primary CTAs   |
| `--primary-dark`                         | `#386641` | Hover/active for primary    |
| `--primary-bright`                       | `#a7c957` | Accents, highlights         |
| `--secondary`                            | `#bc4749` | Brand red; warnings, errors |
| `--secondary-light` / `--secondary-dark` | —         | Hover/active for secondary  |
| `--neutral`                              | `#f2e8cf` | Warm cream                  |

### Surface ladder

`--surface-0` (page) → `--surface-1` (card) → `--surface-2` (sunken). Use these instead of literal white/cream for any container background.

### Ink ladder

`--ink` (near-black, used sparingly for headlines) → `--ink-2` (body) → `--ink-3` (muted) → `--ink-4` (quiet/disabled). Hairlines: `--hairline`, `--hairline-strong`.

### Semantic aliases

`--bg`, `--card-bg`, `--text-color`, `--text-strong`, `--text-muted`, `--primary-color`, `--primary-hover`, `--button-color`. Prefer the semantic alias when the role is obvious (it survives future palette changes); use the raw token when the role doesn't fit.

## Typography

- `--font-display` — Instrument Serif (with Georgia metric fallback). Headings, hero titles.
- `--font-ui` — Geist (with Arial metric fallback). Body, UI chrome.
- `--font-ui-he` — Noto Sans Hebrew. RTL containers.
- `--font-display-he` — Noto Serif Hebrew. RTL headings.
- `--font-mono` — Geist Mono.

Metric-adjusted fallbacks (`@font-face` declarations at the top of `tokens.css`) prevent CLS during font swap. Don't load font files directly in component CSS.

### Fluid type scale

`--step--1` (caption) through `--step-6` (display). Each is a `clamp()` so type scales smoothly with viewport width. Use the scale step, not `font-size: 14px`.

## Radii

`--r-xs` (6px) → `--r-sm` (10px) → `--r-md` (14px) → `--r-lg` (20px) → `--r-xl` (28px) → `--r-2xl` (40px) → `--r-pill` (9999px).

## Shadows

`--shadow-1` (subtle, default cards), `--shadow-2` (raised), `--shadow-3` (modal/popover). Focus ring: `--ring` (3px tinted in primary green).

## Motion

- Easings: `--ease` (general), `--ease-out` (exits, settles).
- Durations: `--dur-1` 160ms (micro), `--dur-2` 280ms (default), `--dur-3` 520ms (large transitions).

## Layout

- `--content-max` — `1200px` page cap.
- `--gutter` — fluid `clamp(20px, 4vw, 48px)` for outer padding.

## Z-index

**This is the canonical reference for application stacking.** Tokens form a deliberate hierarchy:

| Token              | Value | Layer                             |
| ------------------ | ----- | --------------------------------- |
| `--z-hide`         | -1    | Hide behind page                  |
| `--z-base`         | 0     | Default flow                      |
| `--z-elevated`     | 10    | Hover states, local card stacking |
| `--z-sticky`       | 100   | Sticky headers within pages, FABs |
| `--z-page-overlay` | 200   | In-page dropdowns, tooltips       |
| `--z-nav`          | 1000  | Top navigation bar                |
| `--z-backdrop`     | 1010  | Dimming backdrops                 |
| `--z-drawer`       | 1020  | Drawers, side panels              |
| `--z-modal`        | 2000  | Modals, dialogs                   |
| `--z-toast`        | 3000  | Toast notifications               |
| `--z-fullscreen`   | 10000 | Fullscreen media viewers          |
| `--z-spinner`      | 10010 | Global loading spinners           |

### Rules

- **Use a token** when the element competes with another application-level layer — nav, drawers, modals, backdrops, toasts, page overlays.
- **Raw numeric `z-index` is acceptable** for internal component layout: lifting a pseudo-element above a sibling within the same component, ordering two children inside a card. These are local to the component's stacking context, so an application-level token would be semantically wrong.
- **Never use a raw number** for anything that could collide with the application layers above.

## Icons

Icons are inline SVGs from a central registry at `src/js/icons.js`. **Font Awesome is not loaded** — there is no CDN link. Importing it would be wrong.

```js
import { icons } from '../../js/icons.js'; // adjust path as needed
element.innerHTML = icons.heart;
```

Current keys (extend as needed): `heart`, `archive`, `userShield`, `home`, `bookOpen`, `plusCircle`, `utensils`, `link`, `times`, `trashAlt`, `check`.

To add a new icon:

1. Find the icon at https://fontawesome.com/v5/icons?s=solid&m=free.
2. Get the raw SVG from `https://github.com/FortAwesome/Font-Awesome/tree/5.15.4/svgs/solid/<name>.svg`.
3. Copy the `viewBox` and `<path d="...">`.
4. Add an entry in `src/js/icons.js` via the `svg()` (or `svgStroke()`) helper. Use camelCase for hyphenated names (`trash-alt` → `trashAlt`).

Icons inherit colour via `fill="currentColor"` and scale via `width="1em" height="1em"`, so they pick up the surrounding text colour and size automatically.

## RTL

Hebrew content must use `dir="rtl"` on its container. Most page templates set this on the root `<div>` of the page; components reading the surrounding direction will inherit it. The fluid type scale and tokens work identically in both directions.

## Hard rules

- No raw hex colours in CSS — use a colour token.
- No hardcoded `px` font sizes — use the fluid scale.
- No raw `z-index` numbers for anything at application scope — use a `--z-*` token.
- No new global CSS that doesn't reference tokens for the values it sets.
