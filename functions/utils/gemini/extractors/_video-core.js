const { createClient } = require('../client');
const { RECIPE_SCHEMA, validateRecipeData } = require('../recipe-schema');

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
 * Runs Gemini recipe extraction over a prepared video media part and returns
 * the validated recipe data. Platform-agnostic: the caller supplies the media
 * part — a `fileData` ref (e.g. a YouTube `fileUri` Gemini fetches itself) or
 * `inlineData` bytes (e.g. an Instagram/TikTok reel we downloaded). The prompt,
 * model, schema, validation, and error handling are shared across all sources.
 *
 * @param {Object} mediaPart - A Gemini content part: `{ fileData: { fileUri, mimeType } }`
 *   or `{ inlineData: { data, mimeType } }`.
 * @returns {Promise<Object>} The extracted, validated recipe data.
 */
async function extractRecipeFromVideoParts(mediaPart) {
  const client = createClient();

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          parts: [mediaPart, { text: VIDEO_EXTRACTION_PROMPT }],
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

module.exports = { extractRecipeFromVideoParts, VIDEO_EXTRACTION_PROMPT };
