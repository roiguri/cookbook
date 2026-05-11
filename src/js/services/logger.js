/**
 * Logger Service
 * --------------
 * Thin wrapper around Sentry. All app code imports from here, never from
 * `@sentry/browser` directly — if we swap providers, only this file changes.
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

import * as Sentry from '@sentry/browser';

let enabled = false;

/**
 * Initialize Sentry. Idempotent and safe to call when env vars are missing.
 */
export function initLogger() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE;
  const release = import.meta.env.VITE_SENTRY_RELEASE || undefined;

  if (!dsn) return;
  if (environment === 'development') return;

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
      if (error && typeof error === 'object' && 'code' in error && error.name === 'FirebaseError') {
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
  if (!enabled) return;

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
  if (!enabled) return;

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
  if (!enabled) return;

  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id, segment: user.role });
}

/**
 * Add a manual breadcrumb. SDK already captures clicks/fetches/console/navigation.
 *
 * @param {{ category: string, message: string, level?: string, data?: Object }} crumb
 */
export function addBreadcrumb(crumb) {
  if (!enabled) return;
  Sentry.addBreadcrumb(crumb);
}

export default {
  initLogger,
  captureError,
  captureMessage,
  setUser,
  addBreadcrumb,
};
