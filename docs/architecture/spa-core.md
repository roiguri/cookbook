# SPA Core

The application is a vanilla-JS Single Page Application with no framework. Three pieces own navigation and page lifecycle: the **shell** (`index.html`), the **router** (`src/app/core/router.js`), and the **page manager** (`src/app/core/page-manager.js`). Everything else hangs off the page module contract described below.

## Shell

`index.html` provides a persistent `<header>` and `<footer>` plus a single swap target:

```html
<main id="spa-content"></main>
```

Only `#spa-content` is replaced on navigation. The header (auth avatar, search bar, nav) and footer stay mounted across route changes.

## Entry point — `src/app.js`

On `DOMContentLoaded`, `initializeSPA()`:

1. Initializes Firebase (`initFirebase(firebaseConfig)`).
2. Kicks off a non-blocking `Promise.all([...])` to preload the home page module, auth controller/components, and the header search bar — failures are swallowed so they can't block boot.
3. Awaits the critical shell components (`navigation-script.js`) because the router depends on link interception.
4. Constructs `AppRouter` and `PageManager`, attaches them to `window.spa`, calls `registerRoutes()`, then `router.initialize()`.

Each route is registered with a **dynamic `import()`** inside the handler:

```js
router.registerRoute('/recipe/:id', async (params) => {
  const module = await import('./app/pages/recipe-detail-page.js');
  await pageManager.loadPage(module.default || module, { ...params, route: '/recipe/:id' });
});
```

This is what gives the SPA its code-split chunks per page. Static imports at the top of `app.js` would defeat the split — see `docs/lessons/performance.md` ("Code Splitting for SPA").

## Router — `src/app/core/router.js`

Uses the **History API** (not a hash router). Key methods:

- `registerRoute(path, handler)` — normalises leading slash, stores in a `Map`.
- `navigate(path, { replace, skipGuards })` — runs guards, updates URL via `pushState`/`replaceState`, executes the handler, dispatches a `spa-navigation` event.
- `addNavigationGuard(name, fn)` — async functions consulted before each navigation; returning `false` blocks the transition. The `popstate` path additionally restores the previous URL with `history.pushState` so the browser history doesn't desync.
- `matchParameterizedRoute(path)` — segment-wise match for patterns like `/recipe/:id`; populates `params` from the colon segments.
- `getCurrentParams()` — merges `URLSearchParams` from `location.search` with the parameterized route's `:id` (synthesised as `params.id`).
- `handleNotFound(path)` — routes to `/404` if registered, otherwise falls back to the default route (`/home`). Includes an explicit guard against infinite redirect loops when the default route itself is missing.
- Categories-specific helpers (`buildCategoriesParams`, `navigateToCategoriesWithParams`) live on the router because the categories page's filter/search/favorites state is encoded directly in the URL.

A singleton `router` is exported at the bottom of the file, but `app.js` constructs its own `AppRouter` instance and exposes it as `window.spa.router`.

## Page lifecycle — `src/app/core/page-manager.js`

`PageManager.loadPage(module, params)` is the single entry point. Two paths:

**Same-route navigation** (route key unchanged, e.g. category filter changes on `/categories`):

1. Calls the module's optional `handleRouteChange(params)` and stops. No unmount, no re-render.

**Cross-route navigation:**

1. `unloadCurrentPage()` — invokes `unmount()` on the outgoing module, clears the container.
2. `loadNewPage()`:
   - `window.scrollTo(0, 0)`.
   - Awaits `render(params)` → HTML string.
   - `renderPageContent(html)` sets `innerHTML`.
   - `showLoadingState()` appends a `.page-loading` overlay with a spinner.
   - `updatePageMetadata(params)` — calls optional `getTitle()` / `getMeta()` and updates `<title>` plus `<meta>` tags.
   - Awaits `mount(container, params)`.
   - If the module defines `waitForReady()`, awaits it with a 10-second timeout race so a slow data load can't hang the spinner forever.
   - `hideLoadingState()` — fades the overlay out over 150ms then removes it.

Concurrency: `isLoading` flag rejects re-entrant `loadPage()` calls with a warning. Errors are caught at the top level and render a generic error card via `handlePageLoadError()`.

## Page module contract

Every page is a plain object exported as `default` from `src/app/pages/*.js`. Copy `src/app/pages/_template.js` as the starting point.

| Method                            | Required | Purpose                                                                                                                                                                                         |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render(params)`                  | ✅       | Returns the page's HTML as a string. Typically fetches a co-located `.html` file using `fetch(new URL('./page-name.html', import.meta.url))` so the path resolves regardless of mount location. |
| `mount(container, params)`        | optional | Wire up event listeners, dynamically import components, load data. The container is `#spa-content`.                                                                                             |
| `unmount()`                       | optional | Remove listeners, cancel in-flight requests, clear timers. **Required in practice** to prevent leaks — `PageManager` warns if it's missing.                                                     |
| `getTitle(params)`                | optional | Returns a string used for `document.title`.                                                                                                                                                     |
| `getMeta(params)`                 | optional | Returns `{ description, keywords, ... }` mapped to `<meta>` tags.                                                                                                                               |
| `handleRouteChange(params)`       | optional | Called instead of `unmount`/`render`/`mount` when navigating to the same route with different params.                                                                                           |
| `waitForReady(container, params)` | optional | Returns a promise the page manager awaits (up to 10s) before hiding the loading spinner — useful when `mount` returns before data has loaded.                                                   |
| `getStylePaths(params)`           | optional | Returns paths to dynamically-loaded CSS. (Most pages use co-located CSS in `src/styles/pages/`.)                                                                                                |

## Routing table

| Route               | Page module                               |
| ------------------- | ----------------------------------------- |
| `/home`             | `src/app/pages/home-page.js`              |
| `/categories`       | `src/app/pages/categories-page.js`        |
| `/recipe/:id`       | `src/app/pages/recipe-detail-page.js`     |
| `/propose-recipe`   | `src/app/pages/propose-recipe-page.js`    |
| `/grandmas-cooking` | `src/app/pages/documents-page.js`         |
| `/dashboard`        | `src/app/pages/manager-dashboard-page.js` |
| `/my-meal`          | `src/app/pages/my-meal-page.js`           |
| `/games`            | `src/app/pages/games-page.js`             |

`/games` is an unlisted easter-egg route: tap the header logo (or mobile drawer brand) 7 times within 2 seconds to trigger a sparkle-burst animation and navigate to it. The route is also reachable by direct URL. Detector lives in `src/lib/easter-egg/games-unlock.js`, animation styles in the sibling `.css`. Initialized at SPA boot from `src/app.js`.

Netlify is configured to fall back to `index.html` for unknown paths (see `netlify.toml`) so deep links work on production.
