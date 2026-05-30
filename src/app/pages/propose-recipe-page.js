import authService from '../../js/services/auth/auth-service.js';
import { AppConfig } from '../../js/config/app-config.js';
import { icons } from '../../js/icons.js';
import '../../styles/pages/propose-recipe-spa.css';

export default {
  async render() {
    try {
      const response = await fetch(new URL('./propose-recipe-page.html', import.meta.url));
      if (!response.ok) {
        throw new Error(`Failed to load propose recipe template: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      console.error('Error loading propose recipe page template:', error);
      throw error;
    }
  },

  async mount(container, params) {
    try {
      this.isPreviewMode = false;
      await this.importComponents();

      await this.setupAuthentication(container);

      this.setupEventListeners();
      this.updatePreviewButton();
    } catch (error) {
      console.error('Error mounting propose recipe page:', error);
      this.handleError(error, 'mount');
    }
  },

  async unmount() {
    try {
      this.removeEventListeners();

      this.cleanupAuthListeners();
    } catch (error) {
      console.error('Error unmounting propose recipe page:', error);
    }
  },

  getTitle() {
    return AppConfig.getPageTitle('הצעת מתכון');
  },

  getMeta() {
    return {
      description:
        'Share your culinary creations with our community. Propose a recipe and inspire others with your cooking expertise.',
      keywords: 'recipe, cooking, share, community, culinary, propose recipe, cooking tips',
    };
  },

  async importComponents() {
    try {
      await Promise.all([
        import('../../lib/recipes/recipe_form_component/propose_recipe_component.js'),
        import('../../lib/recipes/recipe_component/recipe_component.js'),
        import('../../lib/modals/message-modal/message-modal.js'),
      ]);
    } catch (error) {
      console.error('Error importing components for propose recipe page:', error);
      throw error;
    }
  },

  async setupAuthentication(container) {
    const proposeRecipeForm = container.querySelector('propose-recipe-component');
    const loginPromptModal = document.querySelector('#login-prompt-modal');
    const authController = document.querySelector('auth-controller');
    const actionBar = document.querySelector('#propose-action-bar');

    if (!proposeRecipeForm) {
      console.warn('propose-recipe-component not found in container');
      return;
    }

    this.proposeRecipeForm = proposeRecipeForm;
    this.loginPromptModal = loginPromptModal;
    this.authController = authController;
    this.actionBar = actionBar;

    proposeRecipeForm.style.display = 'none';
    if (actionBar) actionBar.style.display = 'none';

    this.handleAuthStateChange = (isAuthenticated, isApproved) => {
      if (isAuthenticated) {
        // User is authenticated
        proposeRecipeForm.style.display = 'block';
        if (actionBar) actionBar.style.display = 'block';

        const importBtn = document.querySelector('#action-import');
        if (importBtn) {
          importBtn.style.display = isApproved ? '' : 'none';
        }

        if (typeof proposeRecipeForm.setFormDisabled === 'function') {
          proposeRecipeForm.setFormDisabled(false);
        }
        if (loginPromptModal && loginPromptModal.isOpen) {
          loginPromptModal.close();
        }
      } else {
        // User is NOT authenticated
        proposeRecipeForm.style.display = 'block';
        if (actionBar) actionBar.style.display = 'none';
        if (typeof proposeRecipeForm.setFormDisabled === 'function') {
          proposeRecipeForm.setFormDisabled(true);
        } else {
          console.warn('setFormDisabled method not found on proposeRecipeForm');
          proposeRecipeForm.style.display = 'none';
        }
        this.showLoginPrompt();
      }
    };

    authService.initialize();
    this.authObserver = (authState) => {
      this.handleAuthStateChange(authState.isAuthenticated, authState.isApproved);
    };
    authService.addAuthObserver(this.authObserver);
  },

  showLoginPrompt() {
    if (this.loginPromptModal && this.authController) {
      this.loginPromptModal.show(
        'רק משתמשים מחוברים יכולים להציע מתכונים. אנא התחבר או הירשם כדי להמשיך.',
        'נדרשת התחברות',
        'התחברות / הרשמה',
        () => {
          this.loginPromptModal.close();
          this.authController.openModal();
        },
      );
    }
  },

  setupEventListeners() {
    this.recipeProposedHandler = () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    document.addEventListener('recipe-proposed-success', this.recipeProposedHandler);

    const submitBtn = document.querySelector('#action-submit');
    const clearBtn = document.querySelector('#action-clear');
    const importBtn = document.querySelector('#action-import');
    const previewBtn = document.querySelector('#action-preview');

    if (submitBtn) {
      this.actionSubmitHandler = () => {
        if (this.proposeRecipeForm) this.proposeRecipeForm.submitForm();
      };
      submitBtn.addEventListener('click', this.actionSubmitHandler);
    }

    if (clearBtn) {
      this.actionClearHandler = () => {
        if (this.proposeRecipeForm) this.proposeRecipeForm.requestClear();
      };
      clearBtn.addEventListener('click', this.actionClearHandler);
    }

    if (importBtn) {
      this.actionImportHandler = () => {
        if (this.proposeRecipeForm) this.proposeRecipeForm.openImportModal();
      };
      importBtn.addEventListener('click', this.actionImportHandler);
    }

    if (previewBtn) {
      this.actionPreviewHandler = () => {
        this.togglePreviewMode();
      };
      previewBtn.addEventListener('click', this.actionPreviewHandler);
    }

    if (this.loginPromptModal) {
      this.modalClosedHandler = () => {
        if (!authService.isAuthenticated()) {
          // Navigate back to home if they close the prompt without logging in
          window.spa.router.navigate('/home');
        }
      };

      this.loginPromptModal.addEventListener('modal-closed-by-user', this.modalClosedHandler);
    }
  },

  removeEventListeners() {
    if (this.recipeProposedHandler) {
      document.removeEventListener('recipe-proposed-success', this.recipeProposedHandler);
      this.recipeProposedHandler = null;
    }

    const submitBtn = document.querySelector('#action-submit');
    const clearBtn = document.querySelector('#action-clear');
    const importBtn = document.querySelector('#action-import');
    const previewBtn = document.querySelector('#action-preview');
    if (submitBtn && this.actionSubmitHandler)
      submitBtn.removeEventListener('click', this.actionSubmitHandler);
    if (clearBtn && this.actionClearHandler)
      clearBtn.removeEventListener('click', this.actionClearHandler);
    if (importBtn && this.actionImportHandler)
      importBtn.removeEventListener('click', this.actionImportHandler);
    if (previewBtn && this.actionPreviewHandler)
      previewBtn.removeEventListener('click', this.actionPreviewHandler);

    if (this.loginPromptModal && this.modalClosedHandler) {
      this.loginPromptModal.removeEventListener('modal-closed-by-user', this.modalClosedHandler);
      this.modalClosedHandler = null;
    }
  },

  cleanupAuthListeners() {
    if (this.authObserver) {
      authService.removeAuthObserver(this.authObserver);
      this.authObserver = null;
    }
  },

  togglePreviewMode() {
    this.isPreviewMode = !this.isPreviewMode;

    const formSection = document.querySelector('#propose-form-section');
    const previewSection = document.querySelector('#propose-preview-section');
    const previewComponent = document.querySelector('#recipe-preview');
    const submitBtn = document.querySelector('#action-submit');
    const clearBtn = document.querySelector('#action-clear');
    const importBtn = document.querySelector('#action-import');
    const heroTitle = document.querySelector('.propose-hero__title');
    const heroDek = document.querySelector('.propose-hero__dek');

    if (this.isPreviewMode) {
      // Switching to Preview mode
      const formComponent =
        this.proposeRecipeForm.shadowRoot.querySelector('recipe-form-component');
      const recipeData = formComponent.getRecipeData();

      if (previewComponent) {
        previewComponent.setData(recipeData);
      }

      formSection.style.display = 'none';
      previewSection.style.display = 'block';

      if (submitBtn) submitBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      if (importBtn) importBtn.disabled = true;

      if (heroTitle) heroTitle.innerHTML = 'כך ייראה <em>המתכון שלך</em>';
      if (heroDek) heroDek.textContent = 'כפי שיופיע לאחר הפרסום';

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Switching back to Edit mode
      formSection.style.display = 'block';
      previewSection.style.display = 'none';

      if (submitBtn) submitBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
      if (importBtn) importBtn.disabled = false;

      if (heroTitle) heroTitle.innerHTML = 'הצע <em>מתכון</em> לספר.';
      if (heroDek) heroDek.textContent = 'כתוב אותו כפי שהיית מספר אותו לחבר.';
    }

    this.updatePreviewButton();
  },

  updatePreviewButton() {
    const iconContainer = document.querySelector('#preview-icon');
    const labelContainer = document.querySelector('#preview-label');

    if (iconContainer && labelContainer) {
      if (this.isPreviewMode) {
        iconContainer.innerHTML = icons.pencilAlt;
        labelContainer.textContent = 'חזור לעריכה';
      } else {
        iconContainer.innerHTML = icons.eye;
        labelContainer.textContent = 'תצוגה מקדימה';
      }
    }
  },

  handleError(error, context = 'unknown') {
    console.error(`Propose Recipe Page Error in ${context}:`, error);

    const errorContainer = document.querySelector('.spa-content .error-container');
    if (errorContainer) {
      errorContainer.innerHTML = `
        <div class="error-message">
          <h3>Error Loading Page</h3>
          <p>Sorry, we couldn't load the propose recipe page. Please try again.</p>
          <button id="propose-error-go-home" class="btn btn-primary">Go Home</button>
        </div>
      `;

      const goHomeButton = errorContainer.querySelector('#propose-error-go-home');
      if (goHomeButton) {
        goHomeButton.addEventListener('click', () => {
          window.spa.router.navigate('/home');
        });
      }
    }
  },
};
