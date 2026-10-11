import authService from '../../js/services/auth/auth-service.js';
import { RecipeService } from '../../js/services/recipes/recipe-service.js';
import { RecipeSubmissionService } from '../../js/services/recipes/recipe-submission-service.js';
import favoritesService from '../../js/services/users/favorites-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import { icons } from '../../js/icons.js';
import { buildLibraryViews, LIBRARY_VIEW } from '../../js/utils/recipes/library-views.js';
import { RecipeListController } from '../../lib/collections/recipe-list/recipe-list-controller.js';
import { showToast } from '../../lib/notifications/toast-notification/toast-notification.js';
import '../../styles/pages/categories-spa.css';
import '../../styles/pages/my-recipes-spa.css';

const VIEWS = {
  [LIBRARY_VIEW.ALL]: {
    lede: 'המתכונים שכתבתם והמתכונים ששמרתם מהספר המשפחתי, במקום אחד.',
    emptyTitle: 'הספרייה עדיין ריקה',
    emptyText: 'כתבו מתכון משלכם, או שמרו מתכון מהספר המשפחתי בלחיצה על הלב.',
  },
  [LIBRARY_VIEW.MINE]: {
    lede: 'מתכונים שכתבתם — פרטיים, לנסות, ואלה שפורסמו בספר המשפחתי.',
    emptyTitle: 'עוד לא כתבתם מתכונים',
    emptyText: 'כתבו מתכון משלכם, או ייבאו אחד מקישור או מתמונה.',
  },
  [LIBRARY_VIEW.SAVED]: {
    lede: 'מתכונים ששמרתם בלחיצה על הלב.',
    emptyTitle: 'עוד לא שמרתם מתכונים',
    emptyText: 'לחצו על הלב בכרטיס של מתכון כדי לשמור אותו כאן.',
    toBook: true,
  },
  [LIBRARY_VIEW.TO_TRY]: {
    lede: 'מתכונים ששמרתם ועוד לא ניסיתם. אחרי שתנסו, סמנו אותם כנבדקים.',
    emptyTitle: 'אין כאן מתכונים לנסות',
    emptyText:
      'מצאתם מתכון באתר, בספר או על פתק? הוסיפו אותו בטופס המתכון החדש — אפשר לייבא מקישור או מתמונה — והוא יחכה כאן עד שתנסו.',
  },
};

// `?view=`; "all" when absent or unknown.
function viewFromParams(params) {
  return Object.values(LIBRARY_VIEW).includes(params?.view) ? params.view : LIBRARY_VIEW.ALL;
}

/**
 * הספרייה שלי — everything that's the reader's: the recipes they wrote and the
 * recipes they saved (the heart), with scope chips: all · mine · saved · to try.
 *
 * The list itself is the Categories list (RecipeListController + the same
 * filter, grid and cards); this page supplies the data source, the chips and
 * the empty state. Approved family and managers see all chips; plain users
 * (no recipes of their own) see what they saved.
 */
