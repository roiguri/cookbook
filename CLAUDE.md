# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server (http://localhost:5173)
netlify dev          # Dev server with Netlify features (redirects, functions) — more accurate to prod
npm run build        # Production build
npm run serve        # Preview production build
npm run test         # Jest unit tests
npm run test -- tests/js/router.test.js  # Run a single test file
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier formatting (required before committing — enforced by pre-commit hook)
```

Pre-commit hook runs format check, ESLint, tests, and build — all must pass.

## Architecture

### SPA Core

This is a vanilla JS SPA (no framework). The shell lives in `index.html` with a persistent `<header>`, `<main id="spa-content">`, and `<footer>`. Only `#spa-content` is replaced on navigation.

**`src/app.js`** — entry point. Initializes Firebase, registers 7 routes with dynamic imports (code splitting), and non-blocking preloads supplemental components.

**`src/app/core/router.js`** — custom `AppRouter` using the History API. Supports parameterized routes (e.g. `/recipe/:id`), navigation guards, and query parameters. Routes are registered as async handlers that delegate to `PageManager`.

**`src/app/core/page-manager.js`** — manages the page lifecycle:

1. `unloadCurrentPage()` — calls `unmount()`, clears container
2. `showLoadingState()` — appends spinner overlay to `#spa-content`
3. `render(params)` → fetches HTML template string
4. `renderPageContent(html)` — sets innerHTML
5. `showLoadingState()` again — re-overlays spinner through data load
6. `mount(container, params)` — initializes components, loads data
7. `hideLoadingState()` — removes spinner when page is ready

### Page Module Contract

Every page is a plain object exported from `src/app/pages/`. Use `_template.js` as the starting point. Required method: `render(params)` returning an HTML string. Optional: `mount(container, params)`, `unmount()`, `getTitle(params)`, `getMeta(params)`, `handleRouteChange(params)` (called instead of full reload when navigating to the same route with different params).

HTML templates are typically fetched via `fetch(new URL('./page-name.html', import.meta.url))` so they work regardless of where the SPA is mounted.

### Component System

UI components are custom Web Components in `src/lib/`. Most use Shadow DOM. Import them dynamically inside `mount()` so they only load when needed. The component fires custom events (e.g. `recipe-card-open`) that the page module listens for to trigger navigation or data updates.

### Services / Firebase Layer

Pages and lib components consume **domain services** under `src/js/services/<domain>/` — never raw Firebase SDKs and never the `_firebase/*` infrastructure services directly. ESLint enforces this with zero exemptions.

Architecture, conventions, full service surface, and reusable patterns: [`docs/architecture/services.md`](docs/architecture/services.md). JSDoc on each service class is the canonical API reference. Firebase config: `src/js/config/firebase-config.js`.

### Routing Reference

| Route               | Page module                 |
| ------------------- | --------------------------- |
| `/home`             | `home-page.js`              |
| `/categories`       | `categories-page.js`        |
| `/recipe/:id`       | `recipe-detail-page.js`     |
| `/propose-recipe`   | `propose-recipe-page.js`    |
| `/grandmas-cooking` | `documents-page.js`         |
| `/dashboard`        | `manager-dashboard-page.js` |
| `/my-meal`          | `my-meal-page.js`           |

### User Roles

