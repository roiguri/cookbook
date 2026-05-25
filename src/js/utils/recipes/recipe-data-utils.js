/*
 * Recipe Data Utilities
 * --------------------
 * Pure helpers for recipe data formatting and validation. No I/O.
 *
 * Exported Methods:
 *
 *   - formatRecipeData(rawData):
 *       Format raw Firestore recipe data for display/use in the app.
 *   - validateRecipeData(recipeData):
 *       Validate a recipe object before saving to Firestore.
 *   - calculateTotalTime(prepTime, waitTime):
 *       Calculate total recipe time from prep and wait times.
 *   - formatCookingTime(minutes):
 *       Format a time in minutes into a readable string.
 *   - getTimeClass(totalMinutes):
 *       Get a CSS class for quick/medium/long recipes by time.
 *   - getDifficultyClass(difficulty):
 *       Map difficulty to a CSS class.
 *   - getLocalizedCategoryName(categoryId):
 *       Get a localized display name for a category.
 *   - getCategoryIcon(category):
 *       Get an icon for a category.
 *   - extractIngredientNamesFromSections(ingredientSections):
 *       Extract ingredient names from sectioned ingredient format.
 *
 * Firestore reads moved out: callers fetch via RecipeService.{get,list} and
 * pipe through formatRecipeData(...) if they want the normalized shape.
 */

import { parseAmount } from './recipe-ingredients-utils.js';

/**
 * @typedef {Object} Ingredient
 * @property {number|null} amount - Canonical numeric quantity; `null` when unknown.
 * @property {string} unit - Unit of measurement (e.g., "cup", "tbsp", "kg", "" for unitless)
 * @property {string} item - Name of the ingredient (e.g., "flour", "salt", "chicken")
 */

/**
 * @typedef {Object} IngredientSection
 * @property {string} title - Section heading (e.g., "מצרכים יבשים", "Dry Ingredients")
 * @property {Array<Ingredient>} items - Array of ingredients in this section
 */

/**
 * @typedef {Object} Recipe
 * @property {string} [id]
 * @property {string} name
 * @property {string} category
 * @property {number} prepTime
 * @property {number} waitTime
 * @property {string} difficulty
 * @property {string} mainIngredient
 * @property {string[]} tags
 * @property {number} servings
 * @property {Array<Ingredient>} [ingredients] - Flat ingredients list (mutually exclusive with ingredientSections)
 * @property {Array<IngredientSection>} [ingredientSections] - Sectioned ingredients (mutually exclusive with ingredients)
 * @property {Array<{ title: string, instructions: string[] }>} [stages]
 * @property {string[]} [instructions]
 * @property {Array<{ file: string, isPrimary: boolean, access: string, uploadedBy: string }>} [images]
 * @property {string[]} [comments]
 * @property {boolean} [approved]
 * @property {Date|string|number} [creationTime]
 * @property {Date|string|number} [updatedAt]
 * @property {string[]} [relatedRecipes] - IDs of complementary recipes
 */

// Category mapping and icons - Single source of truth for all category data
export const CATEGORY_MAP = {
  appetizers: 'מנות ראשונות',
  'main-courses': 'מנות עיקריות',
  'side-dishes': 'תוספות',
  'soups-stews': 'מרקים ותבשילים',
  salads: 'סלטים',
  desserts: 'קינוחים',
  'breakfast-brunch': 'ארוחות בוקר',
  'breads-pastries': 'לחמים ומאפים',
  snacks: 'חטיפים',
  beverages: 'משקאות',
};

export const CATEGORY_ICONS = {
  appetizers: '🥗',
  'main-courses': '🍖',
  'side-dishes': '🥔',
  'soups-stews': '🥘',
  salads: '🥬',
  desserts: '🍰',
  'breakfast-brunch': '🍳',
  'breads-pastries': '🥖',
  snacks: '🥨',
  beverages: '🥤',
  else: '🍽️',
};

/**
 * Sanitizes ingredient sections data for safe storage and display
 * @param {Array} rawSections - Raw ingredient sections from input
 * @returns {Array<IngredientSection>} Sanitized ingredient sections
 */
function sanitizeIngredientSections(rawSections) {
  if (!Array.isArray(rawSections)) return [];

  return rawSections
    .filter((section) => section && typeof section === 'object' && section.title && section.items)
    .map((section) => ({
      title: String(section.title).trim(),
      items: Array.isArray(section.items)
        ? section.items
            .filter((item) => item && typeof item === 'object' && item.item && item.item.trim())
            .map((item) => ({
              amount: parseAmount(item.amount),
              unit: String(item.unit || '').trim(),
              item: String(item.item || '').trim(),
            }))
        : [],
    }))
    .filter((section) => section.items.length > 0); // Remove sections with no valid items
}

