// TODO: test component before using
/**
 * ImageProposalModal Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * A modal interface for proposing new images for existing recipes.
 * Features multiple image upload, preview, and submission handling.
 *
 * @dependencies
 * - Requires Modal component (`custom-modal`)
 * - Requires ImageHandler component (`image-handler`)
 * - Firebase Storage for image upload
 * - Firebase Firestore for data management
 *
 * @example
 * // HTML
 * <image-proposal-modal></image-proposal-modal>
 *
 * // JavaScript
 * const modal = document.querySelector('image-proposal-modal');
 * modal.openForRecipe('recipe-123');
 */
import authService from '../../../js/services/auth/auth-service.js';
import { getRecipeById } from '../../../js/utils/recipes/recipe-data-utils.js';
import { RecipeImageProposalService } from '../../../js/services/recipes/recipe-image-proposal-service.js';

class ImageProposalModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.recipeId = null;
  }

  connectedCallback() {
    this.render();
    this.setResponsiveWidth();
    this.setupEventListeners();

    // Update width on window resize
    this.resizeHandler = () => this.setResponsiveWidth();
    window.addEventListener('resize', this.resizeHandler);
  }

  disconnectedCallback() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
  }

  setResponsiveWidth() {
    const modal = this.shadowRoot.querySelector('custom-modal');
    if (modal) {
      const isMobile = window.innerWidth <= 768;
      modal.setWidth(isMobile ? 'calc(100vw - 8px)' : '480px');
      if (isMobile) {
        modal.style.setProperty('--modal-outer-padding', '0px');
      } else {
        modal.style.removeProperty('--modal-outer-padding');
      }
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .proposal-modal {
          position: relative;
          font-family: var(--font-ui-he, sans-serif);
          width: 100%;
          box-sizing: border-box;
        }

        .proposal-header {
          margin-bottom: 20px;
          text-align: center;
        }

        .proposal-header h2 {
          font-family: var(--font-display, serif);
          font-size: 22px;
          color: var(--ink, #1f1d18);
          margin: 0;
        }

        .proposal-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        image-handler {
          display: block;
          width: 100%;
          box-sizing: border-box;
        }

        .button-container {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-top: 4px;
        }

        .btn {
          display: inline-flex; align-items: center; gap: 7px;
          font-family: var(--font-ui-he, sans-serif); font-size: 14px; font-weight: 500;
          padding: 10px 22px; border-radius: var(--r-sm, 8px); border: 1px solid transparent;
          cursor: pointer; transition: background var(--dur-1, 160ms), border-color var(--dur-1, 160ms);
        }

        .btn-primary {
          background: var(--primary, #6a994e); color: #fff; border-color: transparent;
        }

        .btn-primary:hover { background: var(--primary-dark, #386641); }

        .btn-quiet {
          background: transparent; color: var(--ink, #1f1d18); border-color: transparent;
        }

        .btn-quiet:hover { background: var(--surface-2, #f0ede6); }
      </style>

      <loading-spinner overlay border-radius="10px" size="60px" color="#ffffff">
        <custom-modal width="300px">
          <div class="proposal-modal">
            <div class="proposal-content">
              <div class="proposal-header">
                <h2>הצע תמונות למתכון</h2>
              </div>
              <form class="proposal-form">
                <image-handler></image-handler>
                <div class="button-container">
                  <button type="button" class="btn btn-quiet">ביטול</button>
                  <button type="submit" class="btn btn-primary">שלח תמונות</button>
                </div>
              </form>
            </div>
          </div>
        </custom-modal>
      </loading-spinner>
    `;
  }

  setupEventListeners() {
    const modal = this.shadowRoot.querySelector('custom-modal');
    const form = this.shadowRoot.querySelector('.proposal-form');
    const cancelButton = this.shadowRoot.querySelector('.btn-quiet');

    form.addEventListener('submit', (e) => this.handleSubmit(e));
    cancelButton.addEventListener('click', () => this.close());
  }

  openForRecipe(recipeId) {
    this.recipeId = recipeId;
    const modal = this.shadowRoot.querySelector('custom-modal');
    modal.open();
  }

  close() {
    const modal = this.shadowRoot.querySelector('custom-modal');
    modal.close();
  }

  async handleSubmit(event) {
    event.preventDefault();
    const imageHandler = this.shadowRoot.querySelector('image-handler');
    const images = imageHandler.getImages();

    if (!images.length) {
      // TODO: Show error message using message-modal
      return;
    }

    const spinner = this.shadowRoot.querySelector('loading-spinner');
    spinner.setAttribute('active', '');

    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) throw new Error('User not authenticated');
      const recipe = await getRecipeById(this.recipeId);
      if (!recipe) throw new Error('Recipe not found');
      const files = images.map((img) => img.file);
      const pendingImages = await RecipeImageProposalService.propose(
        this.recipeId,
        files,
        recipe.category,
        currentUser.uid,
      );
      // Dispatch success event
      this.dispatchEvent(
        new CustomEvent('images-proposed', {
          detail: { recipeId: this.recipeId, pendingImages },
          bubbles: true,
          composed: true,
        }),
      );
      this.close();
    } catch (error) {
      console.error('Error uploading images:', error);
      // TODO: Show error message using message-modal
    } finally {
      spinner.removeAttribute('active');
    }
  }
}

customElements.define('image-proposal-modal', ImageProposalModal);
