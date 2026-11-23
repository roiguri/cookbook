/**
 * FilterUtils - Pure functions for recipe filtering
 * No side effects, no async operations, no Firebase dependencies
 */
export class FilterUtils {
  /**
   * Apply filters to a recipes array
   * @param {Array} recipes - Array of recipe objects
   * @param {Object} filters - Filter criteria object
   * @param {Array} [favoriteRecipeIds] - Array of favorite recipe IDs (for favorites filter)
   * @returns {Array} Filtered recipes array
   */
  static applyFilters(recipes, filters, favoriteRecipeIds = []) {
    if (!recipes || !Array.isArray(recipes)) {
      return [];
    }

    if (!filters) {
      return recipes;
    }

    const { cookingTime, difficulty, mainIngredient, tags, favoritesOnly } = filters;

    return recipes.filter((recipe) => {
      // Cooking time filter
      if (cookingTime) {
        const totalTime = (recipe.prepTime || 0) + (recipe.waitTime || 0);
        if (cookingTime === '0-30' && totalTime > 30) return false;
        if (cookingTime === '31-60' && (totalTime <= 30 || totalTime > 60)) return false;
        if (cookingTime === '61' && totalTime <= 60) return false;
      }

      // Difficulty filter
      if (difficulty && recipe.difficulty !== difficulty) return false;

      // Main ingredient filter
      if (mainIngredient) {
        // Only filter if recipe has a main ingredient and it doesn't match
        if (!recipe.mainIngredient || recipe.mainIngredient !== mainIngredient) return false;
      }

      // Tags filter - all selected tags must be present
      if (tags && tags.length > 0) {
        const recipeTags = recipe.tags || [];
        if (!tags.every((tag) => recipeTags.includes(tag))) return false;
      }

      // Favorites filter - only show recipes that are in user's favorites
      if (favoritesOnly) {
        if (!favoriteRecipeIds || !Array.isArray(favoriteRecipeIds)) {
          return false; // No favorites data available
        }
        if (!favoriteRecipeIds.includes(recipe.id)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Extract available filter options from recipes
   * @param {Array} recipes - Array of recipe objects
   * @returns {Object} Available filter options
   */
  static extractFilterOptions(recipes) {
    if (!recipes || !Array.isArray(recipes)) {
      return {
        mainIngredients: [],
        tags: [],
      };
    }

    const mainIngredients = [
      ...new Set(
        recipes
          .map((r) => r.mainIngredient)
          .filter(
            (ingredient) => ingredient && typeof ingredient === 'string' && ingredient.trim(),
          ),
      ),
    ].sort((a, b) => a.localeCompare(b));

    const tags = [...new Set(recipes.flatMap((r) => r.tags || []))].sort((a, b) =>
      a.localeCompare(b),
    );

    return {
      mainIngredients,
      tags,
    };
  }

  /**
   * Check if any filters are active
   * @param {Object} filters - Filter criteria object
   * @returns {boolean} True if any filters are active
   */
  static hasActiveFilters(filters) {
    if (!filters) return false;

    return !!(
      filters.cookingTime ||
      filters.difficulty ||
      filters.mainIngredient ||
      (filters.tags && filters.tags.length > 0) ||
      filters.favoritesOnly
    );
  }

  /**
   * Create empty filter object
   * @returns {Object} Empty filter object
   */
  static createEmptyFilters() {
    return {
      cookingTime: '',
      difficulty: '',
      mainIngredient: '',
      tags: [],
      favoritesOnly: false,
    };
  }

  /**
   * Validate filter object structure
   * @param {Object} filters - Filter object to validate
   * @returns {Object} Validated and normalized filter object
   */
  static validateFilters(filters) {
    const defaults = FilterUtils.createEmptyFilters();

    if (!filters || typeof filters !== 'object') {
      return defaults;
    }

    return {
      cookingTime: filters.cookingTime || defaults.cookingTime,
      difficulty: filters.difficulty || defaults.difficulty,
      mainIngredient: filters.mainIngredient || defaults.mainIngredient,
      tags: Array.isArray(filters.tags) ? filters.tags : defaults.tags,
      favoritesOnly: Boolean(filters.favoritesOnly),
    };
  }

  /**
   * Search recipes by text across name, category, and tags
   * @param {Array} recipes - Array of recipe objects to search
   * @param {string} searchText - Search query string
   * @returns {Array} Filtered recipes matching the search query
   */
  static searchRecipes(recipes, searchText) {
    if (!recipes || !Array.isArray(recipes)) {
      return [];
    }

    if (!searchText || typeof searchText !== 'string') {
      return recipes;
    }

    const searchTerms = searchText.toLowerCase().trim().split(/\s+/);

    return recipes.filter((recipe) => {
      const searchableText = [recipe.name, recipe.category, ...(recipe.tags || [])]
        .join(' ')
        .toLowerCase();

      return searchTerms.every((term) => searchableText.includes(term));
    });
  }
}
