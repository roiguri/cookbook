const { createClient } = require('../client');

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
  PARAMETER_TAXONOMY,
  enhanceFoodImage,
};
