// /my-recipes — the personal collection page.
// See docs/feature-plans/personal-collections.md, Slice 1.3 ("The collection
// page is a rail, not tabs") and the prototype at
// docs/feature-plans/prototypes/my-recipes.html for the design this
// implements.

import authService from '../../js/services/auth/auth-service.js';
import { CollectionService } from '../../js/services/users/collection-service.js';
import { RecipeService } from '../../js/services/recipes/recipe-service.js';
import { formatRecipeData } from '../../js/utils/recipes/recipe-data-utils.js';
import { buildCardFromRecipe } from '../../js/utils/recipes/recipe-card-utils.js';
import { AppConfig } from '../../js/config/app-config.js';
import '../../styles/pages/my-recipes-page.css';

const RAIL_STATES = ['rotation', 'to-try'];

export default {
  async render() {
    const response = await fetch(new URL('./my-recipes-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(`Failed to load template: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  },

  async mount(container) {
    this.container = container;

    this.currentUser = await authService.waitForAuth();
    if (!this.currentUser) {
      this.redirectToHome();
      return;
    }
    this.setupAuthObserver();

    this.state = {
      activeState: 'rotation',
      entriesByState: { rotation: [], 'to-try': [] },
    };

    // The page-manager keeps its loading spinner up until waitForReady()
    // resolves (with a 10s safety timeout) — the same contract my-meal-page
    // and recipe-detail-page use. mount() sets up and kicks off the first
    // load; waitForReady() gates the spinner on it.
    this._readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve;
    });

    await this.importComponents();
    this.cacheElements();
    this.setupRail();
    this.setupAddRecipeButton();

    this.loadAndRender();
  },

  /**
   * Kicked off by mount() (not awaited) and awaited by waitForReady(). Always
   * renders and resolves readiness — even on failure — so the spinner never
   * hangs.
   */
  async loadAndRender() {
    try {
      await this.loadCollection();
    } catch (error) {
      console.error('Error loading collection:', error);
    } finally {
      this.renderActiveState();
      this._resolveReady?.();
      this._resolveReady = null;
    }
  },

  async waitForReady() {
    if (this._readyPromise) await this._readyPromise;
  },

  unmount() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
    }
  },

  getTitle() {
    return AppConfig.getPageTitle('המתכונים שלי');
  },

  getMeta() {
    return {
      description: 'האוסף האישי שלך — מתכונים שאתה מבשל ומתכונים שרצית לנסות',
      keywords: 'מתכונים, אוסף אישי, לנסות, מטבח',
    };
  },

  redirectToHome() {
    this.navigate('/');
  },

  navigate(path) {
    if (window.spa?.router) {
      window.spa.router.navigate(path);
    } else {
      window.location.href = path;
    }
  },

  setupAuthObserver() {
    this.authUnsubscribe = authService.onAuthStateChanged((user) => {
      if (!user) {
        this.redirectToHome();
      }
    });
  },

  async importComponents() {
    await import('../../lib/collections/recipe-grid/recipe-presentation-grid.js');
  },

  cacheElements() {
    this.railButtons = Array.from(this.container.querySelectorAll('.rail__item[data-state]'));
    this.countEls = {
      rotation: this.container.querySelector('#rail-count-rotation'),
      'to-try': this.container.querySelector('#rail-count-to-try'),
    };
    this.gridEl = this.container.querySelector('#recipe-grid');
    this.emptyEl = this.container.querySelector('#empty-state');
    this.emptyArtEl = this.container.querySelector('#empty-art');
    this.emptyTitleEl = this.container.querySelector('#empty-title');
    this.emptyBodyEl = this.container.querySelector('#empty-body');
    this.emptyActionsEl = this.container.querySelector('#empty-actions');
    this.addBtn = this.container.querySelector('#add-recipe-btn');
  },

  setupRail() {
    this.railButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => this.selectState(btn.dataset.state));
      btn.addEventListener('keydown', (event) => this.handleRailKeydown(event, index));
    });
  },

  // Roving arrow-key navigation between the pinned rail entries — the rail
  // is the page's primary navigation (plan, Slice 1.3), so it gets a
  // keyboard pass beyond aria-current.
  handleRailKeydown(event, index) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (index + delta + this.railButtons.length) % this.railButtons.length;
    this.railButtons[nextIndex].focus();
  },

  selectState(state) {
    if (!RAIL_STATES.includes(state) || this.state.activeState === state) return;
    this.state.activeState = state;
    this.renderActiveState();
  },

  setupAddRecipeButton() {
    if (!this.addBtn) return;
    this.addBtn.addEventListener('click', () => this.openAddRecipeModal());
  },

  /**
   * Lazily loads and opens the private-authoring modal (Slice 1.5). The
   * modal is a singleton appended to `document.body` — like message-modal
   * and confirmation-modal elsewhere in the app — so repeated opens reuse
   * the same element and listener registration.
   */
  async openAddRecipeModal() {
    await import('../../lib/recipes/recipe_form_component/private_recipe_modal.js');
    let modal = document.querySelector('private-recipe-modal');
    if (!modal) {
      modal = document.createElement('private-recipe-modal');
      document.body.appendChild(modal);
      modal.addEventListener('recipe-added', () => this.handleRecipeAdded());
    }
    modal.openModal();
  },

  /**
   * Re-runs the same load the page does on mount so the newly-authored
   * recipe appears without a full page reload.
   */
  async handleRecipeAdded() {
    await this.loadCollection();
    this.renderActiveState();
  },

  /**
   * Two data sources, resolved before this returns (mount() awaits it) so
   * the page-manager's spinner contract sees one settled load — see the
   * plan's "Loading states" note. The orphan self-heal is wrapped so a
   * failure there degrades to "just the entries query", never a blank page.
   */
  async loadCollection() {
    const uid = this.currentUser.uid;
    let rotationEntries = [];
    let toTryEntries = [];
    try {
      [rotationEntries, toTryEntries] = await Promise.all([
        CollectionService.list(uid, { state: 'rotation' }),
        CollectionService.list(uid, { state: 'to-try' }),
      ]);
    } catch (error) {
      console.error('Error loading collection entries:', error);
    }

    const entriesById = new Map();
    rotationEntries.forEach((entry) => entriesById.set(entry.id, entry));
    toTryEntries.forEach((entry) => entriesById.set(entry.id, entry));

    await this.repairOrphanedOwnedRecipes(uid, entriesById);

    const buckets = { rotation: [], 'to-try': [] };
    entriesById.forEach((entry) => {
      const bucket = entry.state === 'rotation' ? 'rotation' : 'to-try';
      buckets[bucket].push(entry);
    });
    this.state.entriesByState = buckets;
  },

  /**
   * Self-heal: `recipes where userId == uid` (provable under the Stage 0
   * read rule via the isOwner disjunct) catches owned recipes whose
   * collection entry write failed or never ran — CollectionService.create
   * is not transactional with recipe creation. Resilient by design: any
   * failure here is logged and swallowed so the entries already loaded
   * still render.
   */
  async repairOrphanedOwnedRecipes(uid, entriesById) {
    try {
      const ownedRecipes = await RecipeService.list({ where: [['userId', '==', uid]] });
      const missing = ownedRecipes.filter((recipe) => !entriesById.has(recipe.id));
      if (missing.length === 0) return;

      const repaired = await Promise.all(
        missing.map((recipe) => this.repairOneOrphan(uid, recipe)),
      );
      repaired.forEach((entry) => entriesById.set(entry.id, entry));
    } catch (error) {
      console.error('Error querying owned recipes for self-heal:', error);
    }
  },

  /**
   * Persisting the entry is BEST-EFFORT: an owned recipe must render this
   * load whether or not the write lands (e.g. rules not yet deployed, a
   * transient failure). A failed write is retried on the next visit — it must
   * never drop the recipe from view, which is the whole point of the
   * self-heal. `_sourceRecipe` rides along for this render pass only (it
   * carries `visibility`, which the denormalised `card` map does not); it is
   * never persisted, so the written entry stays schema-correct.
   */
  async repairOneOrphan(uid, recipe) {
    const entry = {
      source: 'owned',
      state: 'to-try',
      card: buildCardFromRecipe(recipe),
    };
    try {
      await CollectionService.create(uid, recipe.id, entry);
    } catch (error) {
      console.error('Error persisting self-heal entry (will retry next load):', error);
    }
    return { ...entry, id: recipe.id, _sourceRecipe: recipe };
  },

  renderActiveState() {
    this.updateRailUI();
    const counts = {
      rotation: this.state.entriesByState.rotation.length,
      'to-try': this.state.entriesByState['to-try'].length,
    };
    const emptyType = this.determineEmptyState(counts, this.state.activeState);
    if (emptyType) {
      this.showEmptyState(emptyType);
    } else {
      this.showGrid(this.state.entriesByState[this.state.activeState]);
    }
  },

  updateRailUI() {
    this.railButtons.forEach((btn) => {
      btn.setAttribute('aria-current', String(btn.dataset.state === this.state.activeState));
    });
    this.countEls.rotation.textContent = String(this.state.entriesByState.rotation.length);
    this.countEls['to-try'].textContent = String(this.state.entriesByState['to-try'].length);
  },

  /**
   * Three distinct empty states (prototype Screen 2) — priority matters:
   * an entirely empty collection always wins, regardless of which rail
   * entry is active.
   * @returns {'whole-book'|'kitchen-empty'|'to-try-empty'|null}
   */
  determineEmptyState(counts, activeState) {
    if (counts.rotation === 0 && counts['to-try'] === 0) return 'whole-book';
    if (activeState === 'rotation' && counts.rotation === 0) return 'kitchen-empty';
    if (activeState === 'to-try' && counts['to-try'] === 0) return 'to-try-empty';
    return null;
  },

  getEmptyStateConfig(type) {
    const goToCategories = () => this.navigate('/categories');
    const goToToTry = () => this.selectState('to-try');
    const addRecipe = () => this.openAddRecipeModal();

    switch (type) {
      case 'whole-book':
        return {
          art: '📖',
          title: 'הספר שלך עדיין ריק',
          body: 'אפשר לשמור מתכונים מכל המתכונים, או להוסיף מתכון משלך — הוא יישאר פרטי עד שתחליט לשתף.',
          actions: [
            { label: '+ הוספת מתכון', primary: true, onClick: addRecipe },
            { label: 'עיון בכל המתכונים', primary: false, onClick: goToCategories },
          ],
        };
      case 'kitchen-empty':
        return {
          art: '🍳',
          title: 'המטבח שלך עדיין ריק',
          body: `יש לך ${this.state.entriesByState['to-try'].length} מתכונים ברשימת לנסות. כשתחליט שמתכון נשאר — אפשר להעביר אותו לכאן.`,
          actions: [{ label: 'לרשימת לנסות', primary: false, onClick: goToToTry }],
        };
      case 'to-try-empty':
        return {
          art: '✳️',
          title: 'אין כאן מתכונים לנסות',
          body: 'כל מה ששמרת כבר עבר למטבח שלך.',
          actions: [{ label: 'עיון בכל המתכונים', primary: false, onClick: goToCategories }],
        };
      default:
        return null;
    }
  },

  showEmptyState(type) {
    const config = this.getEmptyStateConfig(type);
    if (!config) return;

    this.gridEl.hidden = true;
    this.emptyEl.hidden = false;

    this.emptyArtEl.textContent = config.art;
    this.emptyTitleEl.textContent = config.title;
    this.emptyBodyEl.textContent = config.body;
    this.emptyActionsEl.innerHTML = '';
    config.actions.forEach((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn btn-sm ${action.primary ? 'btn-primary' : 'btn-ghost'}`;
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      this.emptyActionsEl.appendChild(btn);
    });
  },

  showGrid(entries) {
    this.emptyEl.hidden = true;
    this.gridEl.hidden = false;
    const recipes = entries.map((entry) => this.entryToRenderData(entry));
    if (typeof this.gridEl.setRecipes === 'function') {
      this.gridEl.setRecipes(recipes, true);
    }
  },

  /**
   * Adapts a collection entry to the shape recipe-card/recipe-presentation-
   * grid expect, without a recipe read — the grid must render from the
   * entry's denormalised `card` map alone (plan Constraints: "zero recipe
   * reads"). formatRecipeData's own defaults (prepTime 0, images []) cover
   * whatever the card map doesn't carry.
   */
  entryToRenderData(entry) {
    if (entry._sourceRecipe) {
      return formatRecipeData({ ...entry._sourceRecipe, id: entry.id });
    }
    const card = entry.card || {};
    return formatRecipeData({
      id: entry.id,
      name: card.name,
      category: card.category,
      prepTime: card.prepTime,
      images: card.primaryImage
        ? [{ full: card.primaryImage, isPrimary: true, access: 'public' }]
        : [],
    });
  },
};
