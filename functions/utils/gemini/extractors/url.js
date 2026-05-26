const { createClient } = require('../client');
const { RECIPE_SCHEMA, URL_EXTRACTION_PROMPT, validateRecipeData } = require('../recipe-schema');

/**
 * Extracts recipe data from a URL using Gemini with URL Context tool.
 * Uses a two-step approach since urlContext can't be combined with JSON response schema.
 *
 * @param {string} url - The URL of the recipe webpage.
 * @returns {Promise<Object>} The extracted recipe data.
 */
async function extractRecipeFromUrl(url) {
  const client = createClient();

  const extractionPrompt = `${URL_EXTRACTION_PROMPT}

URL to analyze: ${url}

Return the recipe data as a valid JSON object with this structure:
{
  "name": "recipe name in Hebrew",
  "description": "short description",
  "prepTime": number (minutes),
  "waitTime": number (minutes),
  "servings": number,
  "difficulty": "קלה" | "בינונית" | "קשה",
  "category": "appetizers" | "main-courses" | "side-dishes" | "soups-stews" | "salads" | "desserts" | "breakfast-brunch" | "breads-pastries" | "snacks" | "beverages",
  "mainIngredient": "main ingredient in Hebrew",
  "ingredients": [{"item": "name", "amount": 0.5, "unit": "unit"}] OR null if using sections,
  "ingredientSections": [{"title": "section name", "items": [...]}] OR null if using flat list,
  "instructions": ["step 1", "step 2"] OR null if using stages,
  "stages": [{"title": "stage name", "instructions": [...]}] OR null if using flat list,
  "comments": ["note 1"],
  "tags": ["tag1", "tag2"]
}

IMPORTANT: Return ONLY the JSON object, no markdown formatting or additional text.`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [extractionPrompt],
      config: {
        tools: [{ urlContext: {} }],
      },
    });

    let responseText = response.text;

    if (response.candidates?.[0]?.urlContextMetadata) {
      console.log(
        'URL Context Metadata:',
        JSON.stringify(response.candidates[0].urlContextMetadata),
      );
    }

    responseText = responseText.trim();
    if (responseText.startsWith('```json')) {
      responseText = responseText.slice(7);
    } else if (responseText.startsWith('```')) {
      responseText = responseText.slice(3);
    }
    if (responseText.endsWith('```')) {
      responseText = responseText.slice(0, -3);
    }
    responseText = responseText.trim();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.log('Initial JSON parsing failed, attempting cleanup with structured output...');

      try {
        const cleanupResponse = await client.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            `Convert the following recipe text into a valid JSON object matching the schema.
Extract all recipe information and return ONLY the JSON object.

Recipe text:
${responseText}`,
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: RECIPE_SCHEMA,
          },
        });

        data = JSON.parse(cleanupResponse.text);
        console.log('Successfully parsed recipe using cleanup call');
      } catch (cleanupError) {
        console.error('Failed to parse Gemini response as JSON:', responseText.substring(0, 500));
        console.error('Cleanup call also failed:', cleanupError.message);
        throw new Error('Could not extract valid recipe data - response was not valid JSON');
      }
    }

    if (!validateRecipeData(data)) {
      throw new Error(
        'Could not extract valid recipe data from this URL. The page may require login, use JavaScript rendering, or not contain a recognizable recipe.',
      );
    }

    return data;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    if (error.message.includes('Could not extract')) {
      throw error;
    }
    throw new Error('Failed to extract recipe from URL');
  }
}

module.exports = { extractRecipeFromUrl };