/**
 * Extracts all ingredient names from ingredient sections
 * @param {Array<IngredientSection>} ingredientSections - Ingredient sections array
 * @returns {Array<string>} Array of ingredient names
 */
export function extractIngredientNamesFromSections(ingredientSections) {
  if (!Array.isArray(ingredientSections)) return [];

  return ingredientSections
    .flatMap((section) => section.items || [])
    .map((item) => item.item)
    .filter((name) => name && typeof name === 'string' && name.trim())
    .map((name) => name.trim());
}

/**
 * Formats raw recipe data from Firestore for display
 * @param {Object} rawData - Raw recipe data from Firestore
 * @returns {Recipe} Formatted recipe data ready for display
 */
export function formatRecipeData(rawData) {
  if (!rawData || typeof rawData !== 'object') return null;

  // Handle dual-format ingredients: prioritize ingredientSections if present
  const hasIngredientSections =
    Array.isArray(rawData.ingredientSections) && rawData.ingredientSections.length > 0;
  const hasIngredients = Array.isArray(rawData.ingredients) && rawData.ingredients.length > 0;

  return {
    id: rawData.id || '',
    name: rawData.name || '',
    category: rawData.category || '',
    prepTime: typeof rawData.prepTime === 'number' ? rawData.prepTime : 0,
    waitTime: typeof rawData.waitTime === 'number' ? rawData.waitTime : 0,
    difficulty: rawData.difficulty || '',
    mainIngredient: rawData.mainIngredient || '',
    description: rawData.description || '',
    attribution: rawData.attribution || '',
    tags: Array.isArray(rawData.tags) ? rawData.tags : [],
    servings: typeof rawData.servings === 'number' ? rawData.servings : 1,

    // Dual-format ingredients handling
    ingredients: hasIngredientSections ? undefined : hasIngredients ? rawData.ingredients : [],
    ingredientSections: hasIngredientSections
      ? sanitizeIngredientSections(rawData.ingredientSections)
      : undefined,

    stages: Array.isArray(rawData.stages) ? rawData.stages : undefined,
    instructions: Array.isArray(rawData.instructions) ? rawData.instructions : undefined,
    images: Array.isArray(rawData.images) ? rawData.images : [],
    mediaInstructions: Array.isArray(rawData.mediaInstructions) ? rawData.mediaInstructions : [],
    comments: Array.isArray(rawData.comments) ? rawData.comments : [],
    approved: typeof rawData.approved === 'boolean' ? rawData.approved : false,
    creationTime: rawData.creationTime || null,
    updatedAt: rawData.updatedAt || null,
    relatedRecipes: Array.isArray(rawData.relatedRecipes) ? rawData.relatedRecipes : [],
  };
}

/**
 * Validates recipe data before saving to Firestore
 * @param {Object} recipeData - Recipe data to validate
 * @returns {Object} Validation result with isValid flag and error messages
 */
