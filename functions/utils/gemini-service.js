const { GoogleGenAI } = require('@google/genai');
const { defineSecret } = require('firebase-functions/params');

// Define secret for API key
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Image generation/editing model (Gemini's "Nano Banana"). Update if a newer
// image-capable model supersedes this.
const IMAGE_ENHANCEMENT_MODEL = 'gemini-3.1-flash-image-preview';

// Single source of truth for the four parameter axes. Each value carries a
// one-line description used to inline directives into the prompt; the keys
// also drive callable validation and `selectedParameters` parsing.
const PARAMETER_TAXONOMY = {
  lighting: {
    natural: 'Natural — soft, directional window light with subtle, organic shadows.',
    commercial: 'Commercial — bright, even studio softbox lighting for maximum clarity and pop.',
    moody:
      'Moody — high-contrast, dramatic side-lighting with deep shadows for a fine-dining aesthetic.',
    'golden-hour': 'Golden Hour — warm, low-angle sunset tones with long, soft shadows.',
    backlit:
      'Backlit — strong rim light from behind the dish, emphasizing translucency and silhouette.',
  },
  angle: {
    'flat-lay': 'Flat Lay — 90-degree directly overhead, best for bowls and spreads.',
    hero: 'Hero — 45-degree angle to show depth and texture.',
    portrait: 'Portrait — low-angle, eye-level to emphasize height and layers.',
    macro: 'Macro — extreme close-up emphasizing texture and surface detail.',
    'side-profile':
      'Side Profile — straight-on side view, ideal for layered dishes or cross-sections.',
  },
  surface: {
    marble: 'Marble — polished white marble with subtle gray veining.',
    wood: 'Wood — dark, weathered oak wood with visible grain.',
    concrete: 'Concrete — neutral, matte-finish light gray concrete.',
    linen: 'Linen — textured natural-fiber fabric in a warm off-white tone.',
    slate: 'Slate — dark, matte stone surface with subtle natural variation.',
  },
  styling: {
    clean: 'Clean — no props; focus entirely on the dish and the surface.',
    editorial: 'Editorial — a neatly folded linen napkin and one high-end utensil.',
    'ingredient-led':
      'Ingredient-Led — scatter a few raw ingredients (a sprig of herb, a slice of fruit) near the dish.',
    'rustic-spread':
      'Rustic Spread — multiple smaller bowls or elements arranged around the dish for an abundant, lived-in look.',
    'gourmet-plated':
      'Gourmet Plated — fine-dining minimalism with deliberate negative space and a single decorative accent.',
  },
};

const AXIS_LABELS = {
  lighting: 'Lighting',
  angle: 'Camera Angle',
  surface: 'Surface & Texture',
  styling: 'Styling',
};

/**
 * Builds the food-stylist prompt with all four parameters already resolved.
 *
 * Authenticity is the load-bearing constraint: the prompt opens AND closes
 * with an inviolable instruction to preserve the dish exactly as shown.
 * Parameters and free-text only affect the scene around the dish.
 *
 * Parameters are expected to be pre-resolved (typically by
 * `selectParametersForDish`). If an axis is missing the prompt falls back to
 * a chooser line, which the image-gen model handles internally.
 *
 * @param {{ parameters?: Object, instruction?: string }} input
 * @returns {string} The full prompt text.
 */
function buildFoodStylistPrompt({ parameters = {}, instruction = '' } = {}) {
  const paramLines = Object.keys(PARAMETER_TAXONOMY).map((axis) => {
    const value = parameters[axis];
    if (value && PARAMETER_TAXONOMY[axis][value]) {
      return `${AXIS_LABELS[axis]}: ${PARAMETER_TAXONOMY[axis][value]}`;
    }
    const options = Object.keys(PARAMETER_TAXONOMY[axis]).join(' | ');
    return `${AXIS_LABELS[axis]}: STUDY the dish and CHOOSE one of: ${options}. Pick the option that best fits this dish's character.`;
  });

  const instructionBlock = instruction
    ? `\n\nAdditional user notes (apply ONLY to the scene/styling around the dish — never modify the food itself):\n- ${instruction}`
    : '';

  return `You are a professional food photographer RE-PHOTOGRAPHING an existing dish in a more professional studio environment. You are NOT redesigning the dish, replating it, or reimagining it — you are placing the SAME dish into a better scene.

INVIOLABLE CONSTRAINT — preserve the dish exactly:
- Keep the SAME food items, ingredients, colors, textures, garnish, sauce, portion, and arrangement.
- Do NOT add, remove, substitute, or restyle any food element.
- Do NOT change cooking doneness, plating, or stylistic interpretation of the dish.
- Treat the dish as photographic ground truth. Only the SCENE around it (background, lighting, surface, props) may change.
- If you cannot satisfy a parameter or user note without altering the dish, IGNORE that parameter/note and preserve the dish.

Execution protocol:
1. Identify the core dish. Lock its visual identity in memory before any transformation.
2. Replace ONLY the surrounding environment — background, lighting, surface texture, and decorative props — using the parameters below.
3. Frame the dish in a SQUARE 1:1 aspect ratio. Center it; leave even padding (negative space) on all four sides so it reads cleanly when cropped to a square thumbnail.

Scene parameters (apply to the environment around the dish, NEVER to the dish itself):
${paramLines.map((l) => `- ${l}`).join('\n')}

Technical Output Specification:
- Aspect Ratio: MUST be exactly 1:1 (square). Both image dimensions must be equal. Do not output landscape or portrait crops.
- Resolution: Ultra-high definition, 8k photographic detail.
- Focus: Sharp focus on the dish with a professional shallow depth of field (bokeh) toward the edges of the frame.
- Authenticity: The food must look identical to the input — only the photographic environment changes. Avoid 'plastic' or overly-perfect AI artifacts on the food.${instructionBlock}

Final reminder before generating:
The dish in your output MUST be recognizable as the SAME dish from the input image — same ingredients, same portion, same arrangement. If any instruction above conflicts with that, the dish wins.

Return ONLY the enhanced image.`;
}

// JSON schema for the parameter-selection text-model call.
const PARAMETER_SELECTION_SCHEMA = {
  type: 'object',
  properties: {
    lighting: { type: 'string', enum: Object.keys(PARAMETER_TAXONOMY.lighting) },
    angle: { type: 'string', enum: Object.keys(PARAMETER_TAXONOMY.angle) },
    surface: { type: 'string', enum: Object.keys(PARAMETER_TAXONOMY.surface) },
    styling: { type: 'string', enum: Object.keys(PARAMETER_TAXONOMY.styling) },
  },
  required: ['lighting', 'angle', 'surface', 'styling'],
};

/**
 * Uses a text-capable model with structured-JSON output to pick the most
 * fitting parameters for the input dish image. This is a separate call
 * because `gemini-3.1-flash-image-preview` is image-only — it cannot reliably
 * co-emit a parameter manifest alongside the generated image.
 *
 * @param {{ base64: string, mimeType?: string }} image
 * @returns {Promise<{ lighting: string, angle: string, surface: string, styling: string }>}
 */
async function selectParametersForDish(image) {
  const client = createClient();
  const optionList = (axis) => Object.keys(PARAMETER_TAXONOMY[axis]).join(' | ');

  const prompt = `You are a food photography art director. Look at the input food image and pick the BEST creative parameters to elevate it in a professional studio shoot. Consider the dish's character — cuisine, mood, structure, and colors — and pick parameters that complement it.

For each axis, choose exactly one value from the allowed set:
- lighting: ${optionList('lighting')}
- angle: ${optionList('angle')}
- surface: ${optionList('surface')}
- styling: ${optionList('styling')}

Return ONLY the JSON object matching the schema.`;

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: image.base64,
              mimeType: image.mimeType || 'image/jpeg',
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: PARAMETER_SELECTION_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Parameter selection returned empty response');
  }
  const parsed = JSON.parse(text);
  return parsed;
}

