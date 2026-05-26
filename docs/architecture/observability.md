# Observability — Sentry Error Tracking

How errors from production users surface to us with deobfuscated stack traces, plus the operational details (privacy, quota, environments, aggregation, verification).

## The two halves

Sentry works in two coupled pieces — both must agree on a **release identifier** (the git SHA) for stack traces to be readable.

### 1. Build time — source map upload

Production bundles in `dist/` are minified gibberish. A source map (`.map` file) translates "byte position N in `main-XXXX.js`" back to "line L in `src/app/core/router.js`". Without it, an error in production shows `main-XXXX.js:1:50000` — useless.

Our build pipeline:

1. Vite emits hidden source maps (`sourcemap: 'hidden'` in `vite.config.js`) — generated but with **no `//# sourceMappingURL=` comment** in the bundle, so browsers and crawlers don't auto-discover them.
2. `@sentry/vite-plugin` uploads the maps to Sentry, tagged with the release (`COMMIT_REF` from Netlify or `VITE_SENTRY_RELEASE` if set).
3. The plugin then **deletes the `.map` files from `dist/`** (`filesToDeleteAfterUpload: ['./dist/**/*.map']`), so they're never deployed to users.
4. Sentry now has a private copy keyed by release.

The plugin is a no-op (and sourcemap generation itself is skipped) when any of `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` is missing — local builds and unconfigured deploys are safe.

### 2. Runtime — event collection

`@sentry/browser` is initialized once at app start via `initLogger()` in `src/app.js`, **before** Firebase init so setup errors are captured. The SDK installs:

- Global `window.onerror` and `window.onunhandledrejection` handlers
- A `console.error` wrapper
- An automatic breadcrumb capture for clicks, fetches, console activity, and navigation (capped at 50)

Plus every explicit `captureError(err, { ... })` call in app code sends its event with the supplied tags.

Each event ships with:

- Error message + (minified) stack trace
- `release` tag — the same SHA the source map upload used
- `environment` tag — `production` / `staging` / etc.
- `user` — Firebase UID + a `role` tag (set by `auth-controller.js`)
- Breadcrumb trail of the last 50 events leading up to the error
- Custom tags (`service`, `op`, `page`) and context

Sentry's server receives the event, looks up the source map for the release, deobfuscates the stack, groups identical errors, and surfaces them as an **issue**.

## Release-tag flow (the gotcha)

The plugin reads `process.env.COMMIT_REF` directly (Node-side, fine on Netlify). But `logger.js` reads `import.meta.env.VITE_SENTRY_RELEASE` — Vite only injects `VITE_*`-prefixed env vars from `.env.*` files into `import.meta.env`. `COMMIT_REF` is invisible to the client bundle.

`vite.config.js` bridges this with a `define` block that injects the already-computed `sentryRelease` into the client at build time:

```js
define: {
  'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(sentryRelease || ''),
}
```

Without that bridge: source maps uploaded with `release=<sha>`, client events sent with `release=undefined`, no match, stacks stay obfuscated. Don't remove it.

## Initialization and environment gating

`initLogger()` is a safe no-op unless **both** are true:

- `VITE_SENTRY_DSN` is set
- `VITE_SENTRY_ENVIRONMENT` ≠ `development`

So:

| Where                     | DSN set                                                         | Env value     | Logger active? |
| ------------------------- | --------------------------------------------------------------- | ------------- | -------------- |
| `npm run dev` (local)     | no (only `VITE_SENTRY_ENVIRONMENT=development` in `.env.local`) | `development` | no             |
| `npm run build` (local)   | no                                                              | `development` | no             |
| Netlify production deploy | yes                                                             | `production`  | yes            |
| Netlify staging deploy    | yes                                                             | `staging`     | yes            |

`VITE_SENTRY_ENVIRONMENT` is split per Netlify deploy context (see `netlify env:list`) so events arrive in Sentry already labelled by where they came from.

## The logger API

