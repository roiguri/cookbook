import { AppConfig } from '../../js/config/app-config.js';
import { icons } from '../../js/icons.js';
import authService from '../../js/services/auth/auth-service.js';
import { ActiveMealService } from '../../js/services/meals/active-meal-service.js';
import { RecipeService, STAGE, VISIBILITY } from '../../js/services/recipes/recipe-service.js';
import { RecipeShareService } from '../../js/services/recipes/recipe-share-service.js';
import { RecipeSubmissionService } from '../../js/services/recipes/recipe-submission-service.js';
import { getRecipeStatus, RECIPE_STATUS } from '../../js/utils/recipes/recipe-status.js';
import { recipeShareText } from '../../js/utils/recipes/recipe-text.js';
import { shareOrCopy } from '../../js/utils/share.js';
import { showToast } from '../../lib/notifications/toast-notification/toast-notification.js';
import { createDropdownMenu } from '../../lib/utilities/dropdown-menu/dropdown-menu.js';
import '../../styles/pages/recipe-detail-spa.css';

export default {
  async render() {
    const response = await fetch(new URL('./recipe-detail-page.html', import.meta.url));

    if (!response.ok) {
      throw new Error(`Failed to load template: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  },

  async mount(container, params) {
    const recipeId = params.id;
    if (!recipeId) {
      this.showError(container, 'Recipe ID is required');
      return;
    }

    this.currentRecipe = null;
    this._notFound = false;
    this._menu = null;
    this._share = null;
    this._sharedByFor = null;
    this._sharedByPromise = null;
    this._prefetchedFor = null;
    this._servings = null;
    this.currentSubmission = undefined;
    this._submissionFor = null;

    try {
      await this.initializeRecipeComponent(container, recipeId);
      // The buttons are set up right away, with the recipe; the modals some menu
      // actions open load alongside, and those actions wait for them.
      this._componentsReady = this.importComponents();
      this.setupShareHandlers(container);
      this.setupMenuHandlers(container, recipeId);
      this.setupSuggestionListener(container);
      await this._componentsReady;
    } catch (error) {
      console.error('Failed to load recipe detail page:', error);
      this.showError(container, 'Failed to load recipe details');
    }
  },

  async initializeRecipeComponent(container, recipeId) {
    await import('../../lib/recipes/recipe_component/recipe_component.js');

    const recipeContainer = container.querySelector('.recipe-container');
    if (recipeContainer) {
      // Remove only existing recipe-component, preserve menu
      const existingComponent = recipeContainer.querySelector('recipe-component');
      if (existingComponent) {
        existingComponent.remove();
      }

      const recipeComponent = document.createElement('recipe-component');

      // Set up the listener before attaching to DOM and triggering fetch
      this._readyPromise = new Promise((resolve) => {
        recipeComponent.addEventListener('recipe-data-loaded', resolve, { once: true });
      });

      // Every load (including later recipe-id changes) reports whether the recipe was
      // found; a missing or hidden recipe swaps in the "not found" state.
      recipeComponent.addEventListener('recipe-data-loaded', (event) => {
        this.toggleNotFound(recipeContainer, event.detail?.found === false);
        // Only the fetch's event carries the recipe; keep the menu in step with it.
        if (event.detail && 'found' in event.detail) {
          this.currentRecipe = event.detail.recipe;
          this._servings = null; // a new recipe shows its own servings
          // The tab (and a share sheet's title) shows the recipe's name.
          if (this.currentRecipe?.name) {
            document.title = AppConfig.getPageTitle(this.currentRecipe.name);
          }
          this.refreshMenu();
        }
      });

      recipeComponent.setAttribute('recipe-id', recipeId);
      recipeContainer.appendChild(recipeComponent);

      // Handle navigation from related recipe cards inside the component
      recipeContainer.addEventListener('recipe-card-open', (event) => {
        const targetId = event.detail.recipeId;
        if (window.spa?.router) {
          window.spa.router.navigate(`/recipe/${targetId}`);
        } else {
          window.location.href = `${import.meta.env.BASE_URL}recipe/${targetId}`;
        }
      });
    } else {
      throw new Error('Recipe container not found in template');
    }
  },

  async importComponents() {
    // Import modal dependencies
    await import('../../lib/utilities/modal/modal.js');
    await import('../../lib/utilities/loading-spinner/loading-spinner.js');
    await import('../../lib/media/image-handler/image-handler.js');
    await import('../../lib/recipes/suggest_edit_modal/suggest-edit-modal.js');
    await import('../../lib/modals/message-modal/message-modal.js');
    await import('../../lib/modals/confirmation_modal/confirmation_modal.js');
    await import('../../lib/recipes/status-badge/status-badge.js');
  },

  setupMenuHandlers(container, recipeId) {
    const menu = container.querySelector('.recipe-menu');
    const menuButton = container.querySelector('.recipe-menu-button');
    const menuDropdown = container.querySelector('.recipe-menu-dropdown');
    const suggestEditBtn = container.querySelector('#suggest-edit-btn');
    const addToMealBtn = container.querySelector('#add-to-meal-btn');
    const markTestedBtn = container.querySelector('#mark-tested-btn');
    const markToTryBtn = container.querySelector('#mark-to-try-btn');
    const deleteBtn = container.querySelector('#delete-recipe-btn');
    const editBtn = container.querySelector('#edit-recipe-btn');
    const submitBtn = container.querySelector('#submit-recipe-btn');
    const resubmitBtn = container.querySelector('#resubmit-recipe-btn');
    const cancelSubmissionBtn = container.querySelector('#cancel-submission-btn');
    // The recipe shown now (the page can switch recipes in place).
    const currentId = () =>
      container.querySelector('recipe-component')?.getAttribute('recipe-id') || recipeId;

    if (!menu || !menuButton || !menuDropdown) {
      console.warn('Menu elements not found in container');
      return;
    }

    // Handlers are always attached; whether the menu shows is decided by
    // refreshMenu(), re-run when sign-in resolves or the recipe loads. (On a
    // fresh load sign-in may not be restored yet when the page mounts.)
    // (Image proposals go through "Suggest an edit"; the old "Suggest images" item was retired.)
    this._menu = {
      container,
      menu,
      menuDropdown,
      suggestEditBtn,
      addToMealBtn,
      markTestedBtn,
      markToTryBtn,
      deleteBtn,
      editBtn,
      submitBtn,
      resubmitBtn,
      cancelSubmissionBtn,
    };
    this._menuAuthUnsubscribe = authService.addAuthObserver(({ user: current }) => {
      // Sign-in is known now (either way): share appears together with ⋮.
      if (this._share) this._share.authKnown = true;
      // Signing out of a private recipe leaves the page at once (as My recipes
      // does); published recipes stay open to signed-out visitors.
      if (!current && this.currentRecipe?.visibility === VISIBILITY.PRIVATE) {
        this.currentRecipe = null;
        window.spa?.router?.navigate('/home');
        return;
      }
      this.refreshMenu();
    });

    // Open/close (button, outside tap, Escape, one menu at a time) — shared with share.
    this._menu.dropdown = createDropdownMenu({
      button: menuButton,
      dropdown: menuDropdown,
      root: menu,
    });

    // Handle "Suggest Edit" click
    if (suggestEditBtn) {
      suggestEditBtn.addEventListener('click', async () => {
        this.closeMenu();
        await this._componentsReady;
        const modal = container.querySelector('suggest-edit-modal');
        if (modal) {
          modal.openForRecipe(currentId());
        } else {
          console.error('Suggest edit modal not found');
        }
      });
    }

    // Handle "Add to Meal" click
    if (addToMealBtn) {
      addToMealBtn.addEventListener('click', async () => {
        this.closeMenu();
        await this._componentsReady;
        const currentUser = authService.getCurrentUser();
        if (!currentUser) return;

        try {
          const result = await ActiveMealService.addToMeal(currentUser.uid, currentId());

          const messageModal = container.querySelector('message-modal');

          if (messageModal) {
            if (result.success) {
              messageModal.show('המתכון נוסף לארוחה שלך בהצלחה', 'נוסף לארוחה');
            } else if (result.reason === 'duplicate') {
              messageModal.show('המתכון כבר נמצא בארוחה שלך', 'כבר קיים');
            } else {
              messageModal.show('שגיאה בהוספת המתכון לארוחה', 'שגיאה');
            }
          }
        } catch (error) {
          console.error('Error adding to meal:', error);
          const messageModal = container.querySelector('message-modal');
          if (messageModal) {
            messageModal.show('שגיאה בהוספת המתכון לארוחה', 'שגיאה');
          }
        }
      });
    }

    // Owner: mark a "to try" recipe as tested
    markTestedBtn?.addEventListener('click', async () => {
      this.closeMenu();
      try {
        await RecipeService.markTested(currentId());
        showToast('סומן כנבדק — המתכון עבר לספרייה שלכם', 'success');
        await container.querySelector('recipe-component')?.fetchAndPopulateRecipeData();
      } catch (error) {
        console.error('Error marking recipe tested:', error);
        showToast('לא הצלחנו לסמן את המתכון כנבדק. נסו שוב.', 'error');
      }
    });

    // Owner: move a tested recipe back to "to try" (private or published alike)
    markToTryBtn?.addEventListener('click', async () => {
      this.closeMenu();
      try {
        await RecipeService.markToTry(currentId());
        showToast('הוחזר ל״לנסות״', 'success');
        await container.querySelector('recipe-component')?.fetchAndPopulateRecipeData();
      } catch (error) {
        console.error('Error moving recipe back to try:', error);
        showToast('לא הצלחנו להחזיר את המתכון ל״לנסות״. נסו שוב.', 'error');
      }
    });

    // Owner: edit — the same editor (with preview) the manager dashboard uses,
    // without publishing on save. `onSaved` runs after a successful save.
    const openEditor = async (onSaved) => {
      this.closeMenu();
      await import('../../lib/recipes/recipe_preview_modal/edit_preview_recipe.js');
      container.querySelector('edit-preview-recipe')?.remove();
      const editor = document.createElement('edit-preview-recipe');
      editor.setAttribute('recipe-id', currentId());
      editor.setAttribute('start-mode', 'edit');
      container.appendChild(editor);
      editor.addEventListener('recipe-updated', async () => {
        await onSaved?.();
        await container.querySelector('recipe-component')?.fetchAndPopulateRecipeData();
      });
      requestAnimationFrame(() => editor.openModal());
    };
    editBtn?.addEventListener('click', () => openEditor());

    // Owner: a rejected recipe is fixed in the editor, then sent back to the queue.
    resubmitBtn?.addEventListener('click', () =>
      openEditor(async () => {
        try {
          await RecipeSubmissionService.resubmit(currentId());
          this.currentSubmission = undefined;
          this._submissionFor = null;
          showToast('המתכון נשלח שוב לאישור', 'success');
        } catch (error) {
          console.error('Error resubmitting recipe:', error);
          showToast('השינויים נשמרו, אבל השליחה מחדש נכשלה. נסו שוב.', 'error');
        }
      }),
    );

    // Owner: send a private recipe to the family book
    submitBtn?.addEventListener('click', async () => {
      this.closeMenu();
      await this._componentsReady;
      const recipe = this.currentRecipe;
      const untested = recipe?.stage === STAGE.TO_TRY;
      const confirmed = await this.getConfirmModal().confirm(
        (untested ? 'עוד לא ניסיתם את המתכון — אפשר לשלוח בכל זאת, אבל כדאי לנסות קודם. ' : '') +
          'מנהל יעבור על המתכון ויאשר אותו. עד אז הוא נשאר פרטי ואפשר להמשיך לערוך.',
        'לשלוח לספר המשפחתי?',
        'שליחה',
        'ביטול',
      );
      if (!confirmed) return;
      try {
        await RecipeSubmissionService.submit({
          recipeId: currentId(),
          authorId: authService.getCurrentUser()?.uid,
        });
        this._submissionFor = null;
        showToast('המתכון נשלח לאישור', 'success');
        this.refreshMenu();
      } catch (error) {
        console.error('Error submitting recipe:', error);
        showToast('לא הצלחנו לשלוח את המתכון. נסו שוב.', 'error');
      }
    });

    // Owner: cancel a pending submission
    cancelSubmissionBtn?.addEventListener('click', async () => {
      this.closeMenu();
      await this._componentsReady;
      const confirmed = await this.getConfirmModal().confirm(
        'המתכון יוסר מתור האישור ויישאר פרטי בספרייה שלכם.',
        'לבטל את השליחה?',
        'ביטול השליחה',
        'חזרה',
      );
      if (!confirmed) return;
      try {
        await RecipeSubmissionService.cancel(currentId());
        this._submissionFor = null;
        showToast('השליחה בוטלה', 'success');
        this.refreshMenu();
      } catch (error) {
        console.error('Error cancelling submission:', error);
        showToast('לא הצלחנו לבטל את השליחה. נסו שוב.', 'error');
      }
    });

    // Owner: delete a private recipe (with its photos, media and pending submission)
    deleteBtn?.addEventListener('click', async () => {
      this.closeMenu();
      await this._componentsReady;
      const recipe = this.currentRecipe;
      const id = currentId();
      const confirmed = await this.getConfirmModal().confirm(
        `״${recipe?.name || ''}״ יימחק מהספרייה שלכם יחד עם התמונות שלו. אי אפשר לבטל את זה.`,
        'למחוק את המתכון?',
        'מחיקה',
        'ביטול',
      );
      if (!confirmed) return;
      try {
        await RecipeSubmissionService.deleteRecipe(id, { authorId: recipe?.authorId });
        showToast('המתכון נמחק', 'success');
        const tab = recipe?.stage === STAGE.TO_TRY ? '?view=to-try' : '';
        window.spa?.router?.navigate(`/my-recipes${tab}`);
      } catch (error) {
        console.error('Error deleting recipe:', error);
        showToast('לא הצלחנו למחוק את המתכון. נסו שוב.', 'error');
      }
    });

    this.refreshMenu();
  },

  /**
   * Share (R1 in docs/archive/feature-plans/recipe-sharing.md): open to every reader of a
   * recipe that was found, signed out included. A published recipe offers its
   * link or the whole recipe as text; others can't open a private recipe's link,
   * so it goes straight to the text.
   */
  setupShareHandlers(container) {
    const wrap = container.querySelector('.recipe-share');
    const button = container.querySelector('#share-recipe-btn');
    const dropdown = container.querySelector('.share-menu');
    if (!wrap || !button || !dropdown) return;

    button.innerHTML = icons.share;
    const familyBtn = container.querySelector('#share-family-btn');
    const linkBtn = container.querySelector('#share-link-btn');
    const familyIcon = container.querySelector('#share-family-icon');
    if (familyIcon) familyIcon.outerHTML = icons.users;
    this._share = { container, wrap, button, dropdown, familyBtn, linkBtn, authKnown: false };
    // Appear when sign-in is known — the moment ⋮ is shown or not — so the two
    // buttons arrive together.
    authService.waitForAuth().finally(() => {
      if (!this._share) return;
      this._share.authKnown = true;
      this.refreshShare();
    });

    // The text uses the servings the reader chose on the page.
    container.addEventListener('servings-changed', (event) => {
      this._servings = event.detail?.servings || null;
    });

    // Same open/close behaviour as ⋮. Before opening, pick the items for this
    // recipe — or, for text-only recipes, share straight away instead.
    this._share.dropdown = createDropdownMenu({
      button,
      dropdown,
      root: wrap,
      beforeOpen: () => {
        if (!this.currentRecipe) return false;
        this.closeMenu();
        const mode = this.shareMode();
        if (mode === 'text') {
          this.shareRecipe('text');
          return false;
        }
        if (familyBtn) familyBtn.hidden = mode !== 'family';
        if (mode === 'family') this.prefetchFamily();
        if (linkBtn) linkBtn.hidden = mode !== 'published';
        return true;
      },
    });

    familyBtn?.addEventListener('click', () => {
      this.closeShareMenu();
      this.openFamilyPicker();
    });
    container.querySelector('#share-link-btn')?.addEventListener('click', () => {
      this.closeShareMenu();
      this.shareRecipe('link');
    });
    container.querySelector('#share-text-btn')?.addEventListener('click', () => {
      this.closeShareMenu();
      this.shareRecipe('text');
    });

    this.refreshShare();
  },

  closeMenu() {
    this._menu?.dropdown?.close();
  },

  closeShareMenu() {
    this._share?.dropdown?.close();
  },

  /**
   * What the share button offers for the current recipe and reader:
   * 'published' (link or text), 'family' (the author's private recipe: share
   * with family or text), or 'text' (anyone else's private recipe — its link
   * opens only for people with access).
   */
  shareMode() {
    const recipe = this.currentRecipe;
    if (!recipe) return 'text';
    if (recipe.visibility === VISIBILITY.PUBLISHED) return 'published';
    const user = authService.getCurrentUser();
    const isAuthor = !!user && recipe.authorId === user.uid && authService.isApproved();
    return isAuthor ? 'family' : 'text';
  },

  /**
   * Shown with the page once sign-in is known, at the same moment as ⋮ (hidden
   * for a missing recipe; a tap before the recipe arrives does nothing); a menu
   * unless it goes straight to text.
   */
  refreshShare() {
    const els = this._share;
    if (!els) return;
    const recipe = this._notFound ? null : this.currentRecipe;
    // ⋮ shows as soon as there's a user; signed-out pages learn it from the auth observer.
    els.wrap.hidden = this._notFound || !(els.authKnown || authService.getCurrentUser());
    if (!recipe) this.closeShareMenu();
    const mode = recipe ? this.shareMode() : 'text';
    if (mode !== 'text') els.button.setAttribute('aria-haspopup', 'menu');
    else els.button.removeAttribute('aria-haspopup');
    // The author's private recipe: load who to share with now, so the picker opens filled.
    if (mode === 'family' && this._prefetchedFor !== recipe.id) {
      this._prefetchedFor = recipe.id;
      this.prefetchFamily();
    }
    this.refreshSharedBy();
  },

  /**
   * A private recipe someone shared with the reader: "שותף איתך ע״י ‹name›"
   * under the title, and no author status (it's the author's, not theirs).
   * Looked up once per recipe and reader.
   */
  refreshSharedBy() {
    const recipe = this._notFound ? null : this.currentRecipe;
    const user = authService.getCurrentUser();
    const candidate =
      recipe && user && recipe.visibility !== VISIBILITY.PUBLISHED && recipe.authorId !== user.uid;
    const key = candidate ? `${recipe.id}:${user.uid}` : null;
    if (key === this._sharedByFor) return;
    this._sharedByFor = key;
    const component = () => this._share?.container.querySelector('recipe-component');
    component()?.setSharedBy(null);
    if (!candidate) return;
    this._sharedByPromise = RecipeShareService.getMine(recipe.id, user.uid).then((share) => {
      if (this._sharedByFor !== key || !share) return;
      component()?.setSharedBy(share.authorName);
      component()?.setStatus(null);
    });
  },

  /** The picker modal, created on first use. */
  async getFamilyModal() {
    await import('../../lib/recipes/share-family-modal/share-family-modal.js');
    let modal = document.getElementById('share-family-modal');
    if (!modal) {
      modal = document.createElement('share-family-modal');
      modal.id = 'share-family-modal';
      document.body.appendChild(modal);
    }
    return modal;
  },

  /** Start loading who to share with as the menu opens, so the picker opens filled. */
  async prefetchFamily() {
    const recipe = this.currentRecipe;
    const user = authService.getCurrentUser();
    if (!recipe || !user) return;
    (await this.getFamilyModal()).prefetch({ recipeId: recipe.id, authorId: user.uid });
  },

  /** The author shares their private recipe with family (the picker modal). */
  async openFamilyPicker() {
    const recipe = this.currentRecipe;
    const user = authService.getCurrentUser();
    if (!recipe || !user) return;
    const modal = await this.getFamilyModal();
    const profile = await authService.getUserData().catch(() => null);
    modal.openFor({
      recipeId: recipe.id,
      recipeName: recipe.name,
      authorId: user.uid,
      authorName: profile?.fullName || user.displayName || '',
      url: new URL(`${import.meta.env.BASE_URL}recipe/${recipe.id}`, window.location.origin).href,
    });
  },

  /**
   * Send the current recipe through the share sheet, or copy it when the
   * browser has none.
   * @param {'link'|'text'} kind - The link (published recipes) or the whole recipe.
   */
  async shareRecipe(kind) {
    const recipe = this.currentRecipe;
    if (!recipe) return;
    const url =
      recipe.visibility === VISIBILITY.PUBLISHED
        ? new URL(`${import.meta.env.BASE_URL}recipe/${recipe.id}`, window.location.origin).href
        : undefined;
    try {
      let result;
      if (kind === 'link' && url) {
        result = await shareOrCopy({ title: recipe.name, text: recipe.name, url }, url);
      } else {
        const text = recipeShareText(recipe, { servings: this._servings, url });
        result = await shareOrCopy({ title: recipe.name, text }, text);
      }
      if (result === 'copied')
        showToast(kind === 'link' ? 'הקישור הועתק' : 'המתכון הועתק', 'success');
    } catch (error) {
      console.error('Error sharing recipe:', error);
      showToast('לא הצלחנו להעתיק. נסו שוב.', 'error');
    }
  },

  /** One confirmation dialog for the page, created on first use. */
  getConfirmModal() {
    let modal = document.getElementById('recipe-confirm-modal');
    if (!modal) {
      modal = document.createElement('confirmation-modal');
      modal.id = 'recipe-confirm-modal';
      document.body.appendChild(modal);
    }
    return modal;
  },

  /**
   * The ⋮ menu: shown to signed-in readers of a recipe that was found. The
   * author of a private recipe (approved family and managers) gets its status
   * (the shared status badge + date) and the owner actions; everyone else gets
   * the regular menu.
   */
  refreshMenu() {
    // Share follows the same recipe / not-found state.
    this.refreshShare();
    const els = this._menu;
    if (!els) return;
    const recipe = this.currentRecipe;
    const user = authService.getCurrentUser();

    // Every menu action needs a signed-in user, so signed-out visitors get no menu.
    els.menu.style.display = user && !this._notFound ? '' : 'none';
    if (!user || this._notFound) this.closeMenu();
    if (els.addToMealBtn) els.addToMealBtn.style.display = 'flex';

    const isPrivate = recipe?.visibility === VISIBILITY.PRIVATE;
    // The owner menu is for family members with a library of their own (approved,
    // managers) — their private recipes and, since publishing is in place, their
    // published ones. A plain user's own recipe is a proposal awaiting approval.
    const isMine = !!recipe && !!user && recipe.authorId === user.uid && authService.isApproved();
    const toTry = recipe?.stage === STAGE.TO_TRY;

    // The author's submission (pending / rejected / approved), loaded once per recipe.
    if (isMine && this._submissionFor !== recipe.id) {
      this._submissionFor = recipe.id;
      this.currentSubmission = undefined;
      RecipeSubmissionService.get(recipe.id)
        .catch(() => null)
        .then((submission) => {
          if (this.currentRecipe?.id !== recipe.id) return;
          this.currentSubmission = submission || null;
          this.refreshMenu();
        });
    }
    const submission = isMine ? this.currentSubmission : undefined;
    const submissionStatus = submission?.status;
    const status = isMine ? getRecipeStatus({ ...recipe, submissionStatus, ownView: true }) : null;
    if (isMine) els.container.querySelector('recipe-component')?.setStatus(status);

    els.menuDropdown.classList.toggle('own-menu', isMine);
    els.container.querySelector('#own-status').hidden = !isMine;
    const text = els.container.querySelector('#own-status-text');
    const note = els.container.querySelector('#own-status-note');
    text.hidden = true;
    note.hidden = true;
    if (isMine) {
      els.container.querySelector('#own-status-badge').setAttribute('status', status);
      const date = (t) => {
        const d = t?.toDate?.() ?? (t ? new Date(t) : null);
        return d && !isNaN(d) ? `<span class="num">${d.getDate()}.${d.getMonth() + 1}</span>` : '';
      };
      const sentAt = submission?.resubmittedAt || submission?.createdAt;
      const when = {
        [RECIPE_STATUS.PUBLISHED]: submission?.reviewedAt
          ? `בספר המשפחתי · אושר ב־${date(submission.reviewedAt)}`
          : 'בספר המשפחתי',
        [RECIPE_STATUS.PENDING]: `נשלח ב־${date(sentAt)}`,
        [RECIPE_STATUS.REJECTED]: `נשלח ב־${date(sentAt)} · נבדק ב־${date(submission?.reviewedAt)}`,
        [RECIPE_STATUS.TO_TRY]: `נשמר ב־${date(recipe.creationTime)} · עוד לא נוסה`,
        [RECIPE_STATUS.PRIVATE]: `בספרייה שלכם · נבדק ב־${date(recipe.testedAt || recipe.creationTime)}`,
      };
      els.container.querySelector('#own-status-when').innerHTML = when[status] || '';
      if (status === RECIPE_STATUS.PENDING) {
        text.textContent =
          'מחכה לאישור מנהל. בינתיים המתכון נשאר פרטי ואפשר להמשיך לערוך — המנהל יראה את הגרסה העדכנית.';
        text.hidden = false;
      }
      if (status === RECIPE_STATUS.REJECTED && submission?.rejectionReason) {
        note.innerHTML = '<b>הערה ממנהלי הספר</b>';
        note.append(submission.rejectionReason);
        note.hidden = false;
      }
    }

    const show = (el, visible) => {
      if (el) el.hidden = !visible;
    };
    show(els.markTestedBtn, isMine && toTry);
    show(els.markToTryBtn, isMine && !toTry);
    // "Send" waits until we know there's no submission yet.
    show(els.submitBtn, isMine && isPrivate && submission === null);
    show(els.editBtn, isMine && isPrivate && submissionStatus !== 'rejected');
    show(els.resubmitBtn, isMine && isPrivate && submissionStatus === 'rejected');
    show(els.cancelSubmissionBtn, isMine && submissionStatus === 'pending');
    show(els.deleteBtn, isMine && isPrivate);
    // Edit suggestions are for published recipes only.
    if (els.suggestEditBtn) els.suggestEditBtn.style.display = isPrivate ? 'none' : 'flex';
  },

  setupSuggestionListener(container) {
    const messageModal = container.querySelector('message-modal');
    if (!messageModal) {
      console.warn('Message modal not found');
      return;
    }

    // Listen for successfully submitted edit suggestions
    const suggestEditModal = container.querySelector('suggest-edit-modal');
    if (suggestEditModal) {
      suggestEditModal.addEventListener('edit-suggested', () => {
        messageModal.show('העריכה נשלחה לאישור מנהל', 'נשלח לאישור');
      });
    }
  },

  toggleNotFound(recipeContainer, notFound) {
    const component = recipeContainer.querySelector('recipe-component');
    let block = recipeContainer.querySelector('.recipe-not-found');

    // style.display, not `hidden`: the component's :host display rule overrides the attribute.
    if (component) component.style.display = notFound ? 'none' : '';
    this._notFound = notFound;
    this.refreshMenu();
    if (!notFound) {
      block?.remove();
      return;
    }

    if (block) return;

    // Markup and copy follow the "NotFound" artboard in the Cookbook screens canvas.
    const signedOut = !authService.getCurrentUser();
    block = document.createElement('section');
    block.className = 'recipe-not-found nf';
    block.setAttribute('dir', 'rtl');
    block.setAttribute('aria-labelledby', 'nf-title');
    block.innerHTML = `
      <div class="nf__card card">
        <svg class="nf__art" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="60" cy="62" r="34"></circle>
          <circle class="accent" cx="60" cy="62" r="23" stroke-dasharray="3 5"></circle>
          <path d="M14 26v18M10 26v14a4 4 0 0 0 8 0V26M14 48v52"></path>
          <path d="M106 48v52"></path>
          <ellipse cx="106" cy="36" rx="6" ry="11"></ellipse>
        </svg>
        <span class="eyebrow nf__eyebrow">מתכון לא נמצא</span>
        <h1 id="nf-title" class="heading-2-he nf__title">המתכון הזה לא זמין</h1>
        <p class="body-text-he nf__lede">
          ייתכן שהקישור שגוי, שהמתכון הוסר, או שהוא שמור כמתכון פרטי שרק בעליו יכולים לראות.
        </p>
        <div class="nf__actions">
          <a class="btn btn-primary btn-lg" href="/categories" data-route="/categories">לכל המתכונים</a>
          <a class="btn btn-ghost btn-lg" href="/home" data-route="/home">לדף הבית</a>
        </div>
        ${
          signedOut
            ? `<div class="nf__owner">
                 <p><b>זה מתכון שלכם?</b>מתכונים פרטיים מוצגים רק אחרי התחברות.</p>
                 <button type="button" class="btn btn-ghost nf__login">התחברות</button>
               </div>`
            : ''
        }
      </div>
    `;

    block.querySelectorAll('a[data-route]').forEach((link) => {
      link.addEventListener('click', (event) => {
        if (window.spa?.router) {
          event.preventDefault();
          window.spa.router.navigate(link.dataset.route);
        }
      });
    });

    // Signed-out visitors may be the author of a pending recipe: after signing in,
    // reload so the recipe (and the signed-in menu) can show.
    block.querySelector('.nf__login')?.addEventListener('click', (event) => {
      document.querySelector('auth-controller')?.openModal(event.currentTarget);
      if (this._reloadOnSignIn) return;
      this._reloadOnSignIn = (authEvent) => {
        if (authEvent.detail?.user) window.location.reload();
      };
      document.addEventListener('auth-state-changed', this._reloadOnSignIn);
    });

    recipeContainer.appendChild(block);
    document.title = AppConfig.getPageTitle('המתכון לא נמצא');
  },

  showError(container, message) {
    container.innerHTML = `
      <div class="page-error">
        <div class="error-card">
          <h2>Error Loading Recipe</h2>
          <p>Sorry, there was an error loading this recipe.</p>
          <div class="error-details" id="recipe-error-details"></div>
          <button class="reload-button" id="back-button">
            ← Go Back
          </button>
        </div>
      </div>
    `;

    const errorDetails = container.querySelector('#recipe-error-details');
    const backButton = container.querySelector('#back-button');

    errorDetails.textContent = message;
    backButton.addEventListener('click', () => {
      history.back();
    });
  },

  async unmount() {
    // Clean up menu event listeners
    this._menu?.dropdown?.destroy();
    if (this._menuAuthUnsubscribe) {
      this._menuAuthUnsubscribe();
      this._menuAuthUnsubscribe = null;
    }
    this._menu = null;
    this._share?.dropdown?.destroy();
    this._share = null;
    this._sharedByFor = null;
    document.getElementById('share-family-modal')?.close();
    if (this._reloadOnSignIn) {
      document.removeEventListener('auth-state-changed', this._reloadOnSignIn);
      this._reloadOnSignIn = null;
    }
  },

  // The overlay stays until the recipe and, for a recipe shared with the reader,
  // the "shared with you" line are in place (no jump, no author status flash).
  async waitForReady(container) {
    if (this._readyPromise) {
      await this._readyPromise;
    }
    await authService.waitForAuth(3000).catch(() => null);
    this.refreshShare();
    await this._sharedByPromise;
  },

  async handleRouteChange(params) {
    // This method is called when navigating from one recipe to another
    // (e.g., when searching from a recipe page and finding a single match)
    const newRecipeId = params.id;
    if (!newRecipeId) {
      console.error('No recipe ID provided in route change');
      return;
    }

    // Find the current recipe component and update its recipe-id attribute
    const recipeContainer = document.querySelector('.recipe-container');
    if (recipeContainer) {
      const recipeComponent = recipeContainer.querySelector('recipe-component');
      if (recipeComponent) {
        // Update the recipe-id attribute, which will trigger the component to reload
        recipeComponent.setAttribute('recipe-id', newRecipeId);
      } else {
        // If component doesn't exist, reinitialize it
        await this.initializeRecipeComponent(recipeContainer, newRecipeId);
      }
    }

    // Update page title and metadata
    const title = this.getTitle(params);
    if (title) {
      document.title = title;
    }
  },

  // Until the recipe loads; then the page shows its name (initializeRecipeComponent).
  getTitle() {
    return AppConfig.getPageTitle();
  },

  getMeta() {
    return {
      description: 'View detailed recipe instructions, ingredients, and cooking tips.',
      keywords: 'recipe, cooking, instructions, ingredients, kitchen',
    };
  },

  stylePath: '/src/styles/pages/recipe-detail-spa.css',
};