const RECIPE_SCHEMA = {
  description: 'Recipe data extraction schema',
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'The name of the recipe',
      nullable: false,
    },
    description: {
      type: 'string',
      description: 'A short description of the recipe',
      nullable: true,
    },
    prepTime: {
      type: 'number',
      description: 'Preparation time in minutes',
      nullable: true,
    },
    waitTime: {
      type: 'number',
      description: 'Wait/Cooking time in minutes',
      nullable: true,
    },
    servings: {
      type: 'number',
      description: 'Number of servings',
      nullable: true,
    },
    difficulty: {
      type: 'string',
      description:
        'Difficulty level in Hebrew. Infer from recipe complexity if not explicitly stated: קלה (few ingredients, simple techniques), בינונית (moderate effort), קשה (many steps, advanced techniques)',
      enum: ['קלה', 'בינונית', 'קשה'],
      nullable: false,
    },
    category: {
      type: 'string',
      description:
        'Recipe category ID. MUST be one of the allowed values. Infer based on recipe type if not explicitly stated.',
      enum: [
        'appetizers',
        'main-courses',
        'side-dishes',
        'soups-stews',
        'salads',
        'desserts',
        'breakfast-brunch',
        'breads-pastries',
        'snacks',
        'beverages',
      ],
      nullable: false,
    },
    mainIngredient: {
      type: 'string',
      description:
        'The primary/main ingredient of the recipe (e.g., chicken, pasta, chocolate). Infer from the most prominent ingredient if not stated.',
      nullable: true,
    },
    ingredients: {
      type: 'array',
      description: 'List of ingredients (Flat list). Use ONLY if there are no sections.',
      items: {
        type: 'object',
        properties: {
          item: {
            type: 'string',
            description: 'The ingredient name',
            nullable: false,
          },
          amount: {
            type: 'number',
            description:
              'Quantity as a number: convert fractions/mixed numbers to decimals ' +
              '(½→0.5, ⅓→0.333, 1 ½→1.5). Use null when there is no clear single ' +
              'numeric quantity (e.g. a range like 2-3, or "to taste").',
            nullable: true,
          },
          unit: {
            type: 'string',
            description: 'The unit of measurement (e.g. "cups", "g", "tbsp")',
            nullable: true,
          },
        },
        required: ['item'],
      },
      nullable: true,
    },
    ingredientSections: {
      type: 'array',
      description:
        'List of ingredient sections (e.g. for "Cake", "Frosting"). Use ONLY if there are sections.',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Section title',
            nullable: false,
          },
          items: {
            type: 'array',
            description: 'Ingredients in this section',
            items: {
              type: 'object',
              properties: {
                item: { type: 'string', nullable: false },
                amount: {
                  type: 'number',
                  nullable: true,
                  description:
                    'Quantity as a number: fractions/mixed → decimals ' +
                    '(½→0.5, ⅓→0.333, 1 ½→1.5). null for ranges or "to taste".',
                },
                unit: { type: 'string', nullable: true },
              },
              required: ['item'],
            },
          },
        },
        required: ['title', 'items'],
      },
      nullable: true,
    },
    instructions: {
      type: 'array',
      description: 'List of instruction steps (Flat list). Use ONLY if there are no stages.',
      items: {
        type: 'string',
        description: 'A single instruction step',
      },
      nullable: true,
    },
    stages: {
      type: 'array',
      description:
        'List of preparation stages. Use ONLY if the instructions are divided into named stages.',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Stage title',
            nullable: false,
          },
          instructions: {
            type: 'array',
            description: 'List of instructions for this stage',
            items: { type: 'string' },
          },
        },
        required: ['title', 'instructions'],
      },
      nullable: true,
    },
    comments: {
      type: 'array',
      description: 'Chef notes or comments',
      items: {
        type: 'string',
      },
      nullable: true,
    },
    tags: {
      type: 'array',
      description: 'Tags for the recipe',
      items: {
        type: 'string',
      },
      nullable: true,
    },
  },
  required: ['name'],
};

