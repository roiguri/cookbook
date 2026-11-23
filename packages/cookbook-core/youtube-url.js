/**
 * Parses a YouTube URL into `{ videoId, normalizedUrl }`. Returns `null` for
 * anything that isn't a recognized YouTube watch / Shorts / youtu.be / embed
 * URL with an 11-char video ID. The backend has a sibling implementation in
 * `functions/utils/gemini/extractors/youtube.js` — keep the two in sync.
 *
 * @param {string} input
 * @returns {{ videoId: string, normalizedUrl: string } | null}
 */
export function parseYouTubeUrl(input) {
  if (typeof input !== 'string') return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  let videoId = null;

  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com') {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v');
    } else if (url.pathname.startsWith('/shorts/')) {
      videoId = url.pathname.split('/')[2];
    } else if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/v/')) {
      videoId = url.pathname.split('/')[2];
    }
  }

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return { videoId, normalizedUrl: `https://www.youtube.com/watch?v=${videoId}` };
}
