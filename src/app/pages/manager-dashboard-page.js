import { FailedUrlExtractionService } from '../../js/services/admin/failed-url-extraction-service.js';
import { RecipeService, VISIBILITY } from '../../js/services/recipes/recipe-service.js';
import { RecipeSubmissionService } from '../../js/services/recipes/recipe-submission-service.js';
import { RecipeEditSuggestionService } from '../../js/services/recipes/recipe-edit-suggestion-service.js';
import { UserService } from '../../js/services/users/user-service.js';
import authService from '../../js/services/auth/auth-service.js';
import notificationService from '../../js/services/users/notification-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import { CATEGORY_MAP } from '../../js/utils/recipes/recipe-data-utils.js';
import { debounce } from '../../js/utils/common-utils.js';
import { icons } from '../../js/icons.js';
import {
  DashboardRefreshManager,
  DASHBOARD_SECTIONS,
} from '../../lib/utilities/dashboard-refresh-manager.js';

// Matches the mobile breakpoint in manager-dashboard-spa.css.
const MOBILE_QUERY = '(max-width: 768px)';
import '../../styles/pages/manager-dashboard-spa.css';

export default {
  async render(params) {
    const response = await fetch(new URL('./manager-dashboard-page.html', import.meta.url));
    if (!response.ok) {
      throw new Error(
        `Failed to load manager dashboard template: ${response.status} ${response.statusText}`,
      );
    }
    return await response.text();
  },

  async mount(container, params) {
    // Wait for authentication to be ready and check manager privileges
    const currentUser = await authService.waitForAuth();
    if (!currentUser) {
      this.redirectToHome();
      return;
    }

    const isManager = await this.checkManagerStatus(currentUser);
    if (!isManager) {
      this.redirectToHome();
      return;
    }

    await this.importComponents();
    this.setupSectionCollapse();
    this.initializeRefreshManager();
    this.initializeDashboard();
    this.setupAuthListener();
    this.setupRefreshIconListeners();
    this.setupEditRecipeListener();
    this.setupImageEnhancementListener();
    this.setupNotificationsBanner(currentUser);
  },

  async unmount() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
    }
    document.removeEventListener('recipe-updated', this._onRecipeUpdated);
    document.removeEventListener('image-enhanced-saved', this._onImageEnhancedSaved);
    this._mobileQuery?.removeEventListener('change', this._onMobileQueryChange);
  },

  getTitle() {
    return AppConfig.getPageTitle('Manager Dashboard');
  },

  getMeta() {
    return {
      description: 'Manager dashboard for recipe and user management',
      keywords: 'manager, dashboard, admin, recipes, users',
    };
  },

  async importComponents() {
    await Promise.all([
      import('../../lib/utilities/scrolling_list/scroll_list.js'),
      import('../../lib/recipes/recipe_preview_modal/edit_preview_recipe.js'),
      import('../../lib/recipes/recipe_preview_modal/recipe_preview_modal.js'),
      import('../../lib/recipes/suggest_edit_modal/edit-suggestion-review.js'),
      import('../../lib/modals/confirmation_modal/confirmation_modal.js'),
      import('../../lib/modals/message-modal/message-modal.js'),
      import('../../lib/media/image-carousel/image-carousel.js'),
      import('../../lib/utilities/modal/modal.js'),
      import('../../lib/utilities/loading-spinner/loading-spinner.js'),
      import('../../lib/media/image-handler/image-handler.js'),
      import('../../lib/media/ai-image-enhancer/ai-image-enhancer.js'),
    ]);
  },

  async checkManagerStatus(user) {
    try {
      const userDoc = await UserService.get(user.uid);
      if (userDoc) {
        return userDoc.role === 'manager';
      }
      return false;
    } catch (error) {
      console.error('Error checking manager status:', error);
      return false;
    }
  },

  redirectToHome() {
    // Use SPA navigation to redirect to home
    if (window.spa && window.spa.router) {
      window.spa.router.navigate('/home');
    } else {
      // Fallback to traditional redirect
      window.location.href = '/';
    }
  },

  setupAuthListener() {
    // Listen for auth state changes to detect logout
    this.authUnsubscribe = authService.onAuthStateChanged((user) => {
      if (!user) {
        // User logged out, redirect to home
        this.redirectToHome();
      }
    });
  },

  /**
   * On mobile every section starts collapsed to its header (title + count
   * badge) so the manager can scan all of them and open only what's relevant.
   * Collapsing is CSS-gated to the mobile breakpoint; desktop always shows all.
   */
  setupSectionCollapse() {
    this._mobileQuery = window.matchMedia(MOBILE_QUERY);
    const sections = document.querySelectorAll('.manager-dashboard .sections > section');

    const syncAria = () => {
      sections.forEach((section) => {
        const expanded = !this._mobileQuery.matches || !section.classList.contains('is-collapsed');
        section.querySelector('.section-toggle')?.setAttribute('aria-expanded', String(expanded));
      });
    };

    sections.forEach((section) => {
      section.classList.add('is-collapsed');
      const toggle = section.querySelector('.section-toggle');
      if (!toggle) return;
      toggle.querySelector('.section-chevron').innerHTML = icons.chevronDown;
      toggle.addEventListener('click', () => {
        if (!this._mobileQuery.matches) return;
        section.classList.toggle('is-collapsed');
        syncAria();
      });
    });

    this._onMobileQueryChange = syncAria;
    this._mobileQuery.addEventListener('change', this._onMobileQueryChange);
    syncAria();
  },

  /** Count badge in a section header; `attention` marks items awaiting action. */
  setSectionCount(sectionId, count, { attention = false } = {}) {
    const badge = document.querySelector(`#${sectionId} .section-badge`);
    if (!badge) return;
    badge.textContent = String(count);
    badge.hidden = false;
    badge.classList.toggle('section-badge--attention', attention && count > 0);
  },

  initializeRefreshManager() {
    // Create refresh manager instance
    this.refreshManager = new DashboardRefreshManager(this);

    // Register master refresh icon
    const masterRefreshIcon = document.getElementById('master-refresh');
    if (masterRefreshIcon) {
      this.refreshManager.registerIcon('master', masterRefreshIcon);
    }

    // Register section refresh icons
    const sectionIcons = document.querySelectorAll('.section-refresh');
    sectionIcons.forEach((icon) => {
      const section = icon.getAttribute('data-section');
      if (section) {
        this.refreshManager.registerIcon(section, icon);
      }
    });
  },

  setupRefreshIconListeners() {
    // Master refresh icon - refresh all dashboards
    const masterRefreshIcon = document.getElementById('master-refresh');
    if (masterRefreshIcon) {
      masterRefreshIcon.addEventListener('click', () => {
        this.refreshManager.refreshAll();
      });
    }

    // Section refresh icons - refresh individual sections
    const sectionIcons = document.querySelectorAll('.section-refresh');
    sectionIcons.forEach((icon) => {
      icon.addEventListener('click', () => {
        const section = icon.getAttribute('data-section');
        if (section) {
          this.refreshManager.refreshDashboards([section]);
        }
      });
    });
  },

  setupEditRecipeListener() {
    // Listen for recipe-updated events from edit-preview-recipe component.
    // Document-level, so keep the reference for unmount() — the page object
    // outlives each visit and would otherwise stack a listener per visit.
    this._onRecipeUpdated = (event) => {
      console.log('Recipe updated:', event.detail.recipeId);
      // Refresh both all recipes and pending recipes (edits require re-approval)
      this.refreshManager.refreshRecipes(600);
    };
    document.addEventListener('recipe-updated', this._onRecipeUpdated);
  },

  setupImageEnhancementListener() {
    // Bubbles up from <ai-image-enhance-modal> on successful save. The enhancer
    // refreshes itself for the affected recipe; here we refresh peer sections
    // that might surface the same recipe's images (currently all-recipes).
    this._onImageEnhancedSaved = () => {
      this.refreshManager.refreshDashboards([DASHBOARD_SECTIONS.ALL_RECIPES]);
    };
    document.addEventListener('image-enhanced-saved', this._onImageEnhancedSaved);
  },

  async setupNotificationsBanner(user) {
    const banner = document.getElementById('notifications-banner');
    const enableBtn = document.getElementById('enable-notifications-btn');
    const dismissBtn = document.getElementById('dismiss-notifications-btn');
    if (!banner || !enableBtn || !dismissBtn || !user) return;

    await notificationService.init();
    const status = await notificationService.getStatus();

    // Show only when the manager can still opt in. 'denied' (user blocked the
    // browser prompt) and 'unsupported' both leave the banner hidden — there's
    // nothing actionable to show.
    if (status !== 'default' && status !== 'granted-unregistered') return;

    banner.hidden = false;

    enableBtn.addEventListener('click', async () => {
      enableBtn.disabled = true;
      const prevText = enableBtn.textContent;
      enableBtn.textContent = 'מפעיל...';

      const result = await notificationService.requestPermissionAndRegister(user.uid);
      if (result.ok) {
        banner.hidden = true;
        this.showSuccess('התראות הופעלו במכשיר זה');
      } else {
        enableBtn.disabled = false;
        enableBtn.textContent = prevText;
        if (result.reason === 'denied') {
          this.handleError(
            new Error('הדפדפן חסם את ההתראות. כדי להפעיל, יש לאפשר התראות בהגדרות הדפדפן.'),
          );
          banner.hidden = true;
        } else {
          this.handleError(new Error('הפעלת ההתראות נכשלה. נסה שוב.'));
        }
      }
    });

    dismissBtn.addEventListener('click', () => {
      banner.hidden = true;
    });
  },

  initializeDashboard() {
    // Capture the first-load promises so waitForReady() can hold the page
    // spinner up until the sections have populated. Promise.allSettled keeps a
    // single failed section from stranding the loading overlay.
    this._dataReadyPromise = Promise.allSettled([
      this.loadUserList(),
      this.loadAllRecipes(),
      this.loadPendingRecipes(),
      this.loadPendingEdits(),
      this.loadFailedUrls(),
    ]);
  },

  async waitForReady() {
    if (this._dataReadyPromise) {
      await this._dataReadyPromise;
    }
  },

  /**
   * User Management
   */
  async loadUserList() {
    const userList = document.getElementById('user-list');
    userList.setItems([]); // Clear existing items first
    try {
      const users = await UserService.list();
      const userItems = users.map((user) => ({
        header: this.createHeader(user.email),
        content: this.createContent(user),
      }));
      userList.setItems(userItems);
      this.setSectionCount('user-management', users.length);
    } catch (error) {
      this.handleError(error);
    }
  },

  createHeader(email) {
    const header = document.createElement('div');
    header.style.cssText =
      'font-family: var(--font-ui-he); font-size: 14px; color: var(--ink);' +
      'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    header.textContent = email;
    return header;
  },

  createContent(user) {
    const content = document.createElement('div');
    content.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    const label = document.createElement('span');
    label.textContent = 'תפקיד:';
    label.style.cssText =
      'font-family: var(--font-ui-he); font-size: 11px; font-weight: 600;' +
      'letter-spacing: 0.08em; color: var(--ink-3); flex-shrink: 0;';

    const select = document.createElement('select');
    select.style.cssText =
      'flex: 1; padding: 7px 10px;' +
      'border: 1.5px solid var(--hairline-strong, rgba(31,29,24,0.15));' +
      'border-radius: var(--r-sm, 10px); font-family: var(--font-ui-he);' +
      'font-size: 13px; background: var(--surface-0); color: var(--ink); cursor: pointer; outline: none;';
    select.innerHTML = `
      <option value="user"     ${user.role === 'user' ? 'selected' : ''}>משתמש</option>
      <option value="approved" ${user.role === 'approved' ? 'selected' : ''}>מאושר</option>
      <option value="manager"  ${user.role === 'manager' ? 'selected' : ''}>מנהל</option>
    `;

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'שמור';
    saveBtn.style.cssText =
      'background: var(--primary); color: #fff; border: none;' +
      'padding: 7px 16px; border-radius: var(--r-pill, 999px);' +
      'font-family: var(--font-ui-he); font-size: 13px; font-weight: 500;' +
      'cursor: pointer; flex-shrink: 0;';
    saveBtn.addEventListener('mouseover', () => {
      saveBtn.style.background = 'var(--primary-dark)';
    });
    saveBtn.addEventListener('mouseout', () => {
      saveBtn.style.background = 'var(--primary)';
    });
    saveBtn.addEventListener('click', () => this.updateUserRole(user.id, select.value));

    content.appendChild(label);
    content.appendChild(select);
    content.appendChild(saveBtn);
    return content;
  },

  async updateUserRole(userId, newRole) {
    try {
      await UserService.update(userId, { role: newRole });
      this.showSuccess('תפקיד המשתמש עודכן בהצלחה', 'התפקיד עודכן');
    } catch (error) {
      this.handleError(error);
    }
  },

  /**
   * All Recipes
   */
  async loadAllRecipes() {
    const recipeList = document.getElementById('all-recipes-list');
    recipeList.setItems([]);
    const searchInput = document.getElementById('recipe-search');
    const filterSelect = document.getElementById('recipe-filter');

    try {
      // Managers can read private recipes too, so this list must ask for published ones.
      const recipes = await RecipeService.listPublished();
      this.allRecipes = recipes;
      this.setSectionCount('all-recipes', recipes.length);
      this.updateRecipeList(recipes);
      this.populateFilterOptions(recipes);

      // Create a debounced version of filterRecipes
      this.debouncedFilterRecipes = debounce(() => this.filterRecipes(), 300);

      // Set up event listeners
      searchInput.addEventListener('input', this.debouncedFilterRecipes);
      filterSelect.addEventListener('change', () => this.filterRecipes());
    } catch (error) {
      this.handleError(error);
    }
  },

  updateRecipeList(recipes) {
    const recipeList = document.getElementById('all-recipes-list');
    const recipeItems = recipes.map((recipe) => ({
      header: recipe.name,
      content: this.createRecipeContent(recipe),
    }));
    recipeList.setItems(recipeItems);
  },

  // Use central category mapping from single source of truth
  get categoryMapping() {
    return CATEGORY_MAP;
  },

  get reverseCategoryMapping() {
    return Object.fromEntries(Object.entries(CATEGORY_MAP).map(([key, value]) => [value, key]));
  },

  createRecipeContent(recipe) {
    const container = document.createElement('div');
    container.style.cssText =
      'display: flex; align-items: center; justify-content: space-between; gap: 10px;';

    const meta = document.createElement('div');
    meta.style.cssText = 'display: flex; gap: 6px;';
    const chipStyle =
      'background: var(--surface-2, #f0ede6);' +
      'border-radius: var(--r-pill, 999px);' +
      'padding: 3px 10px;' +
      'font-family: var(--font-ui-he, sans-serif);' +
      'font-size: 12px;' +
      'color: var(--ink, #1f1d18);';
    meta.innerHTML =
      `<span style="${chipStyle}">${this.categoryMapping[recipe.category] || '—'}</span>` +
      `<span style="${chipStyle}">${recipe.prepTime + recipe.waitTime} דק׳</span>`;

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 8px;';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'ערוך';
    editBtn.dataset.id = recipe.id;
    editBtn.style.cssText =
      'background: transparent; color: var(--primary-dark);' +
      'border: 1.5px solid var(--primary-dark); padding: 5px 14px;' +
      'border-radius: var(--r-pill, 999px); font-family: var(--font-ui-he);' +
      'font-size: 12px; font-weight: 500; cursor: pointer; flex-shrink: 0;';
    editBtn.addEventListener('mouseover', () => {
      editBtn.style.background = 'rgba(106,153,78,0.08)';
    });
    editBtn.addEventListener('mouseout', () => {
      editBtn.style.background = 'transparent';
    });
    editBtn.addEventListener('click', () => this.editRecipe(recipe));

    const deleteBtn = this._dangerPillBtn('מחק');
    deleteBtn.addEventListener('click', () => this.confirmDeleteRecipe(recipe));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    container.appendChild(meta);
    container.appendChild(actions);
    return container;
  },

  editRecipe(recipe) {
    const editPreviewContainer = document.querySelector('.edit-preview-container');
    editPreviewContainer.innerHTML = '';
    editPreviewContainer.innerHTML = `
      <edit-preview-recipe
        path-to-icon="/img/icon/other/"
        recipe-id="${recipe.id}"
        start-mode="edit"
        approve-on-save>
      </edit-preview-recipe>
    `;
    const editPreviewRecipe = document.querySelector('edit-preview-recipe');
    setTimeout(() => {
      editPreviewRecipe.openModal();
    }, 100);
  },

  confirmDeleteRecipe(recipe) {
    const modal = document.getElementById('delete-recipe-confirmation');
    const message = `האם אתה בטוח שברצונך למחוק את המתכון "${recipe.name}"? פעולה זו תמחק גם את כל המדיה המשויכת ואינה ניתנת לביטול.`;

    modal.confirm(message, 'מחיקת מתכון', 'מחק', 'ביטול');

    modal.addEventListener(
      'confirm-approved',
      () => {
        this.deleteRecipe(recipe.id, recipe.authorId);
      },
      { once: true },
    );
  },

  async deleteRecipe(recipeId, authorId) {
    try {
      this.toggleLoading(true);
      // Removes its family-book submission and share records too, so nothing points at it.
      await RecipeSubmissionService.deleteRecipe(recipeId, { authorId });
      this.showSuccess('המתכון נמחק בהצלחה', 'המתכון נמחק');
      this.refreshManager.refreshRecipes();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.toggleLoading(false);
    }
  },

  filterRecipes() {
    const searchTerm = document.getElementById('recipe-search').value.toLowerCase();
    const filterCategory = document.getElementById('recipe-filter').value;

    const filteredRecipes = this.allRecipes.filter(
      (recipe) =>
        recipe.name.toLowerCase().includes(searchTerm) &&
        (filterCategory === '' || recipe.category === this.reverseCategoryMapping[filterCategory]),
    );

    this.updateRecipeList(filteredRecipes);
  },

  populateFilterOptions(recipes) {
    const filterSelect = document.getElementById('recipe-filter');
    filterSelect.innerHTML = '<option value="">סינון לפי קטגוריה</option>';
    const categories = [...new Set(recipes.map((recipe) => this.categoryMapping[recipe.category]))];

    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      filterSelect.appendChild(option);
    });
  },

  /**
   * Pending Recipes
   */
  async loadPendingRecipes() {
    const pendingRecipesList = document.getElementById('pending-recipes-list');
    const pendingRecipeSection = document.getElementById('pending-recipes');
    const noPendingMessage = pendingRecipeSection.querySelector('.no-pending-message');

    try {
      // The approval queue: pending submissions (not every unpublished recipe — from
      // release 3a authors also keep private recipes they haven't submitted).
      const pending = await RecipeSubmissionService.listPending();
      // A rejection keeps a family member's recipe with a note; a plain user's
      // proposal is discarded (they have no library to see a note in).
      const authorIds = [...new Set(pending.map(({ recipe }) => recipe.authorId).filter(Boolean))];
      const authors = new Map(
        await Promise.all(
          authorIds.map(async (uid) => [uid, await UserService.get(uid).catch(() => null)]),
        ),
      );
      const recipeItems = pending.map((row) => ({
        header: this.createPendingRecipeHeader({
          ...row,
          author: authors.get(row.recipe.authorId),
        }),
        content: this.createPendingRecipeContent(row.recipe),
      }));

      this.setSectionCount('pending-recipes', recipeItems.length, { attention: true });

      // Always update the message based on current state
      if (recipeItems.length == 0) {
        noPendingMessage.textContent = 'אין מתכונים הממתינים לאישור';
      } else {
        noPendingMessage.textContent = ''; // Clear message when items exist
      }

      if (pendingRecipesList) {
        pendingRecipesList.setItems(recipeItems);
      } else {
        console.error('Cannot find scrolling list element');
      }
    } catch (error) {
      this.handleError(error);
    }
  },

  createPendingRecipeHeader({ recipe, submission, author }) {
    // Who sent it — shown to managers only (the public recipe carries no credit).
    const authorName = author?.fullName || author?.email || 'משתמש לא ידוע';
    const authorRole = author?.role;
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex; align-items:center; justify-content:space-between; gap:8px;';

    const info = document.createElement('div');
    info.style.cssText = 'display:flex; flex-direction:column; gap:2px; min-width:0;';

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;';

    const name = document.createElement('span');
    name.textContent = recipe.name;
    name.style.cssText =
      'font-family:var(--font-ui-he); font-size:14px; color:var(--ink);' +
      'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    nameRow.appendChild(name);

    // Flags from the design: submitted before it was tried; sent again after a rejection.
    const untested = recipe.stage === 'to-try';
    if (untested) nameRow.appendChild(this._queueFlag('עוד לא נוסה'));
    if (submission?.resubmittedAt) nameRow.appendChild(this._queueFlag('הגשה חוזרת', true));

    const sentAt = (submission?.resubmittedAt || submission?.createdAt)?.toDate?.();
    const sentDate = sentAt ? `${sentAt.getDate()}.${sentAt.getMonth() + 1}` : '';
    const cat = document.createElement('span');
    cat.textContent = [this.categoryMapping[recipe.category] || '—', authorName, sentDate]
      .filter(Boolean)
      .join(' · ');
    cat.style.cssText =
      'font-family:var(--font-mono); font-size:11px; color:var(--ink-3); letter-spacing:0.04em;';

    info.appendChild(nameRow);
    info.appendChild(cat);

    const btn = this._ghostPillBtn('הצג');
    btn.addEventListener('click', () =>
      this.previewRecipe(recipe.id, {
        name: recipe.name,
        sentBy: authorName,
        sentDate,
        untested,
        rejectMode: authorRole === 'user' ? 'discard' : 'note',
      }),
    );

    header.appendChild(info);
    header.appendChild(btn);
    return header;
  },

  _queueFlag(text, again = false) {
    // Inline like the rest of the row: the list renders rows in its Shadow DOM.
    const flag = document.createElement('span');
    flag.textContent = text;
    flag.style.cssText =
      'display:inline-flex; align-items:center; padding:2px 8px; border-radius:var(--r-pill);' +
      'font-family:var(--font-ui-he); font-size:11px; font-weight:600; color:var(--ink);' +
      `background:${again ? 'var(--surface-2)' : 'var(--neutral)'};`;
    return flag;
  },

  createPendingRecipeContent() {
    const content = document.createElement('div');
    content.style.cssText =
      'font-family:var(--font-ui-he); font-size:13px; color:var(--ink-3); font-style:italic;';
    content.textContent = 'לחץ על "הצג" לצפייה בפרטי המתכון המלאים';
    return content;
  },

  /**
   * Preview Recipe
   */
  previewRecipe(
    recipeId,
    { name = '', sentBy = '', sentDate = '', untested = false, rejectMode = 'note' } = {},
  ) {
    const previewContainer = document.querySelector('.preview-recipe-container');
    previewContainer.innerHTML = '';
    const preview = document.createElement('recipe-preview-modal');
    preview.id = 'recipe-preview';
    preview.setAttribute('recipe-id', recipeId);
    preview.setAttribute('recipe-name', name);
    preview.setAttribute('show-buttons', 'true');
    preview.setAttribute('reject-mode', rejectMode);
    if (untested) preview.setAttribute('untested', '');
    if (sentBy) preview.setAttribute('sent-by', sentBy);
    if (sentDate) preview.setAttribute('sent-date', sentDate);
    previewContainer.appendChild(preview);

    customElements.whenDefined('recipe-preview-modal').then(() => {
      const previewRecipeModal = document.querySelector('recipe-preview-modal');
      previewRecipeModal.openModal();

      previewRecipeModal.addEventListener('recipe-approved', () => {
        this.showSuccess(
          `״${name}״ נוסף לספר המשפחתי, ונשאר גם בספרייה של מי ששלח אותו. מעכשיו שינויים בו עוברים דרך הצעות עריכה.`,
          'פורסם בספר המשפחתי',
        );
        // Refresh the recipe dashboards immediately
        this.refreshManager.refreshRecipes();
      });

      previewRecipeModal.addEventListener('recipe-rejected', (event) => {
        console.log('Recipe rejected:', event.detail.recipeId);
        // Refresh the recipe dashboards with delay to allow animation to complete
        this.refreshManager.refreshRecipes(600);
      });
    });
  },

  /**
   * Pending Edit Suggestions
   */
  async loadPendingEdits() {
    const pendingEditsList = document.getElementById('pending-edits-list');
    const pendingEditsSection = document.getElementById('pending-edits');
    const noPendingMessage = pendingEditsSection.querySelector('.no-pending-message');

    try {
      const suggestions = await RecipeEditSuggestionService.listPending();
      // Count pending suggestions per recipe (from the already-fetched list) so
      // the manager knows when approving one will supersede others.
      const perRecipe = suggestions.reduce((map, s) => {
        map[s.recipeId] = (map[s.recipeId] || 0) + 1;
        return map;
      }, {});
      const items = suggestions.map((suggestion) => ({
        header: this.createPendingEditHeader(suggestion, perRecipe[suggestion.recipeId] || 1),
        content: this.createPendingEditContent(suggestion),
      }));

      this.setSectionCount('pending-edits', items.length, { attention: true });

      if (items.length === 0) {
        noPendingMessage.textContent = 'אין הצעות עריכה הממתינות לאישור';
      } else {
        noPendingMessage.textContent = '';
      }

      if (pendingEditsList) {
        pendingEditsList.setItems(items);
      } else {
        console.error('Cannot find pending edits list element');
      }
    } catch (error) {
      this.handleError(error);
    }
  },

  createPendingEditHeader(suggestion, pendingCount = 1) {
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex; align-items:center; justify-content:space-between; gap:8px;';

    const info = document.createElement('div');
    info.style.cssText = 'display:flex; flex-direction:column; gap:2px; min-width:0;';

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex; align-items:center; gap:6px; min-width:0;';

    const name = document.createElement('span');
    name.textContent = suggestion.recipeName || suggestion.recipeId;
    name.style.cssText =
      'font-family:var(--font-ui-he); font-size:14px; color:var(--ink);' +
      'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    nameRow.appendChild(name);

    // When a recipe has several pending suggestions, flag it — approving one
    // supersedes the rest.
    if (pendingCount > 1) {
      const chip = document.createElement('span');
      chip.textContent = `${pendingCount} הצעות`;
      chip.title = 'אישור הצעה אחת ידחה את היתר עבור מתכון זה';
      chip.style.cssText =
        'flex-shrink:0; background:rgba(188,71,73,0.1); color:var(--secondary-dark,#bc4749);' +
        'border-radius:var(--r-pill,999px); padding:1px 8px; font-family:var(--font-ui-he);' +
        'font-size:11px; font-weight:600;';
      nameRow.appendChild(chip);
    }

    const by = document.createElement('span');
    by.textContent = `הוצע על ידי ${suggestion.suggestedByName || suggestion.suggestedBy}`;
    by.style.cssText = 'font-family:var(--font-mono); font-size:11px; color:var(--ink-3);';

    info.appendChild(nameRow);
    info.appendChild(by);

    const btn = this._ghostPillBtn('הצג');
    btn.addEventListener('click', () => this.reviewSuggestion(suggestion));

    header.appendChild(info);
    header.appendChild(btn);
    return header;
  },

  createPendingEditContent(suggestion) {
    const content = document.createElement('div');
    content.style.cssText =
      'font-family:var(--font-ui-he); font-size:13px; color:var(--ink-3); font-style:italic;';
    content.textContent = suggestion.note
      ? `הערה: ${suggestion.note}`
      : 'לחץ על "הצג" לסקירת השינויים המוצעים';
    return content;
  },

  reviewSuggestion(suggestion) {
    const container = document.querySelector('.edit-suggestion-review-container');
    container.innerHTML = '';
    const review = document.createElement('edit-suggestion-review');
    container.appendChild(review);

    review.addEventListener('suggestion-approved', () => {
      this.showSuccess('הצעת העריכה אושרה והוחלה', 'אושר');
      this.refreshManager.refreshDashboards([
        DASHBOARD_SECTIONS.PENDING_EDITS,
        DASHBOARD_SECTIONS.ALL_RECIPES,
      ]);
    });

    review.addEventListener('suggestion-rejected', () => {
      this.showSuccess('הצעת העריכה נדחתה', 'נדחה');
      this.refreshManager.refreshPendingEdits(600);
    });

    customElements.whenDefined('edit-suggestion-review').then(() => {
      review.openForSuggestion(suggestion);
    });
  },

  /**
   * Image Enhancement section refresh — delegates to the <ai-image-enhancer>
   * component's public refresh() method.
   */
  async loadImageEnhancement() {
    const enhancer = document.getElementById('ai-image-enhancer');
    if (enhancer && typeof enhancer.refresh === 'function') {
      await enhancer.refresh();
    }
  },

  /**
   * Failed URLs
   */
  async loadFailedUrls() {
    const failedUrlsList = document.getElementById('failed-urls-list');
    const failedUrlsSection = document.getElementById('failed-urls');
    const noItemsMessage = failedUrlsSection.querySelector('.no-items-message');

    try {
      const failedUrls = await FailedUrlExtractionService.list();

      const items = failedUrls.map((item) => ({
        header: this.createFailedUrlHeader(item),
        content: this.createFailedUrlContent(item),
      }));

      this.setSectionCount('failed-urls', items.length, { attention: true });

      if (items.length === 0) {
        noItemsMessage.textContent = 'אין כתובות שנכשלו';
      } else {
        noItemsMessage.textContent = '';
      }

      if (failedUrlsList) {
        failedUrlsList.setItems(items);
      } else {
        console.error('Cannot find failed urls list element');
      }
    } catch (error) {
      this.handleError(error);
    }
  },

  createFailedUrlHeader(item) {
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:8px;';

    const urlSpan = document.createElement('span');
    urlSpan.textContent = item.url;
    urlSpan.title = item.url;
    urlSpan.style.cssText =
      'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' +
      'direction:ltr; font-family:var(--font-mono); font-size:12px; color:var(--ink-3); text-align:left;';

    const countChip = document.createElement('span');
    countChip.innerHTML = `${item.count}<span style="margin-inline-start:3px; opacity:0.75;">✕</span>`;
    countChip.style.cssText =
      'flex-shrink:0; background:rgba(188,71,73,0.08); border-radius:var(--r-pill,999px);' +
      'padding:2px 8px; font-family:var(--font-mono); font-size:11px; color:var(--secondary-dark,#bc4749);';

    header.appendChild(urlSpan);
    header.appendChild(countChip);
    return header;
  },

  createFailedUrlContent(item) {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex; flex-direction:column; gap:10px;';

    const errorMsg = document.createElement('div');
    errorMsg.textContent = item.error?.message || 'שגיאה לא ידועה';
    errorMsg.style.cssText =
      'font-family:var(--font-mono); font-size:12px; color:var(--secondary-dark,#bc4749); word-break:break-all;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px;';

    const detailsBtn = this._outlinePillBtn('פרטים נוספים');
    detailsBtn.addEventListener('click', () => this.showFullError(item));

    const copyBtn = this._outlinePillBtn('העתק');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(item.error, null, 2));
        this.showSuccess('השגיאה הועתקה ללוח');
      } catch (err) {
        this.handleError(new Error('כשל בהעתקה ללוח'));
      }
    });

    const deleteBtn = this._dangerPillBtn('מחק');
    deleteBtn.addEventListener('click', () => this.deleteFailedUrl(item.id));

    actions.appendChild(detailsBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);
    content.appendChild(errorMsg);
    content.appendChild(actions);
    return content;
  },

  /** Shared button helpers — inline styles so they work inside scrolling-list shadow DOM */
  _ghostPillBtn(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText =
      'background:transparent; color:var(--primary-dark); border:1.5px solid var(--primary-dark);' +
      'padding:5px 14px; border-radius:var(--r-pill,999px); font-family:var(--font-ui-he);' +
      'font-size:12px; font-weight:500; cursor:pointer; flex-shrink:0;';
    btn.addEventListener('mouseover', () => {
      btn.style.background = 'rgba(106,153,78,0.08)';
    });
    btn.addEventListener('mouseout', () => {
      btn.style.background = 'transparent';
    });
    return btn;
  },

  _outlinePillBtn(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText =
      'background:transparent; color:var(--ink-3); border:1.5px solid var(--hairline-strong,rgba(31,29,24,0.15));' +
      'padding:5px 14px; border-radius:var(--r-pill,999px); font-family:var(--font-ui-he);' +
      'font-size:12px; font-weight:500; cursor:pointer; flex-shrink:0;';
    btn.addEventListener('mouseover', () => {
      btn.style.background = 'var(--surface-2,#f0ede6)';
    });
    btn.addEventListener('mouseout', () => {
      btn.style.background = 'transparent';
    });
    return btn;
  },

  _dangerPillBtn(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText =
      'background:transparent; color:var(--secondary-dark,#bc4749); border:1.5px solid var(--secondary-dark,#bc4749);' +
      'padding:5px 14px; border-radius:var(--r-pill,999px); font-family:var(--font-ui-he);' +
      'font-size:12px; font-weight:500; cursor:pointer; flex-shrink:0;';
    btn.addEventListener('mouseover', () => {
      btn.style.background = 'rgba(188,71,73,0.08)';
    });
    btn.addEventListener('mouseout', () => {
      btn.style.background = 'transparent';
    });
    return btn;
  },

  showFullError(item) {
    const errorText = JSON.stringify(item.error, null, 2);
    const modal = document.getElementById('success-message-modal');
    modal.show(
      errorText,
      'פרטי שגיאה מלאים',
      'העתק שגיאה',
      async () => {
        try {
          await navigator.clipboard.writeText(errorText);
          this.showSuccess('השגיאה הועתקה ללוח');
        } catch (err) {
          this.handleError(new Error('כשל בהעתקה ללוח'));
        }
      },
      { monospace: true },
    );
  },

  async deleteFailedUrl(id) {
    const modal = document.getElementById('delete-recipe-confirmation');

    modal.confirm('האם אתה בטוח שברצונך למחוק רשומה זו?', 'מחיקת רשומה');

    modal.addEventListener(
      'confirm-approved',
      async () => {
        try {
          this.toggleLoading(true);
          await FailedUrlExtractionService.delete(id);
          this.loadFailedUrls();
          this.showSuccess('הרשומה נמחקה בהצלחה');
        } catch (error) {
          this.handleError(error);
        } finally {
          this.toggleLoading(false);
        }
      },
      { once: true },
    );
  },

  /**
   * Helper functions
   */
  toggleLoading(loading) {
    const spinner = document.getElementById('dashboard-spinner');
    if (loading) {
      spinner.setAttribute('active', '');
    } else {
      spinner.removeAttribute('active');
    }
  },

  showSuccess(message, title = 'הצלחה') {
    const modal = document.getElementById('success-message-modal');
    modal.show(message, title);
  },

  handleError(error) {
    console.error('Error:', error);
    const modal = document.getElementById('success-message-modal');
    modal.show(error.message || 'אירעה שגיאה. אנא נסה שנית.', 'שגיאה');
  },
};