const IMAGE_EXTRACTION_PROMPT = `Extract the complete recipe details from the provided image(s). 
  
CRITICAL RULES FOR STRUCTURE:
1. COMBINE INFORMATION: The images may be pages of the same recipe or different parts. Combine all information into a single recipe.
2. ANALYZE STRUCTURE FIRST: Look specifically for titled sections (e.g., "For the Dough", "For the Sauce", "Preparation", "Baking").
3. FORCE SECTIONS: If ANY titled sections are present in the image for ingredients, you MUST use 'ingredientSections' and set 'ingredients' to null.
4. FORCE STAGES: If ANY titled sections are present for instructions, you MUST use 'stages' and set 'instructions' to null.
5. EXCLUSIVITY: Never populate both flat lists and sections.

REQUIRED METADATA (always populate these based on recipe content):
- category: Choose the BEST matching category from the allowed enum values based on recipe type
- difficulty: Assess complexity based on number of ingredients, steps, and techniques required
- mainIngredient: Identify the primary/central ingredient (in Hebrew)

Data Formatting:
- Ingredients: Split into item, amount, and unit. amount MUST be a number — convert any fraction or mixed number to a decimal (½ → 0.5, ⅓ → 0.333, 1 ½ → 1.5). Use null (not a string) when there is no single clear numeric quantity, e.g. a range ("2-3") or "to taste"; keep item/unit.
- Instructions: Split into logical steps.
- Language: Translate ALL text to Hebrew.`;

const URL_EXTRACTION_PROMPT = `Extract the complete recipe details from the webpage at the provided URL.

CRITICAL RULES FOR STRUCTURE:
1. ANALYZE STRUCTURE FIRST: Look specifically for titled sections (e.g., "For the Dough", "For the Sauce", "Preparation", "Baking").
2. FORCE SECTIONS: If ANY titled sections are present for ingredients, you MUST use 'ingredientSections' and set 'ingredients' to null.
3. FORCE STAGES: If ANY titled sections are present for instructions, you MUST use 'stages' and set 'instructions' to null.
4. EXCLUSIVITY: Never populate both flat lists and sections.

REQUIRED METADATA (always populate these based on recipe content):
- category: Choose the BEST matching category from the allowed enum values based on recipe type
- difficulty: Assess complexity based on number of ingredients, steps, and techniques required
- mainIngredient: Identify the primary/central ingredient (in Hebrew)

Data Formatting:
- Ingredients: Split into item, amount, and unit. amount MUST be a number — convert any fraction or mixed number to a decimal (½ → 0.5, ⅓ → 0.333, 1 ½ → 1.5). Use null (not a string) when there is no single clear numeric quantity, e.g. a range ("2-3") or "to taste"; keep item/unit.
- Instructions: Split into logical steps.
- Language: Translate ALL text to Hebrew.

IMPORTANT: If you cannot find a valid recipe on the page, return a response with name set to null to indicate failure.`;

