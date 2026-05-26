/**
 * ImageApprovalMulti Component
 * @class
 * @extends HTMLElement
 *
 * @description
 * A modal interface for approving or rejecting multiple recipe images in batch.
 * Shows all pending images for a recipe together, allowing the admin to:
 * - View all proposed images in one place
 * - Reorder images (drag-drop via image-handler)
 * - Set primary image
 * - Approve or reject images individually or in batch
 *
 * @dependencies
 * - Requires Modal component (`custom-modal`)
 * - Requires ImageHandler component (`image-handler`)
 * - Requires LoadingSpinner component (`loading-spinner`)
 * - Firebase Storage for image URL retrieval
 * - Firebase Firestore for data management
 *
 * @example
 * // HTML
 * <image-approval-multi></image-approval-multi>
 *
 * // JavaScript
 * const modal = document.querySelector('image-approval-multi');
 * modal.openForRecipe({
 *   id: 'recipe123',
 *   name: 'Chocolate Cake',
 *   pendingImages: [...],
 *   category: 'desserts'
 * });
 *
 * @fires images-approved - When images are approved
 * @fires images-rejected - When images are rejected
 */

import { RecipeImageService } from '../../../js/services/recipes/recipe-image-service.js';
import { RecipeService } from '../../../js/services/recipes/recipe-service.js';
import { RecipeImageProposalService } from '../../../js/services/recipes/recipe-image-proposal-service.js';

