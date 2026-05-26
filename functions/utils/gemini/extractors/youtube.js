const { createClient } = require('../client');
const { RECIPE_SCHEMA, validateRecipeData } = require('../recipe-schema');

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

const VIDEO_EXTRACTION_PROMPT = `Extract the complete recipe from this cooking video.

The video may include:
- Spoken narration describing ingredients, quantities, and steps (Hebrew or English).
- On-screen text or graphics listing ingredients, measurements, or step titles.
- Visual demonstration of technique (use it to infer steps that aren't spoken aloud).
- Title/description metadata that may name the dish or list ingredients.

CRITICAL RULES FOR STRUCTURE:
1. SYNTHESIZE ACROSS SOURCES: Combine spoken audio, on-screen text, and visual cues into a single coherent recipe. Prefer on-screen quantities over guesses from visuals.
2. ANALYZE STRUCTURE: Look for named sections (e.g. "For the sauce", "Preparation", "Baking") in either audio or on-screen text.
3. FORCE SECTIONS: If named sections exist for ingredients, use 'ingredientSections' and set 'ingredients' to null.
4. FORCE STAGES: If named sections exist for instructions, use 'stages' and set 'instructions' to null.
5. EXCLUSIVITY: Never populate both flat lists and sections.

REQUIRED METADATA (always populate):
- category: Choose the BEST matching value from the enum based on the dish type.
- difficulty: Assess complexity based on number of ingredients, steps, and techniques.
- mainIngredient: Identify the primary/central ingredient (in Hebrew).

Data Formatting:
- Ingredients: Split into item, amount, unit. amount MUST be a number — convert fractions/mixed to decimals (½ → 0.5, ⅓ → 0.333, 1 ½ → 1.5). Use null when the video gives a range ("2-3"), "to taste", or no clear quantity; keep item/unit.
- Instructions: Split into logical steps; one technique per step.
- Language: Translate ALL text to Hebrew, regardless of the spoken language in the video.

If the video does not contain a recognizable recipe (no ingredients OR no preparation steps), return a response with name set to null.`;

/**
 * Extracts recipe data from a YouTube video using Gemini's fileData input.
 * The model receives the video frames + audio + transcript; we ask for
 * structured JSON output against the shared RECIPE_SCHEMA.
 *
 * @param {string} url - A YouTube watch / Shorts / youtu.be URL.
 * @returns {Promise<Object>} The extracted recipe data.
 */
async function extractRecipeFromVideo(url) {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) {
    throw new Error('Could not extract: input is not a valid YouTube URL');
  }

  const client = createClient();

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          parts: [
            { fileData: { fileUri: parsed.normalizedUrl, mimeType: 'video/mp4' } },
            { text: VIDEO_EXTRACTION_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: RECIPE_SCHEMA,
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Could not extract valid recipe data - empty response from video');
    }

    const data = JSON.parse(responseText);

    if (!validateRecipeData(data)) {
      throw new Error(
        'Could not extract valid recipe data from this video. The video may not contain a recipe, may be private, or may be unavailable.',
      );
    }

    return data;
  } catch (error) {
    console.error('Error calling Gemini API for video:', error);
    if (error.message && error.message.includes('Could not extract')) {
      throw error;
    }
    throw new Error('Failed to extract recipe from video');
  }
}

module.exports = { extractRecipeFromVideo, parseYouTubeUrl };
