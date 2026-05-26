# Performance Lessons

Patterns and pitfalls discovered while tuning the SPA.

> **When to add an entry:** after fixing a perf bug whose root cause was a pattern (not a single-site mistake). Date it (`YYYY-MM-DD`), state the Learning + Action in 2–4 lines, and add the newest entry at the top of its block. Newest entries win when guidance conflicts. If a pattern fits inside an architecture doc (`docs/architecture/*.md`), put the canonical version there and add a short pointer entry here.

## 2026-05-27 - Observability SDKs: Dynamic Import _and_ Idle-Defer

**Learning:** Plain dynamic `import()` of a non-UI SDK moves bytes off the entry bundle but moves the same parse + init work into the post-FCP window — where it counts against TBT, not LCP. For Sentry, that swap took the deploy-preview score from ~85 to 77 even though `main.js` shrank by 28 KB gz.
**Action:** Combine dynamic `import()` with `requestIdleCallback(load, { timeout: 5000 })` (and a `setTimeout(load, 3000)` fallback for older Safari) so the chunk fetch, parse, and init all happen during browser idle. Queue any pre-init API calls in-module and flush on resolution. Canonical pattern: [`src/js/services/logger.js`](../../src/js/services/logger.js); architecture write-up in [`observability.md`](../architecture/observability.md#performance-impact).

## 2026-05-26 - Non-blocking Holds for Every New Init-Path Import

**Learning:** Adding _one more_ `await import()` to `initializeSPA` (even for a 2 KB chunk that holds an idle event handler) dropped the deploy preview's Lighthouse mobile-throttled Performance score from ~90 to 65. Throttled mobile budgets a single extra critical-path round-trip generously. The earlier "Non-blocking Component Preloading" rule applies recursively — once one `await` is justified for an ordering reason (e.g. `navigation-script`), it is tempting to chain another on the same line. Don't.
**Action:** Default every new dynamic import in `initializeSPA` to `import(...).then(use)` (fire-and-forget). Only chain a second `await` if you can name the specific race it prevents _and_ prove the handler must be attached before first paint. Idle handlers that the user can't trigger within ~500 ms (e.g. the easter-egg detector) do not qualify.

## 2025-10-25 - Debounce Search Inputs

**Learning:** Search inputs triggering filtering operations directly on every keystroke can cause performance bottlenecks. Debouncing is a simple, effective optimization.
**Action:** Always wrap search input handlers with a debounce function (e.g., 300ms) to reduce the frequency of filtering operations and improve application responsiveness.

## 2025-10-25 - Non-blocking Component Preloading

**Learning:** `await`ing every component import in the application initialization path (e.g., in `initializeSPA`) delays the Time to Interactive (TTI) because the router waits for all components to load before rendering.
**Action:** Separate truly critical shell components (like `navigation-script`) from supplemental ones (like Auth and Search). `await` only critical shell dependencies to avoid race conditions, but let supplemental ones load in parallel via non-blocking `Promise.all().catch()`.

## 2025-10-25 - User Data Caching & Event Listening

**Learning:** Firestore `getDoc` calls are not automatically deduped or cached in memory across components if not using a listener. Centralizing user data fetching in `AuthService` and listening for update events (like `recipe-favorite-changed`) significantly reduces redundant network requests.
**Action:** Always prefer a centralized data service with caching and event listeners for frequently accessed, user-specific data that changes based on UI actions.

## 2025-10-24 - Service Request Deduplication

See [`docs/architecture/services.md`](../architecture/services.md#request-deduplication-and-caching) for the canonical pattern (store and return the in-flight promise inside the service so concurrent callers share one network request). Pointer kept here for discoverability.

## 2025-10-24 - Package Lock Noise & Memory Leaks

**Learning:** `npm install` can generate significant noise in `package-lock.json` if local environment differs from CI/CD. Also, simple `Map` caches in SPAs can leak memory if unbounded.
**Action:** Revert `package-lock.json` if no dependencies added. Always implement LRU or size limits for in-memory caches in long-running applications.

## 2025-10-24 - Web Components Data Passing

**Learning:** Web Components often default to fetching their own data based on ID attributes. This causes N+1 fetch cascades in lists.
**Action:** Always implement a property setter (e.g., `set data(val)`) on list item components to allow parent lists to pass pre-fetched data directly, bypassing the internal fetch.

## 2025-10-18 - Code Splitting for SPA

**Learning:** Static imports of page modules in the main entry point (`src/app.js`) defeat the purpose of lazy loading logic in `PageManager`. Vite bundles everything imported statically into the main chunk.
**Action:** Always use dynamic `import()` inside route handlers for page components to ensure they are split into separate chunks.