class ImageApprovalMulti extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.recipe = null;
    this.selectedImageIds = new Set();
    this.primaryImageId = null; // Track admin's primary image choice
  }

  connectedCallback() {
    this.render();
    this.setResponsiveWidth();
    this.setupEventListeners();

    this.resizeHandler = () => this.setResponsiveWidth();
    window.addEventListener('resize', this.resizeHandler);
  }

  disconnectedCallback() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }

    if (this.imageObserver) {
      this.imageObserver.disconnect();
    }
  }

  setResponsiveWidth() {
    const modal = this.shadowRoot.querySelector('custom-modal');
    if (modal) {
      const isMobile = window.innerWidth <= 768;
      modal.setWidth(isMobile ? 'calc(100vw - 16px)' : '700px');
      if (isMobile) {
        modal.style.setProperty('--modal-outer-padding', '0px');
      } else {
        modal.style.removeProperty('--modal-outer-padding');
      }
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${this.styles()}</style>
      <loading-spinner overlay border-radius="10px" size="60px" color="#ffffff">
        <custom-modal width="90vw" height="auto" fullscreen-mobile>
          <div class="approval-container">
            <h2>אישור תמונות</h2>

            <div class="metadata" id="metadata"></div>

            <div class="images-section">
              <div class="loading-state" id="loading-state">
                <p>טוען תמונות...</p>
              </div>
              <image-handler id="pending-images-viewer" hide-upload></image-handler>
            </div>

            <div class="selection-info" id="selection-info">
              <p>בחר תמונות על ידי לחיצה על כפתור "בחר" מתחת לכל תמונה</p>
            </div>

            <div class="actions">
              <button id="approve-selected" class="btn btn-approve" disabled>אשר נבחרות</button>
              <button id="reject-selected" class="btn btn-reject" disabled>דחה נבחרות</button>
              <button id="approve-all" class="btn btn-approve-all">אשר הכל</button>
              <button id="reject-all" class="btn btn-reject-all">דחה הכל</button>
              <button id="cancel" class="btn btn-cancel">ביטול</button>
            </div>
          </div>
        </custom-modal>
      </loading-spinner>
    `;
  }

  styles() {
    return `
      .approval-container {
        font-family: var(--font-ui-he, sans-serif);
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }

      h2 {
        margin: 0 0 16px 0;
        font-family: var(--font-display, serif);
        font-size: 22px;
        color: var(--ink, #1f1d18);
        text-align: center;
      }

      .metadata {
        background: var(--surface-2, #f0ede6);
        border: 1px solid var(--hairline, rgba(31,29,24,0.08));
        border-radius: var(--r-sm, 8px);
        padding: 12px 16px;
        margin-bottom: 16px;
      }

      .metadata p {
        margin: 4px 0;
        font-size: 13.5px;
        color: var(--ink, #1f1d18);
      }

      .images-section {
        margin-bottom: 16px;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        overflow: hidden;
        position: relative;
        min-height: 200px;
      }

      .loading-state {
        text-align: center;
        padding: 3rem 1rem;
        color: var(--ink-3, rgba(31,29,24,0.55));
        font-size: 14px;
      }

      .loading-state.hidden { display: none; }

      image-handler {
        display: block;
        width: 100%;
        box-sizing: border-box;
      }

      .selection-info {
        text-align: center;
        margin-bottom: 16px;
        font-size: 13.5px;
        color: var(--ink-3, rgba(31,29,24,0.55));
      }

      .image-item {
        position: relative;
        display: inline-block;
        margin: 0.5rem;
      }

      .image-item img {
        max-width: 150px;
        max-height: 150px;
        border-radius: var(--r-sm, 8px);
        border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
      }

      .image-item.selected img {
        border-color: var(--primary, #6a994e);
        box-shadow: 0 0 0 2px var(--primary, #6a994e);
      }

      .actions {
        display: flex;
        gap: 8px;
        justify-content: center;
        flex-wrap: wrap;
      }

      .btn {
        display: inline-flex; align-items: center;
        font-family: var(--font-ui-he, sans-serif); font-size: 13px; font-weight: 500;
        padding: 8px 16px; border-radius: var(--r-sm, 8px); border: 1px solid transparent;
        cursor: pointer; transition: background var(--dur-1, 160ms), border-color var(--dur-1, 160ms);
      }

      .btn:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: none; }

      .btn-approve,
      .btn-approve-all {
        background: var(--primary, #6a994e);
        color: #fff;
      }

      .btn-approve:hover:not(:disabled),
      .btn-approve-all:hover {
        background: var(--primary-dark, #386641);
      }

      .btn-reject,
      .btn-reject-all {
        background: var(--secondary, #e05050);
        color: #fff;
      }

      .btn-reject:hover:not(:disabled),
      .btn-reject-all:hover {
        background: var(--secondary-dark, #bc4749);
      }

      .btn-cancel {
        background: transparent;
        color: var(--ink, #1f1d18);
        border-color: transparent;
      }

      .btn-cancel:hover { background: var(--surface-2, #f0ede6); }
    `;
  }

  setupEventListeners() {
    const approveSelectedBtn = this.shadowRoot.getElementById('approve-selected');
    const rejectSelectedBtn = this.shadowRoot.getElementById('reject-selected');
    const approveAllBtn = this.shadowRoot.getElementById('approve-all');
    const rejectAllBtn = this.shadowRoot.getElementById('reject-all');
    const cancelBtn = this.shadowRoot.getElementById('cancel');

    approveSelectedBtn.addEventListener('click', () => this.handleApproveSelected());
    rejectSelectedBtn.addEventListener('click', () => this.handleRejectSelected());
    approveAllBtn.addEventListener('click', () => this.handleApproveAll());
    rejectAllBtn.addEventListener('click', () => this.handleRejectAll());
    cancelBtn.addEventListener('click', () => this.close());

    // Listen for image selection changes
    const imageHandler = this.shadowRoot.querySelector('image-handler');
    if (imageHandler) {
      imageHandler.addEventListener('images-reordered', () => {
        console.log('Images reordered by user');
      });

      // Listen for primary image changes
      imageHandler.addEventListener('primary-image-changed', (event) => {
        this.primaryImageId = event.detail.imageId;
        console.log('Primary image set to:', this.primaryImageId);
      });
    }
  }

  async openForRecipe(recipe) {
    this.recipe = recipe;
    this.selectedImageIds.clear();
    this.primaryImageId = null; // Reset primary selection for new recipe

    // Update metadata (removed uploader/timestamp - multiple users may have uploaded)
    const metadata = this.shadowRoot.getElementById('metadata');
    const imageCount = recipe.pendingImages?.length || 0;

    metadata.innerHTML = `
      <p><strong>שם המתכון:</strong> ${recipe.name}</p>
      <p><strong>מספר תמונות:</strong> ${imageCount}</p>
    `;

    this.updateSelectionInfo();
    this.updateButtonStates();

    this.showLoadingState();

    const modal = this.shadowRoot.querySelector('custom-modal');
    modal.open();

    await this.populatePendingImages(recipe.pendingImages || []);

    this.hideLoadingState();
  }

  async populatePendingImages(pendingImages) {
    const imageHandler = this.shadowRoot.querySelector('image-handler');
    if (!imageHandler) return;

    // Clear existing images
    imageHandler.clearImages();

    // Set up MutationObserver to add selection controls when images are rendered
    this.setupImageObserver(imageHandler);

    // Load and add images
    for (const pendingImg of pendingImages) {
      try {
        const previewUrl = await RecipeImageService.getOptimizedUrl(pendingImg, '400x400');

        // Add image to handler (observer will add selection controls automatically)
        imageHandler.addImage({
          file: null,
          preview: previewUrl,
          id: pendingImg.id,
          isPrimary: false, // Admin will decide when approving
          full: pendingImg.full,
          uploadedBy: pendingImg.uploadedBy,
          timestamp: pendingImg.timestamp,
        });
      } catch (error) {
        console.error('Error loading pending image:', error);
      }
    }
  }

  setupImageObserver(imageHandler) {
    // Disconnect existing observer if any
    if (this.imageObserver) {
      this.imageObserver.disconnect();
    }

    // Create observer to watch for new image previews
    this.imageObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.classList?.contains('image-preview')) {
            const imageId = node.getAttribute('data-id');
            if (imageId) {
              this.addSelectionControlsSync(node, imageId);
            }
          }
        });
      });
    });

    // Start observing the preview container
    const previewContainer = imageHandler.shadowRoot.querySelector('.preview-container');
    if (previewContainer) {
      this.imageObserver.observe(previewContainer, { childList: true });
    }
  }

  addSelectionControlsSync(imagePreview, imageId) {
    // Add selection button to image controls (synchronous, no setTimeout)
    const controls = imagePreview.querySelector('.image-controls');
    if (controls) {
      const selectBtn = document.createElement('button');
      selectBtn.className = 'control-button select-button';

      // Check if this image was already selected (preserves state after re-render)
      const isSelected = this.selectedImageIds.has(imageId);
      selectBtn.textContent = isSelected ? '✓ נבחר' : 'בחר';

      // Apply selected class if needed
      if (isSelected) {
        imagePreview.classList.add('selected');
      }

      selectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleImageSelection(imageId, imagePreview);
      });
      controls.appendChild(selectBtn);
    }
  }

  showLoadingState() {
    const loadingState = this.shadowRoot.getElementById('loading-state');
    const imageHandler = this.shadowRoot.getElementById('pending-images-viewer');
    if (loadingState) {
      loadingState.classList.remove('hidden');
    }
    if (imageHandler) {
      imageHandler.style.display = 'none';
    }
  }

  hideLoadingState() {
    const loadingState = this.shadowRoot.getElementById('loading-state');
    const imageHandler = this.shadowRoot.getElementById('pending-images-viewer');
    if (loadingState) {
      loadingState.classList.add('hidden');
    }
    if (imageHandler) {
      imageHandler.style.display = 'block';
    }
  }

  toggleImageSelection(imageId, imagePreview) {
    if (this.selectedImageIds.has(imageId)) {
      this.selectedImageIds.delete(imageId);
      imagePreview.classList.remove('selected');
      // Update button text
      const selectBtn = imagePreview.querySelector('.select-button');
      if (selectBtn) selectBtn.textContent = 'בחר';
    } else {
      this.selectedImageIds.add(imageId);
      imagePreview.classList.add('selected');
      // Update button text
      const selectBtn = imagePreview.querySelector('.select-button');
      if (selectBtn) selectBtn.textContent = '✓ נבחר';
    }

    this.updateSelectionInfo();
    this.updateButtonStates();
  }

  updateSelectionInfo() {
    const selectionInfo = this.shadowRoot.getElementById('selection-info');
    const count = this.selectedImageIds.size;

    if (count === 0) {
      selectionInfo.innerHTML = '<p>בחר תמונות על ידי לחיצה על כפתור "בחר" מתחת לכל תמונה</p>';
    } else {
      selectionInfo.innerHTML = `<p><strong>${count} תמונות נבחרו</strong></p>`;
    }
  }

  updateButtonStates() {
    const approveSelectedBtn = this.shadowRoot.getElementById('approve-selected');
    const rejectSelectedBtn = this.shadowRoot.getElementById('reject-selected');
    const hasSelection = this.selectedImageIds.size > 0;

    approveSelectedBtn.disabled = !hasSelection;
    rejectSelectedBtn.disabled = !hasSelection;
  }

  /**
   * Get IDs of currently visible images (excludes removed images)
   * @returns {string[]} Array of visible image IDs
   */
  getVisibleImageIds() {
    const imageHandler = this.shadowRoot.querySelector('image-handler');
    if (!imageHandler || !imageHandler.images) return [];

    return imageHandler.images.map((img) => img.id);
  }

  async handleApproveSelected() {
    if (this.selectedImageIds.size === 0) return;

    const spinner = this.shadowRoot.querySelector('loading-spinner');
    spinner.setAttribute('active', '');

    try {
      // Check if recipe already has images (to preserve existing primary)
      const recipeHadImages = this.recipe.images && this.recipe.images.length > 0;

      // Track mapping from pending ID to new approved ID
      const pendingToApprovedIds = new Map();

      for (const pendingImageId of this.selectedImageIds) {
        const newImageId = await RecipeImageProposalService.approve(this.recipe.id, pendingImageId);
        pendingToApprovedIds.set(pendingImageId, newImageId);
      }

      // Only set primary image if:
      // 1. Admin explicitly selected one, OR
      // 2. Recipe had no images before (first images being approved)
      if (this.primaryImageId) {
        const newPrimaryId = pendingToApprovedIds.get(this.primaryImageId);
        if (newPrimaryId) {
          await RecipeService.setPrimaryImage(this.recipe.id, newPrimaryId);
          console.log('Primary image set to admin selection:', newPrimaryId);
        }
      } else if (!recipeHadImages) {
        const firstPendingId = Array.from(this.selectedImageIds)[0];
        const firstNewId = pendingToApprovedIds.get(firstPendingId);
        if (firstNewId) {
          await RecipeService.setPrimaryImage(this.recipe.id, firstNewId);
          console.log('First image set as primary (recipe had no images):', firstNewId);
        }
      } else {
        console.log('Preserving existing primary image');
      }

      this.dispatchEvent(
        new CustomEvent('images-approved', {
          bubbles: true,
          composed: true,
          detail: {
            recipeId: this.recipe.id,
            imageIds: Array.from(this.selectedImageIds),
          },
        }),
      );

      this.close();
    } catch (error) {
      console.error('Error approving images:', error);
      alert('שגיאה באישור התמונות');
    } finally {
      spinner.removeAttribute('active');
    }
  }

  async handleRejectSelected() {
    if (this.selectedImageIds.size === 0) return;

    const spinner = this.shadowRoot.querySelector('loading-spinner');
    spinner.setAttribute('active', '');

    try {
      for (const imageId of this.selectedImageIds) {
        await RecipeImageProposalService.reject(this.recipe.id, imageId);
      }

      this.dispatchEvent(
        new CustomEvent('images-rejected', {
          bubbles: true,
          composed: true,
          detail: {
            recipeId: this.recipe.id,
            imageIds: Array.from(this.selectedImageIds),
          },
        }),
      );

      this.close();
    } catch (error) {
      console.error('Error rejecting images:', error);
      alert('שגיאה בדחיית התמונות');
    } finally {
      spinner.removeAttribute('active');
    }
  }

  async handleApproveAll() {
    if (!this.recipe || !this.recipe.pendingImages) return;

    const visibleImageIds = this.getVisibleImageIds();
    if (visibleImageIds.length === 0) return;

    const confirmed = confirm(`האם לאשר את כל ${visibleImageIds.length} התמונות?`);
    if (!confirmed) return;

    const spinner = this.shadowRoot.querySelector('loading-spinner');
    spinner.setAttribute('active', '');

    try {
      const recipeHadImages = this.recipe.images && this.recipe.images.length > 0;

      const pendingToApprovedIds = new Map();

      for (const pendingImageId of visibleImageIds) {
        const newImageId = await RecipeImageProposalService.approve(this.recipe.id, pendingImageId);
        pendingToApprovedIds.set(pendingImageId, newImageId);
      }

      // Only set primary image if:
      // 1. Admin explicitly selected one, OR
      // 2. Recipe had no images before (first images being approved)
      if (this.primaryImageId) {
        // Admin explicitly selected a primary - honor their choice
        const newPrimaryId = pendingToApprovedIds.get(this.primaryImageId);
        if (newPrimaryId) {
          await RecipeService.setPrimaryImage(this.recipe.id, newPrimaryId);
          console.log('Primary image set to admin selection:', newPrimaryId);
        }
      } else if (!recipeHadImages) {
        const firstPendingId = visibleImageIds[0];
        const firstNewId = pendingToApprovedIds.get(firstPendingId);
        if (firstNewId) {
          await RecipeService.setPrimaryImage(this.recipe.id, firstNewId);
          console.log('First image set as primary (recipe had no images):', firstNewId);
        }
      } else {
        console.log('Preserving existing primary image');
      }

      this.dispatchEvent(
        new CustomEvent('images-approved', {
          bubbles: true,
          composed: true,
          detail: {
            recipeId: this.recipe.id,
            imageIds: visibleImageIds,
          },
        }),
      );

      this.close();
    } catch (error) {
      console.error('Error approving all images:', error);
      alert('שגיאה באישור התמונות');
    } finally {
      spinner.removeAttribute('active');
    }
  }

  async handleRejectAll() {
    if (!this.recipe || !this.recipe.pendingImages) return;

    const visibleImageIds = this.getVisibleImageIds();
    if (visibleImageIds.length === 0) return;

    const confirmed = confirm(`האם לדחות את כל ${visibleImageIds.length} התמונות?`);
    if (!confirmed) return;

    const spinner = this.shadowRoot.querySelector('loading-spinner');
    spinner.setAttribute('active', '');

    try {
      for (const imageId of visibleImageIds) {
        await RecipeImageProposalService.reject(this.recipe.id, imageId);
      }

      this.dispatchEvent(
        new CustomEvent('images-rejected', {
          bubbles: true,
          composed: true,
          detail: {
            recipeId: this.recipe.id,
            imageIds: visibleImageIds,
          },
        }),
      );

      this.close();
    } catch (error) {
      console.error('Error rejecting all images:', error);
      alert('שגיאה בדחיית התמונות');
    } finally {
      spinner.removeAttribute('active');
    }
  }

  formatTimestamp(timestamp) {
    if (!timestamp) return '';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('he-IL');
    } catch (error) {
      console.warn('Error formatting timestamp:', error);
      return '';
    }
  }

  close() {
    // Clean up MutationObserver to prevent memory leaks
    if (this.imageObserver) {
      this.imageObserver.disconnect();
      this.imageObserver = null;
    }

    const modal = this.shadowRoot.querySelector('custom-modal');
    modal.close();
    this.recipe = null;
    this.selectedImageIds.clear();
    this.primaryImageId = null; // Reset primary selection
  }
}

customElements.define('image-approval-multi', ImageApprovalMulti);
