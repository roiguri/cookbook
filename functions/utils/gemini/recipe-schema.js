// Hebrew units the model should use. Mirrors HEBREW_UNITS in
// src/js/utils/recipes/recipe-ingredients-utils.js — keep the two in sync.
const HEBREW_UNITS = [
  'כוס',
  'כוסות',
  'כף',
  'כפות',
  'כפית',
  'כפיות',
  'מ"ל',
  'ליטר',
  'ליטרים',
  'גרם',
  'ק"ג',
  'יחידה',
  'יחידות',
  'חתיכה',
  'חתיכות',
  'פרוסה',
  'פרוסות',
  'ענף',
  'ענפים',
  'שקית',
  'קופסה',
  'צרור',
  'קורט',
];

const ITEM_DESCRIPTION =
  'The ingredient name in Hebrew. When there is no numeric quantity, keep the ' +
  'qualifier in the name (e.g. "מלח לפי הטעם", "שמן לטיגון").';

const AMOUNT_DESCRIPTION =
  'Quantity as a number: convert fractions/mixed numbers to decimals ' +
  '(½→0.5, ⅓→0.333, 1 ½→1.5). For a range ("2-3") use the lower value. ' +
  'null only when the source gives no quantity at all ("to taste", "for frying").';

const UNIT_DESCRIPTION =
  'Unit of measurement in Hebrew (e.g. כוס, כף, כפית, גרם, מ"ל). null for ' +
  'countable items with no unit ("3 ביצים") and when there is no amount.';

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
      description:
        'Active hands-on preparation time in minutes. Always a positive number: ' +
        'estimate it from the steps when the source does not state it.',
      nullable: false,
    },
    waitTime: {
      type: 'number',
      description:
        'Passive time in minutes (baking, cooking, rising, chilling, marinating), ' +
        'summed across all steps. Estimate it from the steps when not stated; 0 only ' +
        'when the recipe has no passive time.',
      nullable: false,
    },
    servings: {
      type: 'number',
      description: 'Number of servings. Estimate from the quantities when not stated.',
      nullable: false,
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
            description: ITEM_DESCRIPTION,
            nullable: false,
          },
          amount: {
            type: 'number',
            description: AMOUNT_DESCRIPTION,
            nullable: true,
          },
          unit: {
            type: 'string',
            description: UNIT_DESCRIPTION,
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
                item: { type: 'string', description: ITEM_DESCRIPTION, nullable: false },
                amount: { type: 'number', description: AMOUNT_DESCRIPTION, nullable: true },
                unit: { type: 'string', description: UNIT_DESCRIPTION, nullable: true },
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
  required: ['name', 'prepTime', 'waitTime', 'servings'],
};

const DATA_FORMATTING_RULES = `Data Formatting:
- Language: Translate ALL text to Hebrew.
- Ingredients: Split each into item, amount and unit.
  - amount MUST be a number. Convert any fraction or mixed number to a decimal (½ → 0.5, ⅓ → 0.333, 1 ½ → 1.5). For a range ("2-3") use the lower value.
  - unit: a Hebrew measurement unit, preferably one of: ${HEBREW_UNITS.join(', ')}. Use the plural form for amounts above 1 (2 כוסות, 3 כפות). Translate foreign units (cup → כוס, tbsp → כף, tsp → כפית, g → גרם, kg → ק"ג, ml → מ"ל, l → ליטר, pinch → קורט). Never leave the unit empty when the source states one.
  - Countable items with no unit ("3 eggs", "2 onions") get amount and a null unit: { item: "ביצים", amount: 3, unit: null }. Do not write "יחידות" for them.
  - No quantity at all ("salt to taste", "oil for frying"): amount null, unit null, and keep the qualifier in item: { item: "מלח לפי הטעם", amount: null, unit: null }.
- Times (minutes, numbers only — never null):
  - prepTime: active hands-on work (chopping, mixing, shaping). If the source does not state it, estimate it from the steps. Always a positive number.
  - waitTime: passive time (baking, simmering, rising, chilling, marinating). Add up every such duration mentioned in the steps ("bake 40 minutes" + "chill 1 hour" → 100). If the source only gives a total time, split it between prepTime and waitTime. Use 0 only when there is no passive time.
- servings: If not stated, estimate it from the quantities.
- Instructions: Split into logical steps.`;

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

${DATA_FORMATTING_RULES}`;

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

${DATA_FORMATTING_RULES}

IMPORTANT: If you cannot find a valid recipe on the page, return a response with name set to null to indicate failure.`;

function validateRecipeData(data) {
  if (!data) return false;
  if (!data.name || data.name.trim() === '') return false;

  const hasIngredients =
    (data.ingredients && data.ingredients.length > 0) ||
    (data.ingredientSections && data.ingredientSections.length > 0);

  const hasInstructions =
    (data.instructions && data.instructions.length > 0) || (data.stages && data.stages.length > 0);

  return hasIngredients || hasInstructions;
}

module.exports = {
  RECIPE_SCHEMA,
  DATA_FORMATTING_RULES,
  IMAGE_EXTRACTION_PROMPT,
  URL_EXTRACTION_PROMPT,
  validateRecipeData,
};
