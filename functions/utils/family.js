/**
 * The family list for sharing a private recipe (docs/feature-plans/recipe-sharing.md, R3).
 *
 * Only what the picker shows: uid, name and avatar of approved family and
 * managers. Emails, roles and everything else in `users/` stay private.
 */

const FAMILY_ROLES = ['approved', 'manager'];

/**
 * @param {Array<{id: string, data: Object}>} users - User documents.
 * @param {string} callerUid - Left out: nobody shares with themselves.
 * @returns {Array<{uid: string, name: string|null, avatarUrl: string|null}>} By name.
 */
function familyMembers(users, callerUid) {
  return users
    .filter(({ id, data }) => id !== callerUid && FAMILY_ROLES.includes(data && data.role))
    .map(({ id, data }) => ({
      uid: id,
      name: (data.fullName || data.displayName || '').trim() || null,
      avatarUrl: data.avatarUrl || null,
    }))
    .sort((a, b) => {
      if (!a.name || !b.name) return a.name ? -1 : b.name ? 1 : 0;
      return a.name.localeCompare(b.name, 'he');
    });
}

module.exports = { FAMILY_ROLES, familyMembers };
