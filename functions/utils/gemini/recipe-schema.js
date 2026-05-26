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
  IMAGE_EXTRACTION_PROMPT,
  URL_EXTRACTION_PROMPT,
  validateRecipeData,
};
