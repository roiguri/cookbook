const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');

/**
 * Wraps an onCall handler with auth + role checks. The wrapped handler
 * receives the original onCall `request` plus `{ uid, role }` as a second
 * argument and is responsible for its own try/catch (so it can attach
 * side-effects like failure logging and customize the user-facing error
 * message).
 *
 * Throws HttpsError on unauthenticated / missing-user / role-mismatch.
 *
 * @param {string[]} roles - Allowed roles (e.g. ['approved', 'manager']).
 * @param {(request, ctx: { uid: string, role: string }) => Promise<*>} handler
 * @returns {(request) => Promise<*>}
 */
function withAuthAndRole(roles, handler) {
  return async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { uid } = request.auth;
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not found.');
    }

    const role = userDoc.data().role;
    if (!roles.includes(role)) {
      const expected = roles.length === 1 ? roles[0] : `one of: ${roles.join(', ')}`;
      throw new HttpsError('permission-denied', `User must be ${expected} to use this feature.`);
    }

    return handler(request, { uid, role });
  };
}

module.exports = { withAuthAndRole };
