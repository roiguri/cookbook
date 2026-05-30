const { extractRecipeFromVideoParts } = require('./_video-core');

/**
 * Parses a YouTube URL into `{ videoId, normalizedUrl }`. Returns `null` for
 * anything that isn't a recognized YouTube watch / Shorts / youtu.be / embed
 * URL with an 11-char video ID. The frontend has a sibling implementation in
 * `src/js/utils/youtube-url.js` — keep the two in sync.
 *
 * @param {string} input
 * @returns {{ videoId: string, normalizedUrl: string } | null}
 */
function parseYouTubeUrl(input) {
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

/**
 * Extracts recipe data from a YouTube video. The normalized watch URL is handed
 * to Gemini as a `fileData` ref — Gemini fetches and processes the video itself
 * (frames + audio + transcript). The shared video core owns the prompt, schema,
 * and validation.
 *
 * @param {string} url - A YouTube watch / Shorts / youtu.be URL.
 * @returns {Promise<Object>} The extracted recipe data.
 */
async function extractRecipeFromVideo(url) {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) {
    throw new Error('Could not extract: input is not a valid YouTube URL');
  }

  return extractRecipeFromVideoParts({
    fileData: { fileUri: parsed.normalizedUrl, mimeType: 'video/mp4' },
  });
}

module.exports = { extractRecipeFromVideo, parseYouTubeUrl };
