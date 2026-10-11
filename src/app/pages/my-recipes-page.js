import authService from '../../js/services/auth/auth-service.js';
import { RecipeService, STAGE } from '../../js/services/recipes/recipe-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import { icons } from '../../js/icons.js';
import { RECIPE_STATUS } from '../../js/utils/recipes/recipe-status.js';
import { RecipeListController } from '../../lib/collections/recipe-list/recipe-list-controller.js';
import { showToast } from '../../lib/notifications/toast-notification/toast-notification.js';
import '../../styles/pages/categories-spa.css';
import '../../styles/pages/my-recipes-spa.css';

const TABS = {
  'to-try': {
    stage: STAGE.TO_TRY,
    lede: 'מתכונים ששמרתם ועוד לא ניסיתם. אחרי שתנסו, סמנו אותם כנבדקים והם יעברו לספרייה.',
    emptyTitle: 'אין כאן מתכונים לנסות',
    emptyText:
      'מצאתם מתכון באתר, בספר או על פתק? הוסיפו אותו בטופס המתכון החדש — אפשר לייבא מקישור או מתמונה — והוא יחכה כאן עד שתנסו.',
    // The "to try" badge is the point of this tab, so it stays.
    hideStatuses: '',
    showMarkTested: true,
  },
  library: {
    stage: STAGE.TESTED,
    lede: 'מתכונים שניסיתם ובדקתם. רק אתם רואים אותם, ומכאן אפשר לשלוח מתכון לספר המשפחתי.',
    emptyTitle: 'הספרייה עדיין ריקה',
    emptyText: 'מתכונים שניסיתם ובדקתם יופיעו כאן. כתבו מתכון משלכם, או סמנו כנבדק מתכון מ״לנסות״.',
    // Everything here is private; the badge would only repeat that.
    hideStatuses: RECIPE_STATUS.PRIVATE,
  },
};

// My library is the default tab; To try is `?tab=to-try`.
const tabFromParams = (params) => (params?.tab === 'to-try' ? 'to-try' : 'library');
const stageOf = (recipe) => (recipe.stage === STAGE.TO_TRY ? STAGE.TO_TRY : STAGE.TESTED);

/**
 * My recipes — the signed-in family member's private recipes, in two tabs:
 * "My library" (stage tested, the default) and "To try" (stage to-try).
 *
 * The list itself is the Categories list (RecipeListController + the same
 * filter, grid and cards); this page only supplies the data source, the tabs
 * and the empty state. Approved family and managers only.
 */
