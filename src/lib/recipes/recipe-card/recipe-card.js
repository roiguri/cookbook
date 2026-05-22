/**
 * Recipe Card Web Component
 * A simplified card component for displaying recipe information in vertical layout
 *
 * Architecture: Separated HTML, CSS, and JS files
 * - recipe-card.html: HTML templates
 * - recipe-card.css: Component styles
 * - recipe-card-config.js: Configuration constants
 * - recipe-card.js: Component logic (this file)
 *
 * @attributes
 * - recipe-id: ID of the recipe to fetch from Firestore (required)
 * - show-favorites: Whether to show the favorite button (optional)
 * - card-width: Width of the card (default: 200px)
 * - card-height: Height of the card (default: 300px)
 *
 * @events
 * - recipe-card-open: Emitted when the card is clicked
 *   detail: { recipeId: string }
 * - recipe-favorite-changed: Emitted when favorite status changes
 *   detail: { recipeId: string, isFavorite: boolean, userId: string }
 * - add-favorite: Emitted when recipe is added to favorites
 *   detail: { recipeId: string }
 * - remove-favorite: Emitted when recipe is removed from favorites
 *   detail: { recipeId: string }
 *
 * @features
 * - Displays recipe image (50% of card height)
 * - Shows recipe title, category, cooking time, and difficulty
 * - Loading state with skeleton animation
 * - Error state handling
 * - Favorite functionality for authenticated users
 * - Lazy loading for images
 * - Consistent dimensions to prevent layout shifts
 */
import { icons } from '../../../js/icons.js';
import authService from '../../../js/services/auth/auth-service.js';
import favoritesService from '../../../js/services/users/favorites-service.js';
import { ActiveMealService } from '../../../js/services/meals/active-meal-service.js';
import {
  getLocalizedCategoryName,
  formatCookingTime,
  getTimeClass,
  getDifficultyClass,
  getRecipeById,
} from '../../../js/utils/recipes/recipe-data-utils.js';
import {
  getPrimaryImageUrl,
  getPlaceholderImageUrl,
} from '../../../js/utils/recipes/recipe-image-utils.js';
import { initLazyLoading, lazyImageLoader } from '../../../js/utils/lazy-loading.js';
import RECIPE_CARD_CONFIG from './recipe-card-config.js';
import { recipeCardStyles } from './recipe-card-styles.js';

class RecipeCard extends HTMLElement {
  static get observedAttributes() {
    return RECIPE_CARD_CONFIG.OBSERVED_ATTRIBUTES;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this._defaults = RECIPE_CARD_CONFIG.DEFAULT_DIMENSIONS;
    this._isLoading = true;
    this._recipeData = null;
    this._imageUrl = null;
    this._error = null;
    this._templatesLoaded = false;
    this._stylesLoaded = false;
    this._isFavoriteProvided = false;

    this._handleCardClick = this._handleCardClick.bind(this);
    this._handleLinkClick = this._handleLinkClick.bind(this);

    this._userFavorites = new Set();

    // Load styles in constructor so :host { display: block; width: 100% } is
    // applied before the element is connected, preventing a display:inline flash.
    this._loadStyles();
  }

  get recipeId() {
    return this.getAttribute('recipe-id');
  }

  get cardWidth() {
    return this.getAttribute('card-width') || this._defaultWidth;
  }

  get cardHeight() {
    return this.getAttribute('card-height') || this._defaultHeight;
  }

  _getCurrentDimensions() {
    return {
      width: this.getAttribute('card-width') || this._defaults.width,
      height: this.getAttribute('card-height') || this._defaults.height,
    };
  }

  connectedCallback() {
    this._initialize();
  }

