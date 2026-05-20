# Performance Lessons

Patterns and pitfalls discovered while tuning the SPA. Dated entries; newest practices win when guidance conflicts.

## 2025-10-18 - [Code Splitting for SPA]

**Learning:** Static imports of page modules in the main entry point (`src/app.js`) defeat the purpose of lazy loading logic in `PageManager`. Vite bundles everything imported statically into the main chunk.
**Action:** Always use dynamic `import()` inside route handlers for page components to ensure they are split into separate chunks.

## 2025-10-24 - [Web Components Data Passing]

**Learning:** Web Components often default to fetching their own data based on ID attributes. This causes N+1 fetch cascades in lists.
**Action:** Always implement a property setter (e.g., `set data(val)`) on list item components to allow parent lists to pass pre-fetched data directly, bypassing the internal fetch.

## 2025-10-24 - [Package Lock Noise & Memory Leaks]

**Learning:** `npm install` can generate significant noise in `package-lock.json` if local environment differs from CI/CD. Also, simple `Map` caches in SPAs can leak memory if unbounded.
**Action:** Revert `package-lock.json` if no dependencies added. Always implement LRU or size limits for in-memory caches in long-running applications.

## 2025-10-24 - [Service Request Deduplication]

**Learning:** When multiple components (like list items) call the same service method simultaneously on mount, simple caching isn't enough because all requests fire before the cache is populated.
**Action:** Implement request deduplication by storing and returning the in-flight promise (`_fetchPromise`) in service methods, so concurrent calls await the same network request.

## 2025-10-25 - [User Data Caching & Event Listening]

**Learning:** Firestore `getDoc` calls are not automatically deduped or cached in memory across components if not using a listener. Centralizing user data fetching in `AuthService` and listening for update events (like `recipe-favorite-changed`) significantly reduces redundant network requests.
**Action:** Always prefer a centralized data service with caching and event listeners for frequently accessed, user-specific data that changes based on UI actions.

## 2025-10-25 - [Non-blocking Component Preloading]

**Learning:** `await`ing every component import in the application initialization path (e.g., in `initializeSPA`) delays the Time to Interactive (TTI) because the router waits for all components to load before rendering.
**Action:** Separate truly critical shell components (like `navigation-script`) from supplemental ones (like Auth and Search). `await` only critical shell dependencies to avoid race conditions, but let supplemental ones load in parallel via non-blocking `Promise.all().catch()`.

## 2025-10-25 - [Debounce Search Inputs]

**Learning:** Search inputs triggering filtering operations directly on every keystroke can cause performance bottlenecks. Debouncing is a simple, effective optimization.
**Action:** Always wrap search input handlers with a debounce function (e.g., 300ms) to reduce the frequency of filtering operations and improve application responsiveness.