/**
 * Creates a configured Gemini client
 */
function createClient() {
  if (!geminiApiKey.value()) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  return new GoogleGenAI({ apiKey: geminiApiKey.value() });
}

/**
 * Validates extracted recipe data
 * @param {Object} data - The extracted recipe data
 * @returns {boolean} - Whether the data is valid
 */
function validateRecipeData(data) {
  if (!data) return false;
  if (!data.name || data.name.trim() === '') return false;

  // Check for at least some ingredients or instructions
  const hasIngredients =
    (data.ingredients && data.ingredients.length > 0) ||
    (data.ingredientSections && data.ingredientSections.length > 0);

  const hasInstructions =
    (data.instructions && data.instructions.length > 0) || (data.stages && data.stages.length > 0);

  return hasIngredients || hasInstructions;
}

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

/**
 * Extracts recipe data from a URL using Gemini with URL Context tool.
 * Uses a two-step approach since urlContext can't be combined with JSON response schema.
 *
 * @param {string} url - The URL of the recipe webpage.
 * @returns {Promise<Object>} The extracted recipe data.
 */
async function extractRecipeFromUrl(url) {
  const client = createClient();

  // Step 1: Fetch and extract recipe using URL Context (returns text)
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

    // Log URL context metadata for debugging
    if (response.candidates?.[0]?.urlContextMetadata) {
      console.log(
        'URL Context Metadata:',
        JSON.stringify(response.candidates[0].urlContextMetadata),
      );
    }

    // Clean up response - remove markdown code blocks if present
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

      // Fallback: Use another Gemini call with JSON response type to clean up
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

/**
 * Enhances a food image using Gemini's image generation model with the
 * "Professional Food Stylist" system prompt.
 *
 * Defaults to letting the model pick all four parameters; any axis the caller
 * pre-fills is honored as an override.
 *
 * @param {Object} input
 * @param {{base64: string, mimeType?: string}} input.image - Original image.
 * @param {{lighting?: string, angle?: string, surface?: string, styling?: string}} [input.parameters] - Optional axis overrides; unset axes are chosen by the model.
 * @param {string} [input.instruction] - Free-text user note (Hebrew or English).
 * @returns {Promise<{base64: string, mimeType: string, selectedParameters: Object}>}
 */
async function enhanceFoodImage({ image, parameters = {}, instruction } = {}) {
  if (!image || !image.base64) {
    throw new Error('Input image is required');
  }

  // Two-call architecture: image-gen models can't reliably co-emit parameter
  // text, so we ask a text model to pick parameters first, then pass the
  // fully-resolved set to the image-gen call. User overrides win.
  const userPicked = { ...parameters };
  const needsAutoSelect = Object.keys(PARAMETER_TAXONOMY).some((a) => !userPicked[a]);

  let aiPicked = {};
  if (needsAutoSelect) {
    try {
      aiPicked = await selectParametersForDish(image);
    } catch (err) {
      console.warn(
        'enhanceFoodImage: parameter pre-selection failed, falling back to in-prompt chooser:',
        err.message,
      );
    }
  }

  const resolved = {};
  for (const axis of Object.keys(PARAMETER_TAXONOMY)) {
    resolved[axis] = userPicked[axis] || aiPicked[axis] || null;
  }

  const client = createClient();
  const inputMimeType = image.mimeType || 'image/jpeg';
  const promptText = buildFoodStylistPrompt({ parameters: resolved, instruction });

  const parts = [
    { text: promptText },
    { inlineData: { data: image.base64, mimeType: inputMimeType } },
  ];

  const response = await client.models.generateContent({
    model: IMAGE_ENHANCEMENT_MODEL,
    contents: [{ parts }],
  });

  const responseParts = response?.candidates?.[0]?.content?.parts || [];
  const imagePart = responseParts.find((p) => p.inlineData && p.inlineData.data);

  if (!imagePart) {
    const textPart = responseParts.find((p) => typeof p.text === 'string' && p.text.length > 0);
    const detail = textPart ? `: ${textPart.text.slice(0, 200)}` : '';
    throw new Error(`Gemini did not return an enhanced image${detail}`);
  }

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/png',
    selectedParameters: resolved,
  };
}

module.exports = {
  extractRecipeFromImage,
  extractRecipeFromUrl,
  enhanceFoodImage,
  PARAMETER_TAXONOMY,
};
