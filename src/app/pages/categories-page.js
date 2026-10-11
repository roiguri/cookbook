import { RecipeService } from '../../js/services/recipes/recipe-service.js';
import { RecipeSearchService } from '../../js/services/recipes/recipe-search-service.js';
import authService from '../../js/services/auth/auth-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import { getLocalizedCategoryName } from '../../js/utils/recipes/recipe-data-utils.js';
import { RecipeListController } from '../../lib/collections/recipe-list/recipe-list-controller.js';
import '../../styles/pages/categories-spa.css';

// TODO: implement recipe-per-page change on screen resize
export default {
  async render() {
    try {
      // Resolve relative to this module so it works no matter where the SPA is mounted
      const response = await fetch(new URL('./categories-page.html', import.meta.url));
      if (!response.ok) {
        throw new Error(`Failed to load categories template: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      console.error('Error loading categories page template:', error);
      throw error;
    }
  },

  async mount(_container, params) {
    try {
      await this.importComponents();
      // Search, filters, category chips, pagination and favourites are shared with
      // every recipe list page; this page supplies the data source, title and URL.
      this.list = new RecipeListController({
        // Browsing shows the family book; a search also finds the reader's own
        // private recipes (approved family and managers).
        loadRecipes: ({ category, searchQuery }) =>
          searchQuery
            ? RecipeSearchService.listSearchable({
                category,
                ownerId: authService.isApproved() ? authService.getCurrentUser()?.uid : null,
              })
            : RecipeService.listPublished({
                where: category !== 'all' ? [['category', '==', category]] : [],
              }),
        onStateChanged: (state) => this.updatePageTitle(state),
        onUrlChanged: (state) => this.updateURL(state),
        context: 'Categories page',
      });
      this.list.init({
        category: params?.category,
        searchQuery: params?.q,
        favoritesOnly: params?.favorites === 'true',
      });
      this.setupNavigationInterception();
      await this.list.start();
    } catch (error) {
      console.error('Error mounting categories page:', error);
      this.list?.handleError(error, 'mount');
    }
  },

  async waitForReady(container) {
    const filter = container.querySelector('#unified-filter');
    if (filter?.waitForReady) await filter.waitForReady();
  },

  async unmount() {
    try {
      this.list?.stop();
      this.removeNavigationInterception();
    } catch (error) {
      console.error('Error unmounting categories page:', error);
    }
  },

  getTitle(params) {
    const category = params?.category;
    if (category && category !== 'all') {
      return AppConfig.getPageTitle(getLocalizedCategoryName(category));
    }
    return AppConfig.getPageTitle('מתכונים');
  },

  getMeta(params) {
    const category = params?.category;
    const searchQuery = params?.q;

    let description = 'Browse our collection of delicious recipes';
    if (category && category !== 'all') {
      description = `Discover ${getLocalizedCategoryName(category)} recipes`;
    }
    if (searchQuery) {
      description += ` matching "${searchQuery}"`;
    }

    return {
      description,
      keywords: 'recipes, cooking, categories, search, food, kitchen',
    };
  },

  async handleRouteChange(params) {
    await this.list?.applyState({
      category: params?.category || 'all',
      searchQuery: params?.q || '',
      favoritesOnly: params?.favorites === 'true',
    });
  },

  async importComponents() {
    try {
      await Promise.all([
        import('../../lib/recipes/recipe-card/recipe-card.js'),
        import('../../lib/collections/unified-recipe-filter/unified-recipe-filter.js'),
        import('../../lib/collections/recipe-grid/recipe-presentation-grid.js'),
      ]);
    } catch (error) {
      console.error('Error importing categories page components:', error);
    }
  },

  updatePageTitle({ activeFilters, currentSearchQuery, currentCategory }) {
    const pageTitle = document.querySelector('#category-header');
    if (pageTitle) {
      if (activeFilters.favoritesOnly) {
        pageTitle.textContent = 'מתכונים ששמרתי';
      } else if (currentSearchQuery) {
        pageTitle.textContent = `תוצאות חיפוש: "${currentSearchQuery}"`;
      } else if (currentCategory !== 'all') {
        pageTitle.textContent = getLocalizedCategoryName(currentCategory);
      } else {
        pageTitle.textContent = 'מתכונים';
      }
    }
  },

  setupNavigationInterception() {
    if (window.NavigationInterceptor) {
      this.navigationInterceptor = new window.NavigationInterceptor();

      this.navigationInterceptor.addHandler('a[href="/categories?favorites=true"]', () => {
        this.list.setFilterState({ favoritesOnly: true });
      });

      this.navigationInterceptor.addHandler('a[href="/categories"]', () => {
        this.list.setFilterState({ resetFilters: true });
      });
    }
  },

  removeNavigationInterception() {
    if (this.navigationInterceptor) {
      this.navigationInterceptor.removeAllHandlers();
      this.navigationInterceptor = null;
    }
  },

  updateURL({ currentCategory, currentSearchQuery, activeFilters }) {
    window.spa?.router?.updateCategoriesParams(currentCategory, currentSearchQuery, activeFilters);
  },
};
