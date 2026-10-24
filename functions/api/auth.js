/**
 * Recipe API — who is calling (docs/feature-plans/recipe-api.md §2, steps 1–3).
 *
 * The bearer token is hashed and looked up in api_tokens (Admin SDK). The owner must
 * still be approved family or a manager, and their Auth account must exist and be
 * enabled — checked BEFORE a login is minted for them, because minting one for a
 * missing uid would silently create an Auth user. (A deletion in the milliseconds
 * between that check and the login could still re-create the account; accepted.)
 * Each request also counts against the token's daily cap and stamps lastUsedAt — an
 * increment of that day's counter (`usage.<YYYY-MM-DD>`), never a reset, so parallel
 * requests neither contend nor overwrite each other; the cap is checked against the
 * count read at lookup, so a burst can overshoot a little.
 *
 * Never log the Authorization header, the token or its hash.
 */
const { hashToken, TOKENS_COLLECTION, TOKEN_ROLES } = require('../utils/api-tokens');
const { unauthorized, forbidden, rateLimited } = require('./errors');

const TOKEN_FORMAT = /^ckb_[A-Za-z0-9_-]{43}$/;
const DAILY_REQUEST_CAP = 1000;

/** The token from `Authorization: Bearer <token>`, or null. */
function bearerToken(header) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(typeof header === 'string' ? header : '');
  return match && TOKEN_FORMAT.test(match[1]) ? match[1] : null;
}

/** UTC day key, e.g. "2026-10-24". */
const dayKey = (date) => date.toISOString().slice(0, 10);

/**
 * The usage update for a request at `now`, or null if the daily cap is reached:
 * increment today's counter and drop earlier days' counters.
 * @param {{ usage?: Record<string, number> }} record - As read at lookup.
 * @param {Date} now
 * @param {{ increment: (n: number) => *, remove: () => * }} ops - FieldValue ops.
 * @returns {Object | null} A Firestore update (dotted field paths).
 */
function usageUpdate(record, now, ops, cap = DAILY_REQUEST_CAP) {
  const today = dayKey(now);
  const usage = record.usage && typeof record.usage === 'object' ? record.usage : {};
  if ((usage[today] || 0) >= cap) return null;
  const update = { [`usage.${today}`]: ops.increment(1) };
  for (const day of Object.keys(usage)) {
    if (day !== today) update[`usage.${day}`] = ops.remove();
  }
  return update;
}

/**
 * Authenticate a request.
 * @param {import('express').Request} req
 * @param {{ db: FirebaseFirestore.Firestore, auth: import('firebase-admin/auth').Auth,
 *   Timestamp: typeof import('firebase-admin/firestore').Timestamp }} deps
 * @returns {Promise<{ tokenId: string, uid: string, scope: string, tokenName: string,
 *   role: string, userName: string|null }>}
 */
async function authenticate(req, { db, auth, Timestamp, FieldValue }) {
  const token = bearerToken(req.get('authorization'));
  if (!token) throw unauthorized();

  const found = await db
    .collection(TOKENS_COLLECTION)
    .where('hash', '==', hashToken(token))
    .limit(1)
    .get();
  if (found.empty) throw unauthorized();
  const tokenRef = found.docs[0].ref;
  const record = found.docs[0].data();
  const { uid, scope, name: tokenName } = record;

  const owner = await db.collection('users').doc(uid).get();
  const role = owner.exists ? owner.get('role') : null;
  if (!TOKEN_ROLES.includes(role)) {
    throw forbidden('The token owner is no longer allowed to use the API.');
  }
  let account;
  try {
    account = await auth.getUser(uid);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') throw unauthorized();
    throw error;
  }
  if (account.disabled) throw unauthorized();

  const usage = usageUpdate(record, new Date(), {
    increment: (n) => FieldValue.increment(n),
    remove: () => FieldValue.delete(),
  });
  if (!usage) {
    throw rateLimited(`This token reached its limit of ${DAILY_REQUEST_CAP} requests today.`);
  }
  try {
    await tokenRef.update({ ...usage, lastUsedAt: Timestamp.now() });
  } catch (error) {
    // Revoked (deleted) since the lookup.
    if (error?.code === 5 || error?.code === 'not-found') throw unauthorized();
    throw error;
  }

  return {
    tokenId: tokenRef.id,
    uid,
    scope,
    tokenName,
    role,
    userName: owner.get('fullName') || owner.get('displayName') || null,
  };
}

module.exports = { authenticate, bearerToken, usageUpdate, DAILY_REQUEST_CAP, TOKEN_FORMAT };
