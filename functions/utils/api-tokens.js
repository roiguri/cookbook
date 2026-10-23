/**
 * Personal API tokens for the recipe API (docs/feature-plans/recipe-api.md, slice 2).
 *
 * Managers issue tokens to approved family and managers from the dashboard. A token
 * is `ckb_` + 32 random bytes (base64url); only its SHA-256 is stored, in
 * `api_tokens/{tokenId}` (random id, unrelated to the token). Clients never touch
 * the collection — the rules deny it; only Cloud Functions read or write it.
 * Revoking deletes the record. Never log a token or its hash.
 */
const crypto = require('node:crypto');

const TOKENS_COLLECTION = 'api_tokens';
const TOKEN_PREFIX = 'ckb_';
const SCOPES = ['read', 'read+write'];
const TOKEN_ROLES = ['approved', 'manager'];
const MAX_TOKENS_PER_USER = 3;
const NAME_MAX_LENGTH = 60;
// Shown in the dashboard so a person can tell tokens apart: `ckb_` + 4 characters.
const DISPLAY_PREFIX_LENGTH = 8;
// Invisible characters that could reorder or disguise a name: bidi controls, the Arabic
// letter mark, zero-width characters and the BOM.
const BIDI_CONTROLS = /[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** A new token secret. */
function generateToken() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/** The stored form of a token: its SHA-256, hex. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/**
 * Validate `createApiToken` input.
 * @param {*} data - The callable's request data.
 * @returns {{ ok: true, value: { uid: string, name: string, scope: string } }
 *   | { ok: false, message: string }}
 */
function validateCreateInput(data) {
  const { uid, name, scope } = data && typeof data === 'object' ? data : {};
  if (!isDocId(uid)) return { ok: false, message: 'uid must be a user id.' };
  // Bidi control characters could visually reorder the name inside Hebrew text.
  const trimmedName = typeof name === 'string' ? name.replace(BIDI_CONTROLS, '').trim() : '';
  if (!trimmedName) return { ok: false, message: 'name is required.' };
  if (trimmedName.length > NAME_MAX_LENGTH) {
    return { ok: false, message: `name must be at most ${NAME_MAX_LENGTH} characters.` };
  }
  if (!SCOPES.includes(scope)) {
    return { ok: false, message: `scope must be one of: ${SCOPES.join(', ')}.` };
  }
  return { ok: true, value: { uid, name: trimmedName, scope } };
}

/** A Firestore document id we accept from a caller (no paths, bounded length). */
function isDocId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** The new token's stored record. */
function tokenRecord({ token, uid, name, scope, createdBy, createdAt }) {
  return {
    hash: hashToken(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
    uid,
    name,
    scope,
    createdBy,
    createdAt,
    lastUsedAt: null,
  };
}

const millis = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);

/** A token record as managers see it: everything but the hash. */
function toPublicToken(tokenId, record) {
  return {
    tokenId,
    uid: record.uid,
    name: record.name,
    scope: record.scope,
    prefix: record.prefix,
    createdBy: record.createdBy,
    createdAt: millis(record.createdAt),
    lastUsedAt: millis(record.lastUsedAt),
  };
}

module.exports = {
  TOKENS_COLLECTION,
  SCOPES,
  TOKEN_ROLES,
  MAX_TOKENS_PER_USER,
  NAME_MAX_LENGTH,
  generateToken,
  hashToken,
  validateCreateInput,
  isDocId,
  tokenRecord,
  toPublicToken,
};