Three roles stored in `users/{uid}.role`: `user`, `approved`, `manager`. Auth state is managed by `src/lib/auth/auth-controller.js`, which fires a `auth-state-changed` custom event and mutates the header nav to add/remove role-specific tabs (favorites, grandma's recipes, dashboard).

### Testing

Unit tests use Jest with jsdom in `tests/`. Firebase is mocked via `tests/common/mocks/`. E2E tests use Playwright (`tests/visuals/e2e/`) and require the dev server running on port 5173 (started automatically by Playwright config).

### Cloud Functions

`functions/index.js` handles Gemini AI recipe extraction from images/URLs, and batch recipe imports. Triggered by Pub/Sub and Firestore events. (Legacy image compression via Sharp was removed in favor of automated Storage-triggered WebP resizing).

### Design System

Tokens are in `src/styles/tokens.css` (v2, modern). Key variables to use in all new CSS:

- **Colors**: `--primary` (green `#6a994e`), `--secondary` (red `#bc4749`), surface ladder `--surface-0/1/2`, ink ladder `--ink/2/3/4`
- **Typography**: `--font-display` (Instrument Serif, headings), `--font-ui` (Geist, body/UI), `--font-ui-he` (Noto Sans Hebrew, Hebrew text); fluid type scale `--step--1` through `--step-6`
- **Radii**: `--r-xs` through `--r-pill`
- **Shadows**: `--shadow-1/2/3`, `--ring` (focus ring)
- **Motion**: `--ease`, `--ease-out`, `--dur-1` (160ms), `--dur-2` (280ms), `--dur-3` (520ms)
- **Layout**: `--content-max` (1200px), `--gutter` (fluid)
- **Z-Index**: token hierarchy (lowest → highest): `--z-elevated` (10) → `--z-sticky` (100) → `--z-page-overlay` (200) → `--z-nav` (1000) → `--z-backdrop` (1010) → `--z-drawer` (1020) → `--z-modal` (2000) → `--z-toast` (3000) → `--z-fullscreen` (10000) → `--z-spinner` (10010)

**Z-index rules:**

- Always use a token when placing an element in the application stacking context (nav, drawers, modals, backdrops, toasts, overlays).
- Raw numeric `z-index` values are acceptable for _internal_ component layout — e.g. `z-index: 1` to lift a pseudo-element or child above a sibling within the same component. These are local, not application-level, so tokens would be semantically wrong.
- Never use a raw number for anything that competes with application-level layers (header, drawers, modals, etc.).

Never use raw hex colors or hardcoded px values for things covered by tokens. The app has Hebrew RTL content — use `dir="rtl"` on Hebrew containers.

### Icons

Icons are inline SVGs managed via a central registry at `src/js/icons.js`. Font Awesome is **not** loaded — do not add a CDN link for it.

```js
import { icons } from '../../js/icons.js'; // adjust path as needed
element.innerHTML = icons.heart; // renders the SVG inline
```

Available keys: `heart`, `archive`, `userShield`, `home`, `bookOpen`, `plusCircle`, `utensils`, `link`, `times`, `trashAlt`, `check`.

To add a new icon: find the SVG at `github.com/FortAwesome/Font-Awesome/tree/5.15.4/svgs/solid/<name>.svg`, copy the `viewBox` and `<path d="...">`, add an entry in `icons.js` using the `svg()` helper. Use camelCase for hyphenated names.

---

## Git Workflow

Branch structure:

- `main` — production (deployed to Netlify)
- `development` — integration branch; feature branches merge here
- `staging` — pre-release testing (maps to staging Netlify environment)
- `testing` — automated testing branch

Branch from `development` for new features/fixes. Commit messages follow Conventional Commits: `fix(scope): message #issue`, `feat(scope): message`. Reference issue numbers where applicable.

---

## Deployment

### Netlify (frontend)

Pushes to `main` auto-deploy to production. `netlify dev` runs a local server with Netlify redirects and function proxying active.

Build: `npm run build` → output in `dist/`. All routes redirect to `index.html` (SPA).

### Firebase (rules + functions)

```bash
firebase deploy --only firestore:rules     # deploy Firestore rules
firebase deploy --only storage             # deploy Storage rules
firebase deploy --only functions           # deploy Cloud Functions (runs lint first)
firebase deploy                            # deploy everything
```

Rules files: `firestore.rules`, `storage.rules`. Functions source: `functions/`.

---

## Further Reading

Deeper references — consult these before making non-trivial changes:

- `docs/architecture/spa-core.md` — router, page manager, page module contract.
- `docs/architecture/components.md` — Web Components conventions, dynamic imports, custom events.
- `docs/architecture/services.md` — Firebase service wrappers, caching/dedup patterns, role enforcement.
- `docs/architecture/design-system.md` — canonical token reference (colours, type, z-index, icons).
- `docs/lessons/performance.md`, `docs/lessons/accessibility.md`, `docs/lessons/security.md` — patterns and pitfalls discovered while building.
- `docs/operations/firebase-image-optimization.md` — image pipeline configuration.
- `docs/code-review-2026-05.md` — open code-review findings (P0–P4) not yet resolved.
- `docs/archive/` — superseded/historical documents kept for reference.