Every service imports `captureError` from `src/js/services/logger.js`:

```js
import { captureError } from '../logger.js'; // adjust depth

captureError(error, {
  service: 'recipe', // domain tag — one per file
  op: 'create', // method name
  recipeId, // identifiers — searchable on the issue page
  uid,
});
```

Also available:

- `captureMessage(msg, level, ctx)` — warnings without an exception (e.g. 404s)
- `addBreadcrumb({ category, message, data })` — trail markers leading up to an error
- `setUser(user)` — called from `auth-controller.js`; passes `{ id, role }` only

The wrapper applies two transforms automatically:

- **Noise filter** in `beforeSend` — drops `auth/popup-closed-by-user`, `ResizeObserver loop`, `Script error.`. Extend this list when a pattern starts flooding the inbox.
- **Firebase fingerprinting** — `FirebaseError`s are grouped by `error.code` (e.g. `permission-denied`) instead of stack-trace hash, so the same logical failure buckets into one issue across all collections.

## Error aggregation (fingerprinting)

Sentry groups events into **issues** by a fingerprint. By default the fingerprint is a hash of the top stack frame + error message + module path. So:

- Same bug, two users → one issue, count=2, affected_users=2
- Same code throwing from two call sites → two issues
- Identical Firebase errors → one issue per error code (via our `beforeSend` override)

The default usually works. When it doesn't:

- **Issues that should merge but don't** — set a custom fingerprint in `beforeSend` for that error pattern, or merge manually in the Sentry UI
- **Issues that bucket too much** — make the fingerprint more specific (include the op or collection name)

You can also merge / unmerge issues in the UI after the fact.

## Environments

Each event carries an `environment` string. Sentry stores all environments in the same project but the UI separates them:

- The Issues page has an environment selector at the top — defaults to "all", filter to one
- Per-environment alert rules (e.g. only alert on production)
- Per-environment release health
- Compare error rates across envs in the Releases view

Staging and production never visually mix unless you remove the filter. This is why the per-context split on `VITE_SENTRY_ENVIRONMENT` matters — without it, you can't tell which deploy an error came from.

## Privacy

By default the SDK collects more than we want. `logger.js` locks this down:

- `sendDefaultPii: false` — no automatic IP-address, cookie, or query-string collection
- `setUser({ id })` — Firebase UID only. **No** email, displayName, avatar URL
- `setTag('role', ...)` — role string for filterability, set separately from the user identity

When you add `captureError(error, { ...ids })`, the identifiers land in Sentry's "extra" panel — visible on the issue page, not indexed for search.

**Don't put raw user input in captureError context** (search queries, form contents, recipe names, message text). Keep it to IDs and operation names. If you ever need to capture user input for triage, sanitize first.

## Performance impact

What this integration costs:

|                       | Cost                                      | Notes                                                                                                                            |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Bundle size           | +85 KB raw / +29 KB gzipped on `main.js`  | Loaded in the initial bundle (not lazy) so early errors are captured. ~100 ms slower first paint on 3G, negligible on broadband. |
| `Sentry.init()`       | ~5–15 ms at boot                          | One-time, runs before Firebase init                                                                                              |
| `captureError()` call | <1 ms sync + async send                   | JSON serialize + fire-and-forget POST. Doesn't block your code.                                                                  |
| Global handlers       | unmeasurable                              | Event listeners, not interceptors                                                                                                |
| Breadcrumbs           | ~1 KB memory per breadcrumb, capped at 50 |                                                                                                                                  |
| Network               | 0 when no errors                          | ~5–10 KB per event when errors do happen                                                                                         |

When the logger is in no-op mode (local dev), all of this is zero — the SDK isn't initialized.

## Quota and noise

Free tier: **5,000 errors/month**. Each captured event counts.

A single buggy code path in a tight loop can burn the whole month in hours. Mitigations already in place:

