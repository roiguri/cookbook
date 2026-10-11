import authService from '../../js/services/auth/auth-service.js';
import { RecipeService, STAGE } from '../../js/services/recipes/recipe-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import { attachScrollFades } from '../../js/utils/scroll-fades.js';
import '../../styles/pages/home-spa.css';

// Cards per strip (the strips show one row of two on a phone)
const STRIP_SIZE = 4;
const MOBILE_STRIP_SIZE = 2;

export default {
  async render() {
    const response = await fetch(new URL('./home-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(`Failed to load home page template: ${response.status}`);
    }
    return await response.text();
  },

  async mount(container) {
    await this.importComponents();
    this.container = container;
    this.setupRecipeOpen();
    this.loadFeaturedRecipes();

    // "Next in the kitchen" is personal: (re)load it as sign-in resolves or changes.
    this.authUnsubscribe = authService.addAuthObserver(() => this.loadNextRecipes());

    // On a phone the category jars are one scrolling line; fade the edges with more.
    const tiles = container.querySelector('#category-tiles');
    this.tileFades = tiles ? attachScrollFades(tiles) : null;
  },

  async unmount() {
    this.authUnsubscribe?.();
    this.authUnsubscribe = null;
    this.tileFades?.detach();
    this.tileFades = null;
  },

  getTitle() {
    return AppConfig.title;
  },

  getMeta() {
    return {
      description:
        'Discover homemade goodness in every bite. Explore our collection of recipes across all categories.',
      keywords: 'recipes, cooking, homemade, kitchen, food',
    };
  },

  async importComponents() {
    try {
      await import('../../lib/recipes/recipe_strip/recipe_strip.js');
    } catch (error) {
      console.error('Error importing home page components:', error);
    }
  },

  /** A card in either strip opens its recipe. */
  setupRecipeOpen() {
    this.container.addEventListener('recipe-card-open', (event) => {
      const recipeId = event.detail.recipeId;
      if (window.spa?.router) {
        window.spa.router.navigate(`/recipe/${recipeId}`);
        setTimeout(() => {
          if (typeof window.updateActiveNavigation === 'function') {
            window.updateActiveNavigation();
          }
        }, 100);
      } else {
        window.location.href = `${import.meta.env.BASE_URL}recipe/${recipeId}`;
      }
    });
  },

  async loadFeaturedRecipes() {
    const strip = this.container.querySelector('#featured-recipes-strip');
    if (!strip) return;
    try {
      const recipes = await RecipeService.listPublished({
        orderBy: ['creationTime', 'desc'],
        limit: STRIP_SIZE,
      });
      if (recipes.length) strip.setRecipes(recipes.map((doc) => doc.id));
    } catch (error) {
      console.error('Error fetching featured recipes:', error);
    }
  },

  /**
   * The reader's own to-try recipes, newest first — for those with a library of
   * their own (approved family, managers). While the row has room (fewer than
   * a full row), an "add a recipe" tile follows; with none, it's the tile alone.
   */
  async loadNextRecipes() {
    const section = this.container?.querySelector('#next-recipes-section');
    const strip = this.container?.querySelector('#next-recipes-strip');
    const addTile = this.container?.querySelector('#next-add-tile');
    const allLink = this.container?.querySelector('#next-all-link');
    if (!section || !strip) return;
    const uid = authService.getCurrentUser()?.uid;
    if (!uid || !authService.isApproved()) {
      section.hidden = true;
      return;
    }
    try {
      const toTry = await RecipeService.listMine(uid, { stage: STAGE.TO_TRY });
      strip.setRecipes(toTry.slice(0, STRIP_SIZE).map((r) => r.id));
      // "All →" only when there's more than the row shows: 2 cards on a phone, 4 on desktop.
      if (allLink) {
        allLink.hidden = toTry.length <= MOBILE_STRIP_SIZE;
        allLink.classList.toggle('phone-only', toTry.length <= STRIP_SIZE);
      }
      if (addTile) {
        addTile.hidden = toTry.length >= STRIP_SIZE;
        addTile.classList.toggle('add-tile--alone', toTry.length === 0);
      }
      section.hidden = false;
    } catch (error) {
      console.error('Error fetching to-try recipes:', error);
      section.hidden = true;
    }
  },
};
