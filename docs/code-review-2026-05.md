# Deep Code Review — May 2026

> Expert review across architecture, performance, and security for the Cookbook vanilla JS SPA. Findings are prioritized P0 → P4 with file:line references and concrete fixes. Nothing in this document has been implemented yet.

## Scope

Three dimensions reviewed in parallel:

1. **Architecture** — router, page lifecycle, components, services, state
2. **Performance** — bundling, initial load, queries, rendering, Cloud Functions
3. **Security** — Firestore/Storage rules, XSS, Cloud Functions, auth flow

All findings were spot-checked against the actual code. Two initially flagged "leaks" turned out to be false positives and were removed:

- recipe-detail-page `_menuCleanup` IS cleaned up at [recipe-detail-page.js:207](../src/app/pages/recipe-detail-page.js#L207)
- my-meal-page DOES define `unmount()` at [my-meal-page.js:905](../src/app/pages/my-meal-page.js#L905)

---

## P0 — Critical Security (Fix First)

### S1. Storage: any authenticated user can delete any recipe image

- **Where:** [storage.rules:22](../storage.rules#L22), [storage.rules:45](../storage.rules#L45)
- **Issue:** `allow delete: if isAuthenticated();` — no owner check. Any signed-in user can wipe another user's images and media instructions.
- **Fix:** Restrict delete to manager only. `isManager()` helper would need to be added to storage.rules (Firestore-style `firestore.get()` cross-service is supported).
- **Verification:** Add a Storage Rules unit test (`@firebase/rules-unit-testing`) attempting delete as a non-manager — must fail.

### S2. Cloud Function SSRF in `extractRecipeFromUrl`

- **Where:** [functions/index.js:529-583](../functions/index.js#L529)
- **Issue:** Function fetches arbitrary user-supplied URLs server-side. Validation is only `new URL(url)`. Approved/manager role gating helps but does not prevent insider abuse or compromised accounts probing internal Google Cloud metadata (`169.254.169.254`), private IPs, or `file://`.
- **Fix:** Block private/loopback/link-local IPs, restrict scheme to `http(s)`, follow redirects with re-validation, and consider a domain allowlist if practical.
- **Verification:** Manual call from Firebase Emulator with `http://169.254.169.254/...` — must reject with `invalid-argument`.

### S3. Cloud Function unbounded image buffer

- **Where:** [functions/index.js:13-78](../functions/index.js#L13) (`processRecipeImages`)
- **Issue:** `await response.arrayBuffer()` with no Content-Length check. Storage rules cap uploads at 50MB but `downloadUrl` is fetched fresh on the server and could be redirected.
- **Fix:** Inspect `response.headers.get('content-length')` before buffering; reject >50MB.

### S4. Pub/Sub trigger lacks origin validation

- **Where:** `processRecipeTransfer` in [functions/index.js](../functions/index.js)
- **Issue:** No payload signature/source check. Relies entirely on IAM. Defense-in-depth gap.
- **Fix:** Validate the message envelope shape and the publisher service account; fail closed on unexpected origin.

---

## P1 — High-Priority Bugs & Memory Leaks

### B1. `manager-dashboard-page` document listener never removed

- **Where:** [manager-dashboard-page.js:162](../src/app/pages/manager-dashboard-page.js#L162)
- **Issue:** `document.addEventListener('recipe-updated', ...)` registered in `setupEditRecipeListener()` with no removal in `unmount()` at line 46. Each visit to the dashboard adds a new listener; navigation cycles cause duplicate `refreshRecipes()` calls.
- **Fix:** Store the bound handler on `this._onRecipeUpdated`, attach with that reference, remove in `unmount()`.

### B2. PageManager `isLoading` flag can stick

- **Where:** [page-manager.js:14-47](../src/app/core/page-manager.js#L14)
- **Issue:** If `unmountCurrentPage()` or `render()` throws, `isLoading` never resets and all subsequent navigation is silently dropped.
- **Fix:** Wrap navigation logic in `try { ... } finally { this.isLoading = false; }`.

### B3. No AbortController on page-scoped data fetches

- **Where:** [home-page.js:56](../src/app/pages/home-page.js#L56), [categories-page.js:48](../src/app/pages/categories-page.js#L48), [manager-dashboard-page.js:259](../src/app/pages/manager-dashboard-page.js#L259)
- **Issue:** Rapid navigation (e.g., back-button spam) lets stale fetches resolve into a detached page, sometimes throwing on null DOM refs, sometimes corrupting cached state.
- **Fix:** Either (a) add an `AbortController` per page mount and pass `signal` into Firestore wrappers, or (b) tag each mount with a monotonically increasing `mountId` and discard responses whose id ≠ current.

### B4. Auth observer cleanup inconsistent across pages

- **Where:** Various pages register `onAuthStateChanged` listeners but only some call `authUnsubscribe()` in unmount. Mostly correct in newer pages but not enforced.
- **Fix:** Architectural — see R2 (base page class). Stopgap: audit each page module and ensure unsubscribe is called.

### B5. `categories-page` listener possibly re-attached

- **Where:** [categories-page.js:312](../src/app/pages/categories-page.js#L312)
- **Issue:** `setupEventListeners()` may be invoked more than once on `handleRouteChange` paths; `_boundFavoriteChanged` is bound once but re-attached without dedup.
- **Fix:** Guard with `if (this._listenersAttached) return;` or remove-then-add pattern.

---

## P2 — Performance Wins

### P1. Firebase SDK loaded synchronously at startup

- **Where:** [src/app.js:15-16](../src/app.js#L15)
- **Impact:** ~88KB modular Firebase blocks first paint; impacts unauthenticated home-page LCP.
- **Fix:** Defer `initFirebase()` until first auth/data call. Wrap as lazy singleton in `firebase-config.js`. Header avatar already needs auth, so initialize there.

### P2. Categories page loads ALL recipes client-side

- **Where:** [categories-page.js:211-217](../src/app/pages/categories-page.js#L211)
- **Impact:** No `limit()` and no server-side pagination. Cost grows linearly with collection size; UI does client-side filtering on the full set.
- **Fix:** Use Firestore `limit(20)` + cursor (`startAfter`) pagination per category. Server-side `where('category', '==', X)` query with `orderBy('creationTime', 'desc')` — add the matching composite index in `firestore.indexes.json`.

### P3. Manager dashboard loads entire `users` collection

- **Where:** [manager-dashboard-page.js:184](../src/app/pages/manager-dashboard-page.js#L184)
- **Impact:** Quadratic Firestore reads as users grow.
- **Fix:** Paginate (`limit(50)` + cursor); add server-side search by email/name with `where('email', '>=', ...)`. If full export needed, use a Cloud Function with admin SDK.

### P4. No responsive images / no `srcset`

- **Where:** Recipe cards and detail pages
- **Impact:** Full-resolution Storage URLs served to thumbnails (~1MB images for ~150px slots).
- **Fix:** Use the auto-generated WebP variants from the Storage-triggered resize (per CLAUDE.md, already deployed). Wire `<img srcset="<thumb> 400w, <medium> 800w, <full> 1600w" sizes="...">`.

### P5. Component renders use full `shadowRoot.innerHTML` rewrites

- **Where:** [recipe_component.js:88](../src/lib/recipes/recipe_component/recipe_component.js#L88), recipe-card, image-handler
- **Impact:** Destroys listeners on every render; FOUC; expensive in grids.
- **Fix:** Render-once + delegate updates via attribute observation; or use a tiny diff library scoped to the component. Lower priority — measure first with DevTools Performance tab.

### P6. ImageHandler preview uses base64 data: URLs

- **Where:** [image-handler.js:498](../src/lib/images/image-handler.js#L498)
- **Impact:** 5 × 3MB images = 15MB+ base64 strings held in DOM/JS memory simultaneously.
- **Fix:** Use `URL.createObjectURL(file)` for previews; revoke with `URL.revokeObjectURL()` on remove.

### P7. Cloud Function image processing is sequential

- **Where:** [functions/index.js:18-28](../functions/index.js#L18)
- **Fix:** `await Promise.all(images.map(processOne))`. ~5× speedup on multi-image recipes.

### P8. No CSS code-splitting

- **Where:** [src/styles/main.css](../src/styles/main.css)
- **Impact:** All page styles ship on first load.
- **Fix:** Move per-page CSS into the page module via dynamic `import('./page.css')`. Lower priority unless CSS bundle exceeds ~50KB.

---

## P3 — Lower-Severity Security

### S5. Recipes are publicly readable including unapproved

- **Where:** [firestore.rules:80](../firestore.rules#L80) (`allow read: if true;`)
- **Risk:** Pending user submissions exposed to scrapers/bots.
- **Fix:** `allow read: if resource.data.approved == true || isOwner(resource.data.userId) || isManager();` — verify all read paths first (categories page filters client-side; this would push that filter to the server).

### S6. Manager dashboard uses `innerHTML` with template interpolation

- **Where:** [manager-dashboard-page.js:687](../src/app/pages/manager-dashboard-page.js#L687) (`countChip.innerHTML = \`${item.count}<span>...</span>\``)
- **Severity:** LOW (`item.count` is a server-aggregated number, not user-controlled). Still a hygiene fix and prevents future regressions if the field is ever repurposed.
- **Fix:** Use `textContent` for the dynamic part; build the `<span>` via `createElement`.

### S7. No rate limiting on Firestore writes

- **Where:** firestore.rules
- **Impact:** Abuse vector for recipe spam.
- **Fix:** Add custom claims with last-write timestamp, or move sensitive writes through Callable Functions with a per-uid token bucket.

### S8. Avatar storage allows public read with no delete restriction

- **Where:** [storage.rules:28-30](../storage.rules#L28)
- **Fix:** Restrict delete to owner via path-based UID check; consider authenticated-only read.

---

## P4 — Architectural Refactors (Larger Investments)

### R1. Centralized event bus with auto-deregistration

- **Why:** Cross-component communication is currently `document.addEventListener('recipe-updated', ...)` etc. — listeners accumulate, cleanup is manual and inconsistent (see B1).
- **Proposal:** Tiny singleton `events.js` exposing `on(name, handler)` returning an unsubscriber. Pages collect unsubscribers in an array and flush in `unmount()`.
- **Files affected:** New `src/app/core/events.js`; refactor [manager-dashboard-page.js:162](../src/app/pages/manager-dashboard-page.js#L162), [categories-page.js:312](../src/app/pages/categories-page.js#L312), [recipe-detail-page.js:109](../src/app/pages/recipe-detail-page.js#L109), and any other `document.addEventListener` site.

### R2. Base page module with lifecycle scaffolding

- **Why:** Every page repeats the same boilerplate: track auth unsubscriber, track event listeners, track timers. Easy to forget (see B4).
- **Proposal:** A `createPage({ render, mount, unmount })` factory that:
  - Provides `this.disposables.push(fn)` API
  - Auto-flushes disposables on unmount
  - Wraps mount in try/catch and logs to a central error reporter
- **Files affected:** New `src/app/core/page.js`; gradually migrate pages (start with [\_template.js](../src/app/pages/_template.js)).

### R3. State store for shared data (current user, favorites, active meal)

- **Why:** Currently re-fetched per page. Module-local `this.state` doesn't survive navigation.
- **Proposal:** Lightweight pub/sub store in `src/app/core/store.js` with slices: `auth`, `favorites`, `activeMeal`. Subscribers re-render on change.
- **Files affected:** New `src/app/core/store.js`; refactor [auth-controller.js](../src/lib/auth/auth-controller.js), favorites flows, my-meal-page.

### R4. Server-side pagination utility

- **Why:** P2/P3 above both need cursor-based queries. Currently every page reinvents.
- **Proposal:** Add `paginatedQuery(collection, { where, orderBy, pageSize })` to [FirestoreService](../src/js/services/firestore-service.js) returning `{ docs, nextCursor, hasMore }`.

### R5. Storage rules — owner metadata

- **Why:** Currently delete protection is impossible without owner info on the file.
- **Proposal:** When uploading, set custom metadata `uploadedBy: uid`. Update storage.rules to `resource.metadata.uploadedBy == request.auth.uid || isManager()` for delete.

---

## Execution Plan

Recommended order — each is a self-contained session:

| Order | Item                                         | Rough effort         |
| ----- | -------------------------------------------- | -------------------- |
| 1     | S1 (Storage delete)                          | 30 min + tests       |
| 2     | S2 + S3 (SSRF + buffer cap)                  | 1 hr                 |
| 3     | S4 (Pub/Sub validation)                      | 30 min               |
| 4     | B1 + B2 (listener leak + isLoading)          | 30 min               |
| 5     | B3 (AbortController/mountId pattern)         | 1.5 hr               |
| 6     | B4 + B5 (auth/listener audit)                | 1 hr                 |
| 7     | P2 + P3 (server-side pagination)             | 2 hr (depends on R4) |
| 8     | P1 (defer Firebase)                          | 1 hr                 |
| 9     | P4 (responsive images)                       | 1.5 hr               |
| 10    | P6 + P7 (image perf)                         | 1 hr                 |
| 11    | S5 + S6 + S7 + S8 (hardening)                | 1.5 hr               |
| 12    | R1 → R2 → R3 → R4 → R5 (refactors, in order) | spread over weeks    |

---

## Critical Files

- [storage.rules](../storage.rules)
- [firestore.rules](../firestore.rules)
- [functions/index.js](../functions/index.js)
- [src/app.js](../src/app.js)
- [src/app/core/page-manager.js](../src/app/core/page-manager.js)
- [src/app/pages/manager-dashboard-page.js](../src/app/pages/manager-dashboard-page.js)
- [src/app/pages/categories-page.js](../src/app/pages/categories-page.js)
- [src/app/pages/home-page.js](../src/app/pages/home-page.js)
- [src/js/services/firestore-service.js](../src/js/services/firestore-service.js)
- [src/lib/images/image-handler.js](../src/lib/images/image-handler.js)
- [src/lib/recipes/recipe_component/recipe_component.js](../src/lib/recipes/recipe_component/recipe_component.js)

## Verification Strategy

- **Security rules:** Add `@firebase/rules-unit-testing` suite covering each rule change. Run via `firebase emulators:exec`.
- **Cloud Functions:** Test SSRF/buffer fixes against the Functions emulator with crafted payloads.
- **Memory leaks:** In Chrome DevTools → Memory → Allocation timeline, navigate between pages 20× and verify retained-size stays flat.
- **Performance:** Lighthouse before/after for home + categories. Target LCP improvement after P1 + P4.
- **Pagination:** Seed Firestore emulator with 200 recipes, verify category page loads in pages of 20.
- **Regression:** `npm run test`, `npm run lint`, `npm run build`, plus a manual click-through of every route.

---

## Out of Scope

Not covered in this pass — flag for follow-up if needed:

- Accessibility audit
- SEO / meta tags / structured data
- Analytics / observability gaps
- E2E test coverage gaps (Playwright suite exists but not audited here)