export function validateRecipeData(recipeData) {
  const errors = {};
  if (!recipeData || typeof recipeData !== 'object') {
    return { isValid: false, errors: { general: 'Invalid recipe data object.' } };
  }

  // Name
  if (!recipeData.name || typeof recipeData.name !== 'string' || !recipeData.name.trim()) {
    errors.name = 'חובה למלא את שם המתכון.';
  }

  // Category
  const validCategories = Object.keys(CATEGORY_MAP);
  if (!recipeData.category || !validCategories.includes(recipeData.category)) {
    errors.category = 'חובה למלא את קטגוריית המתכון.';
  }

  // Prep Time
  if (typeof recipeData.prepTime !== 'number' || recipeData.prepTime < 0) {
    errors.prepTime = 'חובה למלא את זמן ההכנה.';
  }

  // Wait Time
  if (typeof recipeData.waitTime !== 'number' || recipeData.waitTime < 0) {
    errors.waitTime = 'חובה למלא את זמן ההמתנה.';
  }

  // Difficulty
  if (
    !recipeData.difficulty ||
    typeof recipeData.difficulty !== 'string' ||
    !recipeData.difficulty.trim()
  ) {
    errors.difficulty = 'חובה למלא את רמת הקושי.';
  }

  // Main Ingredient (optional)
  if (recipeData.mainIngredient && typeof recipeData.mainIngredient !== 'string') {
    errors.mainIngredient = 'המרכיב העיקרי חייב להיות טקסט.';
  }

  // Servings
  if (
    typeof recipeData.servings !== 'number' ||
    !Number.isInteger(recipeData.servings) ||
    recipeData.servings < 1
  ) {
    errors.servings = 'מספר המנות חייב להיות מספר שלם וחיובי.';
  }

  // Ingredients vs IngredientSections (mutual exclusivity)
  const hasIngredients = Array.isArray(recipeData.ingredients) && recipeData.ingredients.length > 0;
  const hasIngredientSections =
    Array.isArray(recipeData.ingredientSections) && recipeData.ingredientSections.length > 0;

  if (hasIngredients && hasIngredientSections) {
    errors.ingredients = 'לא ניתן להציג שני סוגי של מרכיבים.';
    errors.ingredientSections = 'לא ניתן להציג שני סוגי של מרכיבים.';
  } else if (!hasIngredients && !hasIngredientSections) {
    errors.ingredientsRequired = true;
  }

  // Instructions validation is now handled by component-level validation
  // This data validation only ensures data type consistency if data exists

  // Optional fields type validation
  if ('tags' in recipeData && recipeData.tags !== undefined) {
    if (
      !Array.isArray(recipeData.tags) ||
      !recipeData.tags.every((tag) => typeof tag === 'string')
    ) {
      errors.tags = 'פורמט שגוי עבור התגיות.';
    }
  }
  if ('images' in recipeData && recipeData.images !== undefined) {
    if (
      !Array.isArray(recipeData.images) ||
      !recipeData.images.every((img) => typeof img === 'object' && img !== null)
    ) {
      errors.images = 'פורמט שגוי עבור התמונות.';
    }
  }
  if ('comments' in recipeData && recipeData.comments !== undefined) {
    if (
      !Array.isArray(recipeData.comments) ||
      !recipeData.comments.every((c) => typeof c === 'string')
    ) {
      errors.comments = 'פורמט שגוי עבור ההערות.';
    }
  }
  if ('approved' in recipeData && recipeData.approved !== undefined) {
    if (typeof recipeData.approved !== 'boolean') {
      errors.approved = 'פורמט שגוי עבור האישור.';
    }
  }
  if (
    'creationTime' in recipeData &&
    recipeData.creationTime !== undefined &&
    recipeData.creationTime !== null
  ) {
    const ct = recipeData.creationTime;
    const isTimestamp = ct && typeof ct === 'object' && 'seconds' in ct;
    if (!(typeof ct === 'number' || typeof ct === 'string' || ct instanceof Date || isTimestamp)) {
      errors.creationTime = 'פורמט זמן לא תקין.';
    }
  }
  if (
    'updatedAt' in recipeData &&
    recipeData.updatedAt !== undefined &&
    recipeData.updatedAt !== null
  ) {
    const ut = recipeData.updatedAt;
    const isTimestamp = ut && typeof ut === 'object' && 'seconds' in ut;
    if (!(typeof ut === 'number' || typeof ut === 'string' || ut instanceof Date || isTimestamp)) {
      errors.updatedAt = 'פורמט זמן לא תקין.';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Calculates total recipe time from prep and cooking times
 * @param {number} prepTime - Preparation time in minutes
 * @param {number} waitTime - Cooking/waiting time in minutes
 * @returns {number} Total recipe time in minutes
 */
export function calculateTotalTime(prepTime, waitTime) {
  return (Number(prepTime) || 0) + (Number(waitTime) || 0);
}

/**
 * Formats cooking time into readable string format
 * @param {number} minutes - Total time in minutes
 * @returns {string} Formatted time string (e.g., "שעה ו-30 דקות")
 */
export function formatCookingTime(minutes) {
  if (minutes <= 60) return `${minutes} דקות`;
  if (minutes < 120) return `שעה ו-${minutes % 60} דקות`;
  if (minutes === 120) return 'שעתיים';
  if (minutes < 180) return `שעתיים ו-${minutes % 60} דקות`;
  if (minutes % 60 === 0) return `${Math.floor(minutes / 60)} שעות`;
  return `${Math.floor(minutes / 60)} שעות ו-${minutes % 60} דקות`;
}

/**
 * Determines time-based recipe class (quick/medium/long)
 * @param {number} totalMinutes - Total cooking time in minutes
 * @returns {string} Time class ('quick', 'medium', or 'long')
 */
export function getTimeClass(totalMinutes) {
  if (totalMinutes <= 30) return 'quick';
  if (totalMinutes <= 60) return 'medium';
  return 'long';
}

/**
 * Maps difficulty level to CSS class
 * @param {string} difficulty - Difficulty level (e.g., "קלה", "בינונית", "קשה")
 * @returns {string} CSS class name
 */
export function getDifficultyClass(difficulty) {
  const difficultyMap = {
    קלה: 'easy',
    בינונית: 'medium',
    קשה: 'hard',
  };
  return difficultyMap[difficulty] || 'medium';
}

/**
 * Maps category ID to display name
 * @param {string} categoryId - Category identifier
 * @returns {string} Localized category name
 */
export function getLocalizedCategoryName(categoryId) {
  return CATEGORY_MAP[categoryId] || categoryId;
}

/**
 * Gets icon for category
 * @param {string} category - Category ID
 * @returns {string} Icon HTML or character
 */
export function getCategoryIcon(category) {
  return CATEGORY_ICONS[category] || CATEGORY_ICONS.else;
}
