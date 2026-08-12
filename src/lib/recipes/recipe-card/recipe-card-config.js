/**
 * Recipe Card Configuration
 * Constants and configuration for the recipe card component
 */

export const RECIPE_CARD_CONFIG = {
  // Default dimensions
  DEFAULT_DIMENSIONS: {
    width: '100%',
    height: 'auto',
  },

  // Observed attributes
  OBSERVED_ATTRIBUTES: ['recipe-id', 'card-width', 'card-height', 'show-add-to-meal'],

  // CSS Classes
  CSS_CLASSES: {
    card: 'recipe-card',
    cardPending: 'pending',
    loading: 'loading',
    error: 'error-state',
    favoriteBtn: 'favorite-btn',
    favoriteBtnActive: 'active',
    recipeImage: 'recipe-image',
    imageLoaded: 'loaded',
    recipeContent: 'recipe-content',
    recipeTitle: 'recipe-title',
    recipeMeta: 'recipe-meta',
    categoryContainer: 'category-container',
    statsContainer: 'stats-container',
    badge: 'badge',
    badgeCategory: 'category',
    badgeTime: 'time',
    badgeDifficulty: 'difficulty',
    stamp: 'stamp',
  },

  // Visibility stamp shown on the photo when the `show-visibility` attribute
  // is present. Keyed by recipe.visibility; a value with no entry (or a
  // missing/unrecognized field) renders no stamp.
  VISIBILITY_STAMPS: {
    private: { className: 'private', label: 'פרטי' },
    pending: { className: 'pending', label: 'בבדיקה' },
    public: { className: 'approved', label: 'משותף' },
  },

  // Template IDs
  TEMPLATE_IDS: {
    main: 'recipe-card-template',
    loading: 'loading-template',
    error: 'error-template',
  },

  // Event names
  EVENTS: {
    cardOpen: 'recipe-card-open',
    favoriteChanged: 'recipe-favorite-changed',
    addFavorite: 'add-favorite',
    removeFavorite: 'remove-favorite',
  },

  // File paths
  PATHS: {
    template: './recipe-card.html',
    styles: './recipe-card.css',
  },

  // Fallback values
  FALLBACKS: {
    image: '/img/placeholder.jpg',
    errorMessage: 'שגיאה בטעינת המתכון',
  },
};

export default RECIPE_CARD_CONFIG;
