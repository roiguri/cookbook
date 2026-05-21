import { RecipeService } from '../../js/services/recipe-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import '../../styles/pages/home-spa.css';

export default {
  async render() {
    const response = await fetch(new URL('./home-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(`Failed to load home page template: ${response.status}`);
    }
    return await response.text();
  },

  async mount() {
    await this.importComponents();
    this.loadFeaturedRecipes();
  },

  async unmount() {
    // Nothing to clean up
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

  async loadFeaturedRecipes() {
    const strip = document.getElementById('featured-recipes-strip');
    if (!strip) {
      console.warn('Featured recipes strip not found');
      return;
    }

    try {
      const queryParams = {
        where: [['approved', '==', true]],
        orderBy: ['creationTime', 'desc'],
        limit: 4,
      };
      const recipes = await RecipeService.list(queryParams);

      if (!recipes.length) return;

      strip.setRecipes(recipes.map((doc) => doc.id));

      strip.addEventListener('recipe-card-open', (event) => {
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
    } catch (error) {
      console.error('Error fetching featured recipes:', error);
    }
  },
};
