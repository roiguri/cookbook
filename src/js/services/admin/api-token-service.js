// src/js/services/admin/api-token-service.js

import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '../_firebase/firebase-service.js';

export const API_TOKEN_SCOPES = Object.freeze({ READ: 'read', READ_WRITE: 'read+write' });

const call = async (name, data) => {
  const fn = httpsCallable(getFunctions(getFirebaseApp()), name);
  const { data: result } = await fn(data);
  return result;
};

/**
 * ApiTokenService — personal tokens for the recipe API (managers only)
 *
 * Managers issue tokens to approved family and managers from the dashboard
 * (docs/feature-plans/recipe-api.md, slice 2). Tokens live in `api_tokens`,
 * which no client can read: every operation is a Cloud Function, and only a
 * token's hash is stored. The secret is returned once, by `create`.
 *
 * Public API:
 *   - list()                        // { tokens: [ApiToken], maxPerUser }
 *   - create({ uid, name, scope })  // ApiToken & { token } — the secret, shown once
 *   - revoke(tokenId)               // deletes the token
 *
 * @typedef {Object} ApiToken
 * @property {string} tokenId
 * @property {string} uid - The owner.
 * @property {string} name
 * @property {'read'|'read+write'} scope
 * @property {string} prefix - The token's first characters, to tell tokens apart.
 * @property {string} createdBy - The manager who issued it.
 * @property {number|null} createdAt - Milliseconds.
 * @property {number|null} lastUsedAt - Milliseconds; null if never used.
 */
export class ApiTokenService {
  /** @returns {Promise<{ tokens: ApiToken[], maxPerUser: number }>} */
  static async list() {
    const result = await call('listApiTokens');
    return { tokens: result?.tokens || [], maxPerUser: result?.maxPerUser ?? 0 };
  }

  /**
   * @param {{ uid: string, name: string, scope: 'read'|'read+write' }} params
   * @returns {Promise<ApiToken & { token: string }>}
   */
  static async create({ uid, name, scope }) {
    return call('createApiToken', { uid, name, scope });
  }

  /** @param {string} tokenId */
  static async revoke(tokenId) {
    await call('revokeApiToken', { tokenId });
  }
}