export default {
  async render() {
    const response = await fetch(new URL('./my-recipes-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(`Failed to load my library template: ${response.status}`);
    }
    return await response.text();
  },

  async mount(container, params) {
    const user = await authService.waitForAuth();
    if (!user) {
      this.redirectToHome();
      return;
    }
    const role = await authService.getCurrentUserRole();
    this.hasOwnRecipes = role === 'approved' || role === 'manager';

    await this.importComponents();
    this.container = container;
    this.view = this.hasOwnRecipes ? viewFromParams(params) : LIBRARY_VIEW.SAVED;
    this.counts = {};
    this.renderStaticParts();

    this.list = new RecipeListController({
      loadRecipes: (args) => this.loadRecipes(args),
      onRecipesLoaded: () => this.updateEmptyState(),
      onUrlChanged: (state) => this.updateURL(state),
      context: 'My library page',
    });
    this.list.init({
      category: params?.category,
      searchQuery: params?.q,
      favoritesOnly: params?.favorites === 'true',
    });
    this.applyView();

    this.onMarkTested = (event) => this.markTested(event.detail.recipeId);
    container
      .querySelector('#recipe-presentation-grid')
      ?.addEventListener('recipe-mark-tested', this.onMarkTested);

    this.setupChipFades();

    // Saving or un-saving a recipe changes what the library holds.
    this.onFavoriteChanged = () => this.list?.reloadAndDisplay();
    document.addEventListener('recipe-favorite-changed', this.onFavoriteChanged);

    this.authUnsubscribe = authService.addAuthObserver(({ user: current }) => {
      if (!current) this.redirectToHome();
    });

    await this.list.start();
  },

  async waitForReady(container) {
    const filter = container.querySelector('#unified-filter');
    if (filter?.waitForReady) await filter.waitForReady();
  },

  async unmount() {
    this.list?.stop();
    this.list = null;
    this.chipFadesCleanup?.();
    this.chipFadesCleanup = null;
    if (this.onFavoriteChanged) {
      document.removeEventListener('recipe-favorite-changed', this.onFavoriteChanged);
      this.onFavoriteChanged = null;
    }
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
  },

  getTitle() {
    return AppConfig.getPageTitle('הספרייה שלי');
  },

  getMeta() {
    return {
      description: 'הספרייה שלי — המתכונים שלי והמתכונים ששמרתי',
      keywords: 'מתכונים, ספרייה',
    };
  },

  async handleRouteChange(params) {
    if (!this.list) return;
    const view = this.hasOwnRecipes ? viewFromParams(params) : LIBRARY_VIEW.SAVED;
    if (view === this.view) {
      await this.list.applyState({
        category: params?.category || 'all',
        searchQuery: params?.q || '',
        favoritesOnly: params?.favorites === 'true',
      });
      return;
    }

    // Switching scope: a fresh list for the other view, filters as in the URL.
    this.view = view;
    this.list.currentCategory = params?.category || 'all';
    this.list.currentSearchQuery = params?.q || '';
    this.list.filter?.setSearchQuery(this.list.currentSearchQuery);
    this.applyView();
    await this.list.reloadAndDisplay();
    if (window.updateActiveNavigation) window.updateActiveNavigation();
  },

  async importComponents() {
    await Promise.all([
      import('../../lib/recipes/recipe-card/recipe-card.js'),
      import('../../lib/collections/unified-recipe-filter/unified-recipe-filter.js'),
      import('../../lib/collections/recipe-grid/recipe-presentation-grid.js'),
    ]);
  },

  /**
   * My recipes (with their badges) and the recipes I saved, loaded once for all
   * chips (the counts need every view); the current view and category apply here.
   */
  async loadRecipes({ category }) {
    const uid = authService.getCurrentUser()?.uid;
    const [mine, saved] = await Promise.all([
      this.hasOwnRecipes ? RecipeSubmissionService.listMineWithStatus(uid) : [],
      this.loadSaved(),
    ]);
    const views = buildLibraryViews(mine, saved);

    this.counts = Object.fromEntries(Object.entries(views).map(([v, list]) => [v, list.length]));
    this.renderCounts();

    const inView = views[this.view];
    this.viewTotal = inView.length;
    return category && category !== 'all' ? inView.filter((r) => r.category === category) : inView;
  },

  /** Saved recipes, one by one — a removed or now-private recipe is skipped. */
  async loadSaved() {
    const ids = await favoritesService.getUserFavorites();
    const recipes = await Promise.all(ids.map((id) => RecipeService.get(id).catch(() => null)));
    return recipes.filter(Boolean);
  },

  renderStaticParts() {
    const $ = (sel) => this.container.querySelector(sel);
    const newLabel = `${icons.plus}<span>מתכון חדש</span>`;
    $('#mr-new').innerHTML = newLabel;
    $('#mr-empty-new').innerHTML = newLabel;
    // Plain users have no recipes of their own: just what they saved.
    $('#mr-chips').hidden = !this.hasOwnRecipes;
    $('#mr-new').hidden = !this.hasOwnRecipes;
  },

  /**
   * On a phone the chips scroll sideways; fade whichever edge has more chips
   * beyond it, so it's always clear there's more to see.
   */
  setupChipFades() {
    const row = this.container.querySelector('#mr-chips');
    if (!row) return;
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      const pos = Math.abs(row.scrollLeft); // RTL scrolls to negative values
      row.classList.toggle('mr-more-start', pos > 2);
      row.classList.toggle('mr-more-end', max - pos > 2);
    };
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    this.updateChipFades = update;
    update();
    this.chipFadesCleanup = () => {
      row.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  },

  renderCounts() {
    Object.entries(this.counts).forEach(([view, count]) => {
      const el = this.container?.querySelector(`[data-count="${view}"]`);
      if (el) el.textContent = String(count);
    });
    this.updateChipFades?.(); // counts change the chips' width
  },

  applyView() {
    const config = VIEWS[this.view];
    const $ = (sel) => this.container.querySelector(sel);

    this.container.querySelectorAll('.mr-chip').forEach((chip) => {
      if (chip.dataset.view === this.view) chip.setAttribute('aria-current', 'page');
      else chip.removeAttribute('aria-current');
    });
    $('#mr-lede').textContent = config.lede;
    $('#mr-empty-title').textContent = config.emptyTitle;
    $('#mr-empty-text').textContent = config.emptyText;
    const toBook = config.toBook || !this.hasOwnRecipes;
    $('#mr-empty-new').hidden = toBook;
    $('#mr-empty-book').hidden = !toBook;

    // "Mark tested" on my to-try cards, in every view.
    $('#recipe-presentation-grid').toggleAttribute('show-mark-tested', this.hasOwnRecipes);
  },

  /** "Mark tested" on a card: the same service call as the recipe page menu. */
  async markTested(recipeId) {
    if (!recipeId) return;
    try {
      await RecipeService.markTested(recipeId);
      showToast('סומן כנבדק', 'success');
      await this.list?.reloadAndDisplay();
    } catch (error) {
      console.error('Error marking recipe tested:', error);
      showToast('לא הצלחנו לסמן את המתכון כנבדק. נסו שוב.', 'error');
    }
  },

  /** The empty state replaces the list only when the view has no recipes at all. */
  updateEmptyState() {
    const empty = this.viewTotal === 0;
    const list = this.container?.querySelector('#mr-list');
    const emptyWrap = this.container?.querySelector('#mr-empty-wrap');
    if (list) list.hidden = empty;
    if (emptyWrap) emptyWrap.hidden = !empty;
  },

  updateURL({ currentCategory, currentSearchQuery, activeFilters }) {
    const router = window.spa?.router;
    if (!router) return;
    const params = router.buildCategoriesParams(currentCategory, currentSearchQuery, activeFilters);
    if (this.view !== LIBRARY_VIEW.ALL) params.view = this.view;
    router.updateParams(params);
  },

  redirectToHome() {
    if (window.spa?.router) window.spa.router.navigate('/home');
    else window.location.href = '/';
  },
};
