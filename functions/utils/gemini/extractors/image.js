const { createClient } = require('../client');
const { RECIPE_SCHEMA, IMAGE_EXTRACTION_PROMPT, validateRecipeData } = require('../recipe-schema');

/**
 * Extracts recipe data from images using Gemini.
 *
 * @param {Array} images - Array of {base64, mimeType} objects
 * @returns {Promise<Object>} The extracted recipe data.
 */
async function extractRecipeFromImage(images) {
  const client = createClient();

  const imageParts = images.map((img) => ({
    inlineData: {
      data: img.base64,
      mimeType: img.mimeType || 'image/jpeg',
    },
  }));

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: IMAGE_EXTRACTION_PROMPT }, ...imageParts] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: RECIPE_SCHEMA,
      },
    });

    const responseText = response.text;
    const data = JSON.parse(responseText);

    if (!validateRecipeData(data)) {
      throw new Error('Could not extract valid recipe data from the image(s)');
    }

    return data;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    if (error.message.includes('Could not extract')) {
      throw error;
    }
    throw new Error('Failed to extract recipe from image');
  }
}

module.exports = { extractRecipeFromImage };
