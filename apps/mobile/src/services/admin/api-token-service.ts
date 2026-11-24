import { callCloudFunction } from '../_firebase/functions-adapter';
import { captureError } from '../logger';

export const API_TOKEN_SCOPES = {
  READ: 'read',
  READ_WRITE: 'read+write',
} as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[keyof typeof API_TOKEN_SCOPES];

export const API_TOKEN_MAX_NAME_LENGTH = 60;
export const API_TOKEN_DEFAULT_MAX_PER_USER = 3;
export const API_TOKEN_ELIGIBLE_ROLES = ['approved', 'manager'] as const;

export interface ApiTokenRecord {
  tokenId: string;
  uid: string;
  name: string;
  scope: ApiTokenScope;
  prefix: string;
  createdBy: string;
  createdAt: number | null;
  lastUsedAt: number | null;
}

export interface CreatedApiTokenResult extends ApiTokenRecord {
  /** Plaintext secret returned strictly once. NEVER persist or log (INV-P0-08). */
  token: string;
}

export interface ListApiTokensResult {
  tokens: ApiTokenRecord[];
  maxPerUser: number;
}

export interface CreateApiTokenParams {
  uid: string;
  name: string;
  scope: ApiTokenScope;
}

const VALID_SCOPES = new Set<string>([API_TOKEN_SCOPES.READ, API_TOKEN_SCOPES.READ_WRITE]);

/**
 * Lists all personal Recipe API tokens (metadata only — hashes and secrets are never returned).
 */
export async function listTokens(): Promise<ListApiTokensResult> {
  try {
    const result = await callCloudFunction<Record<string, never>, Partial<ListApiTokensResult>>(
      'listApiTokens',
      {},
    );
    return {
      tokens: Array.isArray(result?.tokens) ? result.tokens : [],
      maxPerUser:
        typeof result?.maxPerUser === 'number' ? result.maxPerUser : API_TOKEN_DEFAULT_MAX_PER_USER,
    };
  } catch (err) {
    captureError(err, { service: 'api-token', op: 'listTokens' });
    throw err;
  }
}

/**
 * Creates a new personal Recipe API token for an eligible (`approved` | `manager`) user.
 *
 * P0 Invariants:
 * - `scope` MUST strictly be `'read'` or `'read+write'` (NEVER `'write'`).
 * - Returned plaintext `token` is NEVER persisted on device or logged to Sentry (INV-P0-08).
 */
export async function createToken({
  uid,
  name,
  scope,
}: CreateApiTokenParams): Promise<CreatedApiTokenResult> {
  const cleanUid = typeof uid === 'string' ? uid.trim() : '';
  const cleanName = typeof name === 'string' ? name.trim() : '';

  if (!cleanUid) {
    throw new Error('ApiTokenService.createToken: uid is required');
  }
  if (!cleanName || cleanName.length > API_TOKEN_MAX_NAME_LENGTH) {
    throw new Error(
      `ApiTokenService.createToken: name must be 1..${API_TOKEN_MAX_NAME_LENGTH} characters`,
    );
  }
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(`ApiTokenService.createToken: invalid scope '${String(scope)}'`);
  }

  try {
    const result = await callCloudFunction<
      { uid: string; name: string; scope: ApiTokenScope },
      CreatedApiTokenResult
    >('createApiToken', {
      uid: cleanUid,
      name: cleanName,
      scope,
    });
    return result;
  } catch (err) {
    // INV-P0-06 & INV-P0-08: log IDs/op only — never user-entered token name or secret
    captureError(err, {
      service: 'api-token',
      op: 'createToken',
      targetUid: cleanUid,
      scope,
    });
    throw err;
  }
}

/**
 * Revokes (immediately deletes) a Recipe API token by ID.
 */
export async function revokeToken(tokenId: string): Promise<void> {
  const cleanId = typeof tokenId === 'string' ? tokenId.trim() : '';
  if (!cleanId) {
    throw new Error('ApiTokenService.revokeToken: tokenId is required');
  }

  try {
    await callCloudFunction<{ tokenId: string }, { revoked: string }>('revokeApiToken', {
      tokenId: cleanId,
    });
  } catch (err) {
    captureError(err, { service: 'api-token', op: 'revokeToken', tokenId: cleanId });
    throw err;
  }
}

export function mapApiTokenErrorToHebrew(error: unknown, fallback: string): string {
  const errObj = error as { code?: string; message?: string } | null;
  const code = String(errObj?.code || '');
  if (code.includes('resource-exhausted')) {
    return 'הגעתם למספר הטוקנים המרבי למשתמש.';
  }
  if (code.includes('failed-precondition')) {
    return 'אפשר להנפיק טוקן רק למשתמשים מאושרים.';
  }
  if (code.includes('invalid-argument')) {
    return 'הפרטים שהוזנו אינם תקינים.';
  }
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return 'אין הרשאה לבצע פעולה זו.';
  }
  return fallback;
}

export const ApiTokenService = {
  listTokens,
  createToken,
  revokeToken,
  list: listTokens,
  create: createToken,
  revoke: revokeToken,
  mapApiTokenErrorToHebrew,
};
