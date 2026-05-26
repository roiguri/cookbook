# Performance Lessons

Patterns and pitfalls discovered while tuning the SPA.

> **When to add an entry:** after fixing a perf bug whose root cause was a pattern (not a single-site mistake). Date it (`YYYY-MM-DD`), state the Learning + Action in 2–4 lines, and add the newest entry at the top of its block. Newest entries win when guidance conflicts. If a pattern fits inside an architecture doc (`docs/architecture/*.md`), put the canonical version there and add a short pointer entry here.

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