  disconnectedCallback() {
    this._cleanupImageObserver();
    this._removeEventListeners();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case 'recipe-id':
        if (this.isConnected) this._fetchRecipeData();
        break;
      case 'card-width':
      case 'card-height':
        this._updateDimensions();
        break;
    }
  }

  async _initialize() {
    this._loadStyles();
    this._showImmediateLoadingState();

    const templatesPromise = this._loadTemplates();
    const promises = [];

    // PERFORMANCE: Only fetch favorites if not provided by parent
    if (!this._isFavoriteProvided) {
      promises.push(this._fetchUserFavorites());
    }

    if (!this._recipeData && this.recipeId) {
      promises.push(this._fetchRecipeData());
    } else if (this._recipeData) {
      // If we already have data, ensure image logic runs
      promises.push(this._fetchRecipeImage());
    }

    const dataPromise = Promise.all(promises);

    await templatesPromise;
    this._render();
    await dataPromise;

    // Ensure loading state is cleared if we have data
    if (this._recipeData) {
      this._isLoading = false;
    }

    this._render();
    this._setupEventListeners();
  }

  /**
   * Set recipe data directly to avoid fetching
   * @param {Object} data - Recipe data object
   */
  set recipeData(data) {
    if (!data) return;
    this._recipeData = data;

    // If already connected, we might want to render or update
    if (this.isConnected) {
      // We still need to process the image URL
      this._fetchRecipeImage().then(() => {
        this._isLoading = false;
        this._render();
      });
    }
  }

  get recipeData() {
    return this._recipeData;
  }

  /**
   * Set favorite status directly to avoid fetching
   * This optimization allows parent components (like recipe-grid) to batch fetch
   * favorites for all recipes and pass the status down, preventing N+1 Firestore reads.
   *
   * @param {boolean} isFavorite - Whether the recipe is favorite
   */
  set isFavorite(isFavorite) {
    this._isFavoriteProvided = true;
    if (isFavorite) {
      this._userFavorites.add(this.recipeId);
    } else {
      this._userFavorites.delete(this.recipeId);
    }

    // If already connected, update render state
    if (this.isConnected && !this._isLoading) {
      this._render();
    }
  }

  get isFavorite() {
    return this._isFavorite();
  }

  _showImmediateLoadingState() {
    const card = document.createElement('div');
    card.className = 'recipe-card loading';
    card.innerHTML = `
      <div class="photo"></div>
      <div class="recipe-content">
        <div class="skel skel-cat"></div>
        <div class="skel skel-title"></div>
        <div class="skel-divider"></div>
        <div class="skel skel-meta"></div>
      </div>
    `;
    this.shadowRoot.appendChild(card);
  }

  _loadStyles() {
    if (this._stylesLoaded) return;

    const style = document.createElement('style');
    style.textContent = recipeCardStyles;
    this.shadowRoot.appendChild(style);

    this._stylesLoaded = true;
  }

  async _loadTemplates() {
    if (this._templatesLoaded) return;

    // Use static cache to avoid loading templates multiple times
    if (RecipeCard._templateCache) {
      this._templates = RecipeCard._templateCache;
      this._templatesLoaded = true;
      return;
    }

    // If another instance is already loading, wait for it
    if (RecipeCard._templatePromise) {
      await RecipeCard._templatePromise;
      this._templates = RecipeCard._templateCache;
      this._templatesLoaded = true;
      return;
    }

    // This instance will load templates for everyone
    RecipeCard._templatePromise = this._loadTemplatesFromFile();

    try {
      await RecipeCard._templatePromise;
      this._templates = RecipeCard._templateCache;
      this._templatesLoaded = true;
    } catch (error) {
      console.error('Failed to load recipe card templates:', error);
      this._setupInlineTemplates();
    } finally {
      RecipeCard._templatePromise = null;
    }
  }

  async _loadTemplatesFromFile() {
    const url = new URL('./recipe-card.html', import.meta.url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch templates: ${response.status} ${response.statusText} from ${url.href}`,
      );
    }
    const htmlText = await response.text();

    // Create a temporary container to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlText;

    // Store templates in static cache
    RecipeCard._templateCache = {
      main: tempDiv.querySelector('#recipe-card-template'),
      loading: tempDiv.querySelector('#loading-template'),
      error: tempDiv.querySelector('#error-template'),
      noImage: tempDiv.querySelector('#no-image-card-template'),
    };
  }

  _setupInlineStyles() {
    // This method is no longer needed since we import styles directly
    // Kept for backward compatibility
    this._loadStyles();
  }

  _setupInlineTemplates() {
    // Create minimal inline templates as fallback
    this._templates = {
      main: this._createInlineMainTemplate(),
      loading: this._createInlineLoadingTemplate(),
      error: this._createInlineErrorTemplate(),
      noImage: this._createInlineNoImageTemplate(),
    };
    this._templatesLoaded = true;
  }

  _createInlineMainTemplate() {
    const template = document.createElement('template');
    template.innerHTML = `
      <div class="recipe-card" role="article">
        <button class="favorite-btn" aria-label="Add to favorites">
          ${icons.heartOutline}
        </button>
        <button class="add-to-meal-btn" aria-label="Add to meal" style="display: none">
          ${icons.plus}
        </button>
        <div class="photo">
          <img class="recipe-image" data-src="" alt="" data-fallback="/img/placeholder.jpg">
        </div>
        <div class="recipe-content">
          <span class="badge category"></span>
          <h3 class="recipe-title"><a class="recipe-link" href=""></a></h3>
          <div class="recipe-meta">
            <span dir="rtl" class="badge time"></span>
            <span class="badge difficulty"><span class="icon"></span></span>
          </div>
        </div>
      </div>
    `;
    return template;
  }

  _createInlineLoadingTemplate() {
    const template = document.createElement('template');
    template.innerHTML = '<div class="recipe-card loading"></div>';
    return template;
  }

  _createInlineErrorTemplate() {
    const template = document.createElement('template');
    template.innerHTML = '<div class="error-state"></div>';
    return template;
  }

  _createInlineNoImageTemplate() {
    const template = document.createElement('template');
    template.innerHTML = `
      <div class="recipe-card" role="article">
        <button class="favorite-btn" aria-label="Add to favorites">
          ${icons.heartOutline}
        </button>
        <button class="add-to-meal-btn" aria-label="Add to meal" style="display: none">
          ${icons.plus}
        </button>
        <div class="photo no-image-placeholder">
          <span class="no-image-icon">${icons.imagePlaceholder}</span>
        </div>
        <div class="recipe-content">
          <span class="badge category"></span>
          <h3 class="recipe-title"><a class="recipe-link" href=""></a></h3>
          <div class="recipe-meta">
            <span dir="rtl" class="badge time"></span>
            <span class="badge difficulty"><span class="icon"></span></span>
          </div>
        </div>
      </div>
    `;
    return template;
  }

  _setupEventListeners() {
    // Remove existing listeners first to prevent duplicates
    this._removeEventListeners();

    const card = this.shadowRoot.querySelector(`.${RECIPE_CARD_CONFIG.CSS_CLASSES.card}`);
    // Fallback click listener for areas potentially missed by the stretched link
    if (card) {
      card.addEventListener('click', this._handleCardClick);
    }

    const recipeLink = this.shadowRoot.querySelector('.recipe-link');
    if (recipeLink) {
      recipeLink.addEventListener('click', this._handleLinkClick);
    }

    // Store references for cleanup
    this._card = card;
    this._recipeLink = recipeLink;

    const favoriteBtn = this.shadowRoot.querySelector(
      `.${RECIPE_CARD_CONFIG.CSS_CLASSES.favoriteBtn}`,
    );
    if (favoriteBtn && !favoriteBtn.hasAttribute('listener-attached')) {
      favoriteBtn.setAttribute('listener-attached', 'true');
      favoriteBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent card click

        const isFavorite = favoriteBtn.classList.contains(
          RECIPE_CARD_CONFIG.CSS_CLASSES.favoriteBtnActive,
        );
        favoriteBtn.classList.toggle(RECIPE_CARD_CONFIG.CSS_CLASSES.favoriteBtnActive);
        favoriteBtn.setAttribute(
          'aria-label',
          !isFavorite ? 'Remove from favorites' : 'Add to favorites',
        );

        try {
          await this._toggleFavorite();

          this.dispatchEvent(
            new CustomEvent(
              isFavorite
                ? RECIPE_CARD_CONFIG.EVENTS.removeFavorite
                : RECIPE_CARD_CONFIG.EVENTS.addFavorite,
              {
                bubbles: true,
                composed: true,
                detail: {
                  recipeId: this.recipeId,
                },
              },
            ),
          );
        } catch (error) {
          // Revert optimistic UI if network request fails
          favoriteBtn.classList.toggle(
            RECIPE_CARD_CONFIG.CSS_CLASSES.favoriteBtnActive,
            isFavorite,
          );
          favoriteBtn.setAttribute(
            'aria-label',
            isFavorite ? 'Remove from favorites' : 'Add to favorites',
          );
        }
      });
    }

    const addToMealBtn = this.shadowRoot.querySelector('.add-to-meal-btn');
    if (addToMealBtn) {
      addToMealBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent card navigation
        this._createRipple(e, addToMealBtn); // Trigger ripple
        await this._addToMeal();
      });
    }
  }

  _createRipple(event, button) {
    const circle = document.createElement('span');
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;

    const rect = button.getBoundingClientRect();

    // Calculate click position relative to button
    const x = event.clientX - rect.left - radius;
    const y = event.clientY - rect.top - radius;

    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${x}px`;
    circle.style.top = `${y}px`;
    circle.classList.add('ripple');

    // Remove existing ripple
    const ripple = button.getElementsByClassName('ripple')[0];
    if (ripple) {
      ripple.remove();
    }

    button.appendChild(circle);
  }

  _removeEventListeners() {
    if (this._card) {
      this._card.removeEventListener('click', this._handleCardClick);
    }
    if (this._recipeLink) {
      this._recipeLink.removeEventListener('click', this._handleLinkClick);
    }
  }

  _handleLinkClick(event) {
    // Allow default behavior (navigation) if modifier keys are pressed
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    // Prevent default navigation for normal clicks and use SPA routing event
    event.preventDefault();

    // Emit the open event which the app likely listens to for SPA navigation
    const customEvent = new CustomEvent(RECIPE_CARD_CONFIG.EVENTS.cardOpen, {
      detail: { recipeId: this.recipeId },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  _handleCardClick(event) {
    // Fallback: Handle clicks that bubble up if not caught by the link

    // Check if the click came from the favorite button or link - ignore those
    if (event.target.closest('.favorite-btn') || event.target.closest('.recipe-link')) {
      return;
    }

    // Otherwise, treat it as a navigation attempt (fallback)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const customEvent = new CustomEvent(RECIPE_CARD_CONFIG.EVENTS.cardOpen, {
      detail: { recipeId: this.recipeId },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  async _fetchRecipeData() {
    if (!this.recipeId) {
      this._handleError('No recipe ID provided');
      return;
    }
    try {
      this._isLoading = true;
      this._recipeData = await getRecipeById(this.recipeId);
      if (!this._recipeData) {
        throw new Error('Recipe not found');
      }
      await this._fetchRecipeImage();
      this._isLoading = false;
    } catch (error) {
      this._handleError(error);
    }
  }

  async _fetchRecipeImage() {
    try {
      this._imageUrl = await getPrimaryImageUrl(this._recipeData, '400x400');
    } catch (error) {
      console.error('Error fetching recipe image:', error);
      this._imageUrl = getPlaceholderImageUrl();
    }
  }

  _handleError(error) {
    console.error('Recipe Card Error:', error);
    this._isLoading = false;
    this._error = error.message || RECIPE_CARD_CONFIG.FALLBACKS.errorMessage;
  }

  _render() {
    if (!this._templatesLoaded || !this._stylesLoaded) {
      // Templates/styles not loaded yet, wait
      return;
    }

    if (this._isLoading) {
      this._renderLoadingState();
      return;
    }

    if (this._error) {
      this._renderErrorState();
      return;
    }

    if (this._recipeData) {
      this._renderRecipe();
    }
  }

  _renderLoadingState() {
    this._clearShadowRoot();
    const template = this._templates.loading;
    const clone = template.content.cloneNode(true);
    this.shadowRoot.appendChild(clone);
  }

  _renderErrorState() {
    this._clearShadowRoot();
    const template = this._templates.error;
    const clone = template.content.cloneNode(true);
    const errorElement = clone.querySelector(`.${RECIPE_CARD_CONFIG.CSS_CLASSES.error}`);
    if (errorElement) {
      errorElement.textContent = this._error;
    }
    this.shadowRoot.appendChild(clone);
  }

  _renderRecipe() {
    const { name, category, prepTime, waitTime, difficulty } = this._recipeData;
    const totalTime = prepTime + waitTime;
    const timeClass = getTimeClass(totalTime);
    const difficultyClass = getDifficultyClass(difficulty);

    this._clearShadowRoot();
    const template =
      this._hasImages() && this._imageUrl ? this._templates.main : this._templates.noImage;
    const clone = template.content.cloneNode(true);

    // Populate template with data
    const favoriteBtn = clone.querySelector(`.${RECIPE_CARD_CONFIG.CSS_CLASSES.favoriteBtn}`);
    const addToMealBtn = clone.querySelector('.add-to-meal-btn');
    const recipeImage = clone.querySelector(`.${RECIPE_CARD_CONFIG.CSS_CLASSES.recipeImage}`);
    const recipeLink = clone.querySelector('.recipe-link');
    const categoryBadge = clone.querySelector(`.${RECIPE_CARD_CONFIG.CSS_CLASSES.badgeCategory}`);
    const timeBadge = clone.querySelector(`.${RECIPE_CARD_CONFIG.CSS_CLASSES.badgeTime}`);
    const difficultyBadge = clone.querySelector(
      `.${RECIPE_CARD_CONFIG.CSS_CLASSES.badgeDifficulty}`,
    );

    // Handle favorite button visibility
    if (!this.hasAttribute('show-favorites') && favoriteBtn) {
      favoriteBtn.remove();
    } else if (favoriteBtn) {
      const isFav = this._isFavorite();
      favoriteBtn.classList.toggle(RECIPE_CARD_CONFIG.CSS_CLASSES.favoriteBtnActive, isFav);
      favoriteBtn.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
    }

    // Handle add to meal button visibility
    const user = authService.getCurrentUser();
    if (addToMealBtn) {
      if (user && this.hasAttribute('show-add-to-meal')) {
        addToMealBtn.style.display = 'block';
      } else {
        addToMealBtn.style.display = 'none';
      }
    }

    if (recipeImage) {
      recipeImage.setAttribute('data-src', this._imageUrl);
      recipeImage.setAttribute('alt', name);
      recipeImage.setAttribute('data-fallback', RECIPE_CARD_CONFIG.FALLBACKS.image);
    }

    if (recipeLink) {
      recipeLink.textContent = name;
      recipeLink.href = `/recipe/${this.recipeId}`;
    }

    if (categoryBadge) {
      categoryBadge.className = `${RECIPE_CARD_CONFIG.CSS_CLASSES.badge} ${RECIPE_CARD_CONFIG.CSS_CLASSES.badgeCategory} ${category}`;
      categoryBadge.textContent = getLocalizedCategoryName(category);
    }

    if (timeBadge) {
      timeBadge.className = `${RECIPE_CARD_CONFIG.CSS_CLASSES.badge} ${RECIPE_CARD_CONFIG.CSS_CLASSES.badgeTime} ${timeClass}`;
      timeBadge.textContent = formatCookingTime(totalTime);
    }

    if (difficultyBadge) {
      difficultyBadge.className = `${RECIPE_CARD_CONFIG.CSS_CLASSES.badge} ${RECIPE_CARD_CONFIG.CSS_CLASSES.badgeDifficulty} ${difficultyClass}`;
      const iconSpan = difficultyBadge.querySelector('.icon');
      if (iconSpan) {
        iconSpan.textContent = `${this._getDifficultyIcon()} ${difficulty}`;
      }
    }

    this.shadowRoot.appendChild(clone);
    this._setupEventListeners();

    initLazyLoading(this.shadowRoot);
  }

  _clearShadowRoot() {
    this._cleanupImageObserver();
    const existingStyle = this.shadowRoot.querySelector('style');
    this.shadowRoot.innerHTML = '';
    if (existingStyle) {
      this.shadowRoot.appendChild(existingStyle);
    }
  }

  _cleanupImageObserver() {
    const img = this.shadowRoot.querySelector('img');
    if (img) {
      lazyImageLoader.unobserve(img);
    }
  }

  async _fetchUserFavorites() {
    try {
      const favoriteRecipeIds = await favoritesService.getUserFavorites();
      this._userFavorites = new Set(favoriteRecipeIds);
    } catch (error) {
      console.error('Error fetching favorites:', error);
    }
  }

  async _addToMeal() {
    const user = authService.getCurrentUser();
    if (!user) return;

    try {
      await import('../../../lib/modals/message-modal/message-modal.js');

      const result = await ActiveMealService.addToMeal(user.uid, this.recipeId);

      let messageModal = document.querySelector('message-modal');
      if (!messageModal) {
        messageModal = document.createElement('message-modal');
        document.body.appendChild(messageModal);
      }

      if (result.success) {
        messageModal.show('המתכון נוסף לארוחה שלך בהצלחה', 'נוסף לארוחה');
      } else if (result.reason === 'duplicate') {
        messageModal.show('המתכון כבר נמצא בארוחה שלך', 'כבר קיים');
      } else {
        messageModal.show('שגיאה בהוספת המתכון לארוחה', 'שגיאה');
      }
    } catch (error) {
      console.error('Error adding to meal:', error);
      const messageModal =
        document.querySelector('message-modal') || document.createElement('message-modal');
      if (!messageModal.isConnected) document.body.appendChild(messageModal);
      messageModal.show('שגיאה בהוספת המתכון לארוחה', 'שגיאה');
    }
  }

  async _toggleFavorite() {
    try {
      const user = authService.getCurrentUser();
      const userId = user?.uid;
      if (!userId) return; // No user logged in

      const wasFavorite = this._isFavorite();

      if (wasFavorite) {
        // Remove from favorites
        await favoritesService.removeFavorite(this.recipeId);
        this._userFavorites.delete(this.recipeId);
      } else {
        // Add to favorites
        await favoritesService.addFavorite(this.recipeId);
        this._userFavorites.add(this.recipeId);
      }

      // Dispatch event to notify other components about the favorite change
      this.dispatchEvent(
        new CustomEvent(RECIPE_CARD_CONFIG.EVENTS.favoriteChanged, {
          bubbles: true,
          composed: true,
          detail: {
            recipeId: this.recipeId,
            isFavorite: !wasFavorite,
            userId: userId,
          },
        }),
      );

      // Also dispatch to document for global listeners
      document.dispatchEvent(
        new CustomEvent(RECIPE_CARD_CONFIG.EVENTS.favoriteChanged, {
          detail: {
            recipeId: this.recipeId,
            isFavorite: !wasFavorite,
            userId: userId,
          },
        }),
      );
    } catch (error) {
      console.error('Error toggling favorite:', error);
      throw error;
    }
  }

  _isFavorite() {
    return this._userFavorites.has(this.recipeId);
  }

  _getDifficultyIcon() {
    return '';
  }

  _updateDimensions() {
    const dimensions = this._getCurrentDimensions();
    this.style.setProperty('--card-width', dimensions.width);
    this.style.setProperty('--card-height', dimensions.height);
  }

  /**
   * Check if recipe has any approved images
   * @returns {boolean} True if recipe has at least one approved image
   */
  _hasImages() {
    return (
      this._recipeData &&
      Array.isArray(this._recipeData.images) &&
      this._recipeData.images.length > 0
    );
  }
}

// Initialize static properties for template caching
RecipeCard._templateCache = null;
RecipeCard._templatePromise = null;

// Register the custom element
customElements.define('recipe-card', RecipeCard);
