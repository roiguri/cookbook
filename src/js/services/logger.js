/**
 * Logger Service
 * --------------
 * Thin wrapper around Sentry. All app code imports from here, never from
 * `@sentry/browser` directly — if we swap providers, only this file changes.
 *
 * The Sentry SDK is loaded via dynamic import so it lands in its own chunk
 * instead of the critical-path entry bundle. Calls made before the SDK is
 * ready are queued and flushed once init completes; if init resolves with
 * Sentry inactive (no DSN, or development), the queue is dropped.
 *
 * Activation rules:
 *   - VITE_SENTRY_DSN must be set, AND
 *   - VITE_SENTRY_ENVIRONMENT must not be `development`
 *   When inactive, every export is a safe no-op.
 *
 * Env vars:
 *   VITE_SENTRY_DSN          public DSN, inlined into the bundle
 *   VITE_SENTRY_ENVIRONMENT  `production` | `staging` | `development`
 *   VITE_SENTRY_RELEASE      git SHA / version; defaults to import.meta.env.MODE
 */

let Sentry = null;
let enabled = false;
let initDone = false;
let initPromise = null;
const pendingCalls = [];

function flushPending() {
  const queue = pendingCalls.splice(0);
  if (!enabled) return;
  for (const { fn, args } of queue) {
    try {
      fn(...args);
    } catch {
      // Swallow — a failed capture must not break app flow.
    }
  }
}

/**
 * Initialize Sentry. Idempotent and safe to call when env vars are missing.
 * Returns a promise that resolves once init has either succeeded or decided
 * Sentry should stay inactive. Callers do not need to await it.
 */
export function initLogger() {
  if (initPromise) return initPromise;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE;
  const release = import.meta.env.VITE_SENTRY_RELEASE || undefined;

  if (!dsn || environment === 'development') {
    initDone = true;
    pendingCalls.length = 0;
    initPromise = Promise.resolve();
    return initPromise;
  }

  initPromise = import('@sentry/browser')
    .then((mod) => {
      Sentry = mod;
      Sentry.init({
        dsn,
        environment,
        release,
        sendDefaultPii: false,
        // Performance tracing disabled — events only, to stay within free-tier quota.
        tracesSampleRate: 0,
        // Breadcrumbs we add manually + the SDK's default (clicks, console, fetch, navigation).
        maxBreadcrumbs: 50,
        beforeSend(event, hint) {
          const error = hint?.originalException;

          // Drop noise that isn't actionable.
          if (isIgnorableError(error)) return null;

          // Group Firebase errors by their `code` rather than stack shape — same
          // logical failure should bucket into one issue.
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.name === 'FirebaseError'
          ) {
            event.fingerprint = ['{{ default }}', String(error.code)];
            event.tags = { ...event.tags, firebase_code: String(error.code) };
          }

          return event;
        },
        beforeBreadcrumb(breadcrumb) {
          // Strip console.debug noise; keep error/warn/info.
          if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') return null;
          return breadcrumb;
        },
      });
      enabled = true;
    })
    .catch((err) => {
      console.warn('Sentry SDK failed to load:', err);
    })
    .finally(() => {
      initDone = true;
      flushPending();
    });

  return initPromise;
}

function isIgnorableError(error) {
  if (!error) return false;

  // Sentry SDK gives us either an Error or a thrown non-Error value.
  const message = typeof error === 'string' ? error : error?.message || '';
  const code = error?.code;

  // User-cancelled auth popups — not a bug.
  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/popup-blocked'
  ) {
    return true;
  }

  // Browser quirks that flood the inbox without being real bugs.
  if (message.includes('ResizeObserver loop')) return true;
  if (message === 'Script error.') return true;

  return false;
}

/**
 * Capture a thrown error. `context` is attached as both tags (low-cardinality
 * filter keys) and extra context (visible on the issue page).
 *
 * @param {Error|unknown} error
 * @param {Object} [context]
 * @param {string} [context.service]   firestore | storage | auth | favorites | router | page-manager
 * @param {string} [context.op]        operation name, e.g. getDocument
 * @param {string} [context.page]      current route
 * @param {'fatal'|'error'|'warning'|'info'} [context.level]
 * @param {Object} [context.extra]     non-indexed extra data
 */
export function captureError(error, context = {}) {
  if (!enabled) {
    if (!initDone) pendingCalls.push({ fn: captureError, args: [error, context] });
    return;
  }

  const { service, op, page, level, extra, ...rest } = context;
  Sentry.withScope((scope) => {
    if (level) scope.setLevel(level);
    if (service) scope.setTag('service', service);
    if (op) scope.setTag('op', op);
    if (page) scope.setTag('page', page);
    if (extra) scope.setContext('extra', extra);
    if (Object.keys(rest).length > 0) scope.setContext('details', rest);
    Sentry.captureException(error);
  });
}

/**
 * Capture a message (no thrown error). Use for warnings like 404s where there
 * is no exception to attach.
 *
 * @param {string} message
 * @param {'fatal'|'error'|'warning'|'info'} [level]
 * @param {Object} [context]
 */
export function captureMessage(message, level = 'info', context = {}) {
  if (!enabled) {
    if (!initDone) pendingCalls.push({ fn: captureMessage, args: [message, level, context] });
    return;
  }

  const { service, op, page, extra, ...rest } = context;
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    if (service) scope.setTag('service', service);
    if (op) scope.setTag('op', op);
    if (page) scope.setTag('page', page);
    if (extra) scope.setContext('extra', extra);
    if (Object.keys(rest).length > 0) scope.setContext('details', rest);
    Sentry.captureMessage(message);
  });
}

/**
 * Identify the current user. Pass null on sign-out.
 *
 * @param {{ id: string, role: 'user'|'approved'|'manager'|'anon' }|null} user
 */
export function setUser(user) {
  if (!enabled) {
    if (!initDone) pendingCalls.push({ fn: setUser, args: [user] });
    return;
  }

  if (!user) {
    Sentry.setUser(null);
    Sentry.setTag('role', undefined);
    return;
  }
  Sentry.setUser({ id: user.id });
  if (user.role) Sentry.setTag('role', user.role);
}

/**
 * Add a manual breadcrumb. SDK already captures clicks/fetches/console/navigation.
 *
 * @param {{ category: string, message: string, level?: string, data?: Object }} crumb
 */
export function addBreadcrumb(crumb) {
  if (!enabled) {
    if (!initDone) pendingCalls.push({ fn: addBreadcrumb, args: [crumb] });
    return;
  }
  Sentry.addBreadcrumb(crumb);
}

export default {
  initLogger,
  captureError,
  captureMessage,
  setUser,
  addBreadcrumb,
};