export default {
  async render() {
    const response = await fetch(new URL('./my-recipes-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(`Failed to load my recipes template: ${response.status}`);
    }
    return await response.text();
  },

  async mount(container, params) {
    const user = await authService.waitForAuth();
    const role = user ? await authService.getCurrentUserRole() : null;
    if (role !== 'approved' && role !== 'manager') {
      this.redirectToHome();
      return;
    }

    await this.importComponents();
    this.container = container;
    this.tab = tabFromParams(params);
    this.counts = { 'to-try': 0, library: 0 };
    this.renderStaticParts();

    this.list = new RecipeListController({
      loadRecipes: (args) => this.loadRecipes(args),
      onRecipesLoaded: () => this.updateEmptyState(),
      onUrlChanged: (state) => this.updateURL(state),
      context: 'My recipes page',
    });
    this.list.init({
      category: params?.category,
      searchQuery: params?.q,
      favoritesOnly: params?.favorites === 'true',
    });
    this.applyTab();

    this.onMarkTested = (event) => this.markTested(event.detail.recipeId);
    container
      .querySelector('#recipe-presentation-grid')
      ?.addEventListener('recipe-mark-tested', this.onMarkTested);

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
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
  },

  getTitle() {
    return AppConfig.getPageTitle('המתכונים שלי');
  },

  getMeta() {
    return { description: 'המתכונים הפרטיים שלי', keywords: 'מתכונים, לנסות, ספרייה' };
  },

  async handleRouteChange(params) {
    if (!this.list) return;
    const tab = tabFromParams(params);
    if (tab === this.tab) {
      await this.list.applyState({
        category: params?.category || 'all',
        searchQuery: params?.q || '',
        favoritesOnly: params?.favorites === 'true',
      });
      return;
    }

    // Switching tabs: a fresh list for the other stage, filters as in the URL.
    this.tab = tab;
    this.list.currentCategory = params?.category || 'all';
    this.list.currentSearchQuery = params?.q || '';
    this.list.filter?.setSearchQuery(this.list.currentSearchQuery);
    this.applyTab();
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
   * One query for both tabs (the counts need both); the current tab's stage
   * and the selected category are applied here.
   */
  async loadRecipes({ category }) {
    const uid = authService.getCurrentUser()?.uid;
    const all = await RecipeService.listMine(uid);

    this.counts = { 'to-try': 0, library: 0 };
    all.forEach((r) => {
      this.counts[stageOf(r) === STAGE.TO_TRY ? 'to-try' : 'library'] += 1;
    });
    this.renderCounts();

    const inTab = all.filter((r) => stageOf(r) === TABS[this.tab].stage);
    this.tabTotal = inTab.length;
    return category && category !== 'all' ? inTab.filter((r) => r.category === category) : inTab;
  },

  renderStaticParts() {
    const newLabel = `${icons.plus}<span>מתכון חדש</span>`;
    this.container.querySelector('#mr-new').innerHTML = newLabel;
    this.container.querySelector('#mr-empty-new').innerHTML = newLabel;
  },

  renderCounts() {
    Object.entries(this.counts).forEach(([tab, count]) => {
      const el = this.container?.querySelector(`[data-count="${tab}"]`);
      if (el) el.textContent = String(count);
    });
  },

  applyTab() {
    const config = TABS[this.tab];
    const $ = (sel) => this.container.querySelector(sel);

    this.container.querySelectorAll('.mr-tabs a').forEach((a) => {
      if (a.dataset.tab === this.tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#mr-lede').textContent = config.lede;
    $('#mr-empty-title').textContent = config.emptyTitle;
    $('#mr-empty-text').textContent = config.emptyText;
    $('#mr-empty-to-try').hidden = this.tab !== 'library';

    const grid = $('#recipe-presentation-grid');
    if (config.hideStatuses) grid.setAttribute('hide-statuses', config.hideStatuses);
    else grid.removeAttribute('hide-statuses');
    grid.toggleAttribute('show-mark-tested', !!config.showMarkTested);
  },

  /** "Mark tested" on a card: the same service call as the recipe page menu. */
  async markTested(recipeId) {
    if (!recipeId) return;
    try {
      await RecipeService.markTested(recipeId);
      showToast('סומן כנבדק — המתכון עבר לספרייה שלכם', 'success');
      await this.list?.reloadAndDisplay();
    } catch (error) {
      console.error('Error marking recipe tested:', error);
      showToast('לא הצלחנו לסמן את המתכון כנבדק. נסו שוב.', 'error');
    }
  },

  /** The empty state replaces the list only when the tab has no recipes at all. */
  updateEmptyState() {
    const empty = this.tabTotal === 0;
    const list = this.container?.querySelector('#mr-list');
    const emptyWrap = this.container?.querySelector('#mr-empty-wrap');
    if (list) list.hidden = empty;
    if (emptyWrap) emptyWrap.hidden = !empty;
  },

  updateURL({ currentCategory, currentSearchQuery, activeFilters }) {
    const router = window.spa?.router;
    if (!router) return;
    const params = router.buildCategoriesParams(currentCategory, currentSearchQuery, activeFilters);
    if (this.tab === 'to-try') params.tab = 'to-try';
    router.updateParams(params);
  },

  redirectToHome() {
    if (window.spa?.router) window.spa.router.navigate('/home');
    else window.location.href = '/';
  },
};