- `beforeSend` filter drops known noise patterns
- Firebase errors fingerprinted by `error.code` so they bucket instead of multiplying
- `tracesSampleRate: 0` — no performance events
- The catch rule documented in [services.md](services.md#error-reporting-the-catch-rule) avoids double-capturing the same error across service layers

If a noisy pattern emerges:

1. Look at the top issue in **Sentry → Issues → sort by Events**
2. If it's not actionable (browser extensions, cancelled requests, etc.), add the message pattern or error code to `isIgnorableError` in `logger.js:67`
3. Deploy and confirm the count stops climbing

Quota status: **Sentry → Stats** in the left sidebar. Target < 30% utilization by month-end.

## Verifying source maps aren't exposed publicly

Three layers to check:

### Build output

```bash
find dist -name "*.map" 2>/dev/null
# expected: nothing
```

The vite plugin's `filesToDeleteAfterUpload` removes them post-upload; when no auth token is set, sourcemap generation itself is skipped.

### Deployed assets

```bash
# enumerate chunks the site references
curl -s https://<site-url>/ | grep -oP '/assets/[^"]+\.js' | sort -u > /tmp/chunks.txt

# every .map fetch should 404
while read chunk; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "https://<site-url>${chunk}.map")
  echo "$status ${chunk}.map"
done < /tmp/chunks.txt | grep -v "^404 "
# expected: no output
```

Also confirm the `sourceMappingURL` comment isn't present:

```bash
curl -s https://<site-url>/assets/main-*.js | grep -c "sourceMappingURL"
# expected: 0
```

### Sentry's hosted copy

Sentry stores maps server-side and never serves them publicly — there's no "make public" option. Confirm in **Sentry → Releases → [release] → Artifacts**: artifacts are downloadable only by authenticated org members.

## End-to-end verification after each deploy

When a Netlify deploy lands:

1. **Build log** — search for `[sentry-vite-plugin]`. Should see "Uploaded N source maps". If missing, env vars aren't reaching the build.
2. **Sentry → Releases** — a new release with the deploy's SHA should appear, with artifacts attached.
3. **Trigger a test error** on the deployed site:
   ```js
   throw new Error('sentry-test ' + Date.now());
   ```
   Within ~30 seconds it should appear in **Issues**.
4. **On the issue page**, confirm:
   - Stack trace shows real paths (`src/app/...`), not `main-XXXX.js:1:N`
   - `release` matches the deploy SHA
   - `environment` matches the deploy context
   - If logged in: `user.id` matches your Firebase UID, `role` tag set
5. **Trigger a real-flow error** (e.g. go offline, try to load a page) — confirm `service` and `op` tags show up on the resulting issue.
6. **Cancel a Google login popup mid-flow** — should **not** create an issue (filter working).

## Troubleshooting

| Symptom                                             | Likely cause                                       | Where to check                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Issue appears, stack is `main-XXXX.js:1:N`          | Source map upload failed, or release mismatch      | Sentry → Releases → Artifacts (empty?); Netlify build log for `[sentry-vite-plugin]`                                        |
| No issue after `throw new Error(...)`               | Sentry not initialized                             | DevTools — should see no Sentry errors. Confirm `VITE_SENTRY_DSN` set in Netlify, `VITE_SENTRY_ENVIRONMENT` ≠ `development` |
| Issue has no `release` tag                          | `VITE_SENTRY_RELEASE` injection broken             | Confirm `define:` block in `vite.config.js`                                                                                 |
| Staging events tagged `environment: production`     | Env var not split per context                      | `netlify env:get VITE_SENTRY_ENVIRONMENT --context branch-deploy:staging`                                                   |
| Quota spiking on auth-popup noise                   | Filter not catching                                | Extend `isIgnorableError` in `logger.js:67`                                                                                 |
| Source map visible at `https://<site>/assets/X.map` | Plugin didn't delete it, or sourcemap not `hidden` | Re-check `vite.config.js`: `sourcemap: sentryEnabled ? 'hidden' : false` and `filesToDeleteAfterUpload`                     |
