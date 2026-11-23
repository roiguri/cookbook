/**
 * Whether an avatar URL is one saved by the avatar builder (`user-avatars/{uid}.png`, path
 * URL-encoded in download URLs). Built avatars fill their square edge to edge, unlike the old
 * stock SVGs, so they are shown without the stock avatars' zoom. Kept separate from
 * chef-avatar.js so the header doesn't load the artwork library.
 * @param {*} url
 * @returns {boolean}
 */
export const isBuiltAvatarUrl = (url) => typeof url === 'string' && url.includes('user-avatars%2F');
