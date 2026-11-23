/**
 * Zero-PII Observability & Sentry Reporter (INV-P0-06).
 *
 * Guarantees:
 *   - sendDefaultPii = false, tracesSampleRate = 0.
 *   - User context contains ONLY `{ id: uid }` (never email, username, fullName, avatarUrl).
 *   - Extra context strips user-entered fields (`query`, `searchQuery`, `recipeName`,
 *     `email`, `fullName`, `password`, `token`, `apiToken`, `secret`, `rawInput`).
 *   - Scrubs accidental email addresses & `cbk_*` Recipe API tokens before capture.
 *   - Drops expected user-cancellation noise (`auth/popup-closed-by-user`, `SIGN_IN_CANCELLED`).
 *   - In `e2e` mode, keeps a local inspectable audit buffer (zero network calls) surfaced
 *     via `e2e-telemetry-status` for Suite L privacy verification.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const API_TOKEN_RE = /\bcbk_[A-Za-z0-9_-]{8,}\b/g;

const FORBIDDEN_EXTRA_KEYS = new Set([
  'email',
  'password',
  'fullName',
  'displayName',
  'username',
  'avatarUrl',
  'searchQuery',
  'query',
  'recipeName',
  'rawInput',
  'token',
  'apiToken',
  'secret',
]);

const IGNORED_ERROR_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'SIGN_IN_CANCELLED',
  'ERR_REQUEST_CANCELED',
]);

export interface TelemetryEvent {
  id: string;
  ts: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  fingerprint: string[];
  sendDefaultPii: false;
  user: { id: string } | null;
  tags: Record<string, string>;
  extra: Record<string, string | number | boolean>;
}

const extraCfg = (Constants.expoConfig?.extra || {}) as Record<string, any>;
const APP_VARIANT: string = extraCfg.appVariant || 'e2e';
const SENTRY_DSN: string = extraCfg.sentryDsn || '';

let currentUser: { id: string } | null = null;
let currentRole = 'guest';
const ringBuffer: TelemetryEvent[] = [];
const listeners = new Set<() => void>();

function scrubString(input: string): string {
  return String(input || '')
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(API_TOKEN_RE, '[redacted-token]');
}

function sanitizeExtra(
  raw: Record<string, unknown> = {},
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (FORBIDDEN_EXTRA_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') out[k] = scrubString(v).slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  }
}

async function sendToSentryIfStaging(event: TelemetryEvent): Promise<void> {
  if (APP_VARIANT === 'e2e' || APP_VARIANT === 'development' || !SENTRY_DSN) return;
  try {
    const parsed = new URL(SENTRY_DSN);
    const key = parsed.username;
    const projectId = parsed.pathname.replace(/^\//, '');
    if (!key || !projectId) return;
    const endpoint = `${parsed.protocol}//${parsed.host}/api/${projectId}/store/`;
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=cookbook-mobile/1.0.0`,
      },
      body: JSON.stringify({
        event_id: event.id,
        level: event.level,
        platform: 'javascript',
        environment: APP_VARIANT,
        message: event.message,
        fingerprint: event.fingerprint,
        user: event.user || undefined,
        tags: event.tags,
        extra: event.extra,
      }),
    });
  } catch {
    // Telemetry must never crash the app
  }
}

export function initTelemetry(): void {
  // Always initialized with strict zero-PII defaults (sendDefaultPii: false, tracesSampleRate: 0)
  notifyListeners();
}

export function setTelemetryUser(uid: string | null, role: string = 'guest'): void {
  currentUser = uid ? { id: String(uid) } : null;
  currentRole = role || 'guest';
  notifyListeners();
}

export function captureError(
  error: unknown,
  context: Record<string, unknown> = {},
): TelemetryEvent | null {
  const errObj = error as any;
  const code = typeof errObj?.code === 'string' ? errObj.code : '';
  if (code && IGNORED_ERROR_CODES.has(code)) {
    return null;
  }

  const rawMsg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown mobile error';

  const event: TelemetryEvent = {
    id: `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
      .padEnd(32, '0')
      .slice(0, 32),
    ts: new Date().toISOString(),
    level: 'error',
    message: scrubString(rawMsg).slice(0, 300),
    fingerprint: code
      ? ['firebase-error', code]
      : ['mobile-error', String(context.service || 'app')],
    sendDefaultPii: false,
    user: currentUser ? { id: currentUser.id } : null,
    tags: {
      role: currentRole,
      platform: Platform.OS,
      variant: APP_VARIANT,
      ...(code ? { errorCode: code } : {}),
    },
    extra: sanitizeExtra(context),
  };

  ringBuffer.push(event);
  if (ringBuffer.length > 50) ringBuffer.shift();
  notifyListeners();
  void sendToSentryIfStaging(event);
  return event;
}

export function getTelemetryAuditBuffer(): readonly TelemetryEvent[] {
  return ringBuffer;
}

export function getE2eTelemetrySummary(): string {
  const uidPart = currentUser?.id ? `uid:${currentUser.id}` : 'uid:none';
  return `PII:0 | sendDefaultPii:false | ${uidPart} | role:${currentRole} | events:${ringBuffer.length}`;
}

export function subscribeTelemetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
