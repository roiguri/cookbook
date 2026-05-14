/**
 * MediaInstructionsEditor Web Component
 * ======================================
 * A drag-and-drop editor for recipe media instructions (images/videos).
 *
 * @attribute {string} media-data - JSON string of media instructions array
 * @attribute {string} recipe-id - The recipe ID for storage paths
 *
 * @fires media-changed - Dispatched when media instructions change
 *   detail: { mediaInstructions: Array, hasPendingFiles: boolean }
 *
 * @example
 * <media-instructions-editor
 *   media-data='[]'
 *   recipe-id="recipe-123">
 * </media-instructions-editor>
 */

import {
  deleteMediaInstructionFile,
  validateMediaFile,
  getMediaInstructionUrl,
} from '../../../js/utils/recipes/recipe-media-utils.js';
import '../upload-zone/upload-zone.js';

const ACCEPT_MIME =
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_LABEL = 'גרור תמונות או סרטונים לכאן או לחץ להעלאה';
const UPLOAD_HINT = '(תמונות: JPEG, PNG, WebP, GIF | סרטונים: MP4, WebM, MOV | מקסימום: 50MB)';

class MediaInstructionsEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // State - unified array for both existing and pending media
    this.mediaItems = []; // Contains both uploaded media and pending files
    this.recipeId = '';
    this.uploading = false;
    this.errors = [];
    this.draggedIndex = null;

    this.handleAccepted = this.handleAccepted.bind(this);
    this.handleRejected = this.handleRejected.bind(this);
  }

  static get observedAttributes() {
    return ['media-data', 'recipe-id'];
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    // Clean up any pending blob URLs to prevent memory leaks
    this.mediaItems.forEach((item) => {
      if (item.preview && item.file) {
        URL.revokeObjectURL(item.preview);
      }
    });
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      switch (name) {
        case 'media-data':
          try {
            // Parse incoming media data (existing uploaded media only)
            const existingMedia = newValue ? JSON.parse(newValue) : [];
            // Preserve pending files that haven't been uploaded yet
            const pendingItems = this.mediaItems.filter((item) => item.file);
            // Merge: existing media first, then pending
            this.mediaItems = [...existingMedia, ...pendingItems];

            // Only render if component is connected AND shadowRoot container exists
            if (this.isConnected && this.shadowRoot?.querySelector('.media-list-container')) {
              this.renderMediaList();
            }
          } catch (error) {
            console.error('Error parsing media-data:', error);
            this.mediaItems = [];
          }
          break;
        case 'recipe-id':
          this.recipeId = newValue || '';
          break;
      }
    }
  }

  setupEventListeners() {
    const uploadZone = this.shadowRoot.querySelector('upload-zone');
    uploadZone.addEventListener('upload-files-accepted', this.handleAccepted);
    uploadZone.addEventListener('upload-files-rejected', this.handleRejected);
  }

  // --- File Upload Handlers ---

  async handleAccepted(event) {
    await this.uploadFiles(event.detail.files);
  }

  handleRejected(event) {
    const rejected = event.detail.rejected;
    // Run domain validator to get localized error messages.
    for (const { file } of rejected) {
      const validation = validateMediaFile(file);
      if (!validation.isValid) {
        this.errors.push(`${file.name}: ${validation.errors.join(', ')}`);
      }
    }
    this.renderErrors();
  }

  async uploadFiles(files) {
    this.errors = [];

    // Add files to unified array as pending items
    for (const file of files) {
      const validation = validateMediaFile(file);
      if (!validation.isValid) {
        this.errors.push(`${file.name}: ${validation.errors.join(', ')}`);
        continue;
      }

      // Create Blob URL for preview
      const previewURL = URL.createObjectURL(file);

      // Determine media type
      const isVideo = file.type.startsWith('video/');

      // Add to unified array with file property (marks as pending)
      this.mediaItems.push({
        file, // Presence of 'file' marks this as pending
        preview: previewURL,
        caption: '',
        type: isVideo ? 'video' : 'image',
        id: 'pending-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      });
    }

    this.renderMediaList();
    this.renderErrors();
    this.emitChange();
  }

  // --- Media Item Handlers ---

  async handleDelete(index) {
    const item = this.mediaItems[index];
    if (!item) return;

    const confirmDelete = confirm(`האם למחוק את "${item.caption || 'פריט זה'}"?`);
    if (!confirmDelete) return;

    try {
      // Delete from storage if it's an uploaded item (has path)
      if (item.path) {
        await deleteMediaInstructionFile(item.path);
      }

      // Clean up blob URL if it's a pending file
      if (item.preview && item.file) {
        URL.revokeObjectURL(item.preview);
      }

      // Remove from unified array
      this.mediaItems.splice(index, 1);

      // Update order field for remaining uploaded items
      this.mediaItems.forEach((media, idx) => {
        if (!media.file && media.order !== undefined) {
          media.order = idx;
        }
      });

      this.emitChange();
      await this.renderMediaList();
    } catch (error) {
      console.error('Error deleting media:', error);
      this.showError(`שגיאה במחיקה: ${error.message}`);
    }
  }

  handleCaptionChange(index, newCaption) {
    if (this.mediaItems[index]) {
      this.mediaItems[index].caption = newCaption;
      this.emitChange();
    }
  }

  // --- Simple Drag-to-Reorder Handlers (Unified Array) ---

  handleItemDragStart(e, index) {
    this.draggedIndex = index;
    const mediaItem = e.target.closest('.media-item');
    if (mediaItem) {
      mediaItem.classList.add('dragging');
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', 'dragging');
  }

  handleItemDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (this.draggedIndex === null || index === this.draggedIndex) return;

    // Visual feedback
    const items = this.shadowRoot.querySelectorAll('.media-item');
    items.forEach((item, idx) => {
      if (idx === index) {
        item.classList.add('drag-over');
      } else {
        item.classList.remove('drag-over');
      }
    });
  }

  handleItemDragEnd(e) {
    const mediaItem = e.target.closest('.media-item');
    if (mediaItem) {
      mediaItem.classList.remove('dragging');
    }

    const items = this.shadowRoot.querySelectorAll('.media-item');
    items.forEach((item) => {
      item.classList.remove('drag-over');
    });

    this.draggedIndex = null;
  }

  handleItemDrop(e, dropIndex) {
    e.preventDefault();
    e.stopPropagation();

    if (this.draggedIndex === null || this.draggedIndex === dropIndex) return;

    // Simple reorder in unified array
    const draggedItem = this.mediaItems.splice(this.draggedIndex, 1)[0];
    this.mediaItems.splice(dropIndex, 0, draggedItem);

    // Update order field for all uploaded items
    this.mediaItems.forEach((item, idx) => {
      if (!item.file && item.order !== undefined) {
        item.order = idx;
      }
    });

    this.emitChange();
    this.renderMediaList();
  }

  // --- Rendering ---

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--font-ui-he, sans-serif);
          margin-bottom: 20px;
        }

        .editor-container { width: 100%; }

        upload-zone {
          display: block;
          margin-bottom: 10px;
        }

        .media-list-container { display: none; }

        .media-list-container.has-items {
          display: block;
          animation: fadeInSlideDown 0.4s ease forwards;
        }

        @keyframes fadeInSlideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .media-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }

        .media-item {
          border: 1px solid var(--hairline, rgba(31,29,24,0.08));
          border-radius: var(--r-md, 12px);
          padding: 15px;
          background: var(--surface-1, #fff);
          box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
          transition: box-shadow var(--dur-1, 160ms), transform var(--dur-1, 160ms);
          position: relative;
        }

        .media-item:hover {
          box-shadow: var(--shadow-2, 0 4px 12px rgba(31,29,24,0.12));
          transform: translateY(-2px);
        }

        .media-item.dragging { opacity: 0.5; }

        .media-item.drag-over {
          border-color: var(--primary, #6a994e);
          background: #eef4e8;
        }

        .drag-handle {
          position: absolute;
          top: 10px;
          left: 10px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          color: var(--ink-3, rgba(31,29,24,0.55));
          cursor: move;
          z-index: 10;
          background: var(--surface-2, #f0ede6);
          border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
          border-radius: var(--r-sm, 8px);
          transition: background var(--dur-1, 160ms), color var(--dur-1, 160ms), border-color var(--dur-1, 160ms);
          user-select: none;
        }

        .drag-handle:hover {
          background: var(--primary, #6a994e);
          border-color: var(--primary, #6a994e);
          color: #fff;
        }

        .delete-button {
          position: absolute;
          top: 10px;
          right: 10px;
          background: var(--secondary, #e05050);
          color: #fff;
          border: none;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          cursor: pointer;
          font-size: 16px;
          line-height: 28px;
          text-align: center;
          transition: background var(--dur-1, 160ms);
          z-index: 10;
        }

        .delete-button:hover { background: var(--secondary-dark, #bc4749); }

        .media-preview {
          width: 100%;
          height: 180px;
          object-fit: cover;
          border-radius: var(--r-sm, 8px);
          margin-bottom: 10px;
          background: var(--surface-2, #f0ede6);
        }

        .pending-badge {
          position: absolute;
          top: 50px;
          left: 15px;
          background: #e6a817;
          color: #fff;
          padding: 3px 8px;
          border-radius: var(--r-pill, 999px);
          font-family: var(--font-ui-he, sans-serif);
          font-size: 11px;
          font-weight: 500;
        }

        .caption-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
          border-radius: var(--r-sm, 8px);
          font-size: 14px;
          font-family: var(--font-ui-he, sans-serif);
          color: var(--ink, #1f1d18);
          background: var(--surface-1, #fff);
          direction: rtl;
          box-sizing: border-box;
        }

        .caption-input:focus {
          outline: none;
          border-color: var(--primary, #6a994e);
          box-shadow: var(--ring, 0 0 0 3px rgba(106,153,78,0.2));
        }

        .item-order {
          position: absolute;
          bottom: 10px;
          left: 10px;
          background: var(--primary, #6a994e);
          color: #fff;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
        }

        .errors-container {
          background: #faeaea;
          border: 1px solid #e8b3b3;
          border-radius: var(--r-sm, 8px);
          padding: 14px 16px;
          margin-top: 15px;
          direction: rtl;
          position: relative;
          font-family: var(--font-ui-he, sans-serif);
          font-size: 13.5px;
        }

        .error-dismiss-button {
          position: absolute;
          top: 10px;
          left: 10px;
          background: transparent;
          border: none;
          color: var(--secondary, #e05050);
          font-size: 20px;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: background var(--dur-1, 160ms);
        }

        .error-dismiss-button:hover {
          background: var(--secondary, #e05050);
          color: #fff;
        }

        .error-dismiss-button:focus {
          outline: 2px solid var(--secondary, #e05050);
          outline-offset: 2px;
        }

        .error-title {
          font-weight: 600;
          color: var(--secondary-dark, #bc4749);
          margin-bottom: 8px;
          padding-right: 30px;
        }

        .error-item {
          font-size: 13.5px;
          color: var(--secondary-dark, #bc4749);
          margin: 4px 0;
        }
      </style>

      <div class="editor-container">
        <upload-zone
          accept="${ACCEPT_MIME}"
          multiple
          max-size="${MAX_FILE_SIZE}"
          label="${UPLOAD_LABEL}"
          hint="${UPLOAD_HINT}">
        </upload-zone>

        <!-- Media List -->
        <div class="media-list-container"></div>

        <!-- Errors -->
        <div class="errors-container" style="display: none;"></div>
      </div>
    `;

    this.renderMediaList();
  }

  setUploading(isUploading) {
    this.uploading = isUploading;
    const uploadZone = this.shadowRoot.querySelector('upload-zone');
    if (uploadZone) {
      uploadZone.toggleAttribute('loading', isUploading);
    }
  }

  async renderMediaList() {
    const container = this.shadowRoot.querySelector('.media-list-container');

    if (this.mediaItems.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      container.classList.remove('has-items');
      return;
    }

    container.style.display = 'block';

    // Add animation class if not already present
    if (!container.classList.contains('has-items')) {
      container.classList.add('has-items');
    }

    // Render all items from unified array
    const mediaListHTML = `
      <div class="media-list">
        ${(
          await Promise.all(
            this.mediaItems.map(async (item, index) => {
              let previewURL;
              const isPending = !!item.file; // Has 'file' property = pending

              if (isPending) {
                // Use Blob URL for pending files
                previewURL = item.preview;
              } else {
                // Fetch Storage URL for uploaded media
                try {
                  previewURL = await getMediaInstructionUrl(item.path);
                } catch (error) {
                  console.error('Error getting media URL:', error);
                  previewURL = '';
                }
              }

              const isVideo = item.type === 'video';
              const mediaTag = isVideo
                ? `<video class="media-preview" src="${previewURL}" controls aria-label="${item.caption || 'וידאו ללא כיתוב'}"></video>`
                : `<img class="media-preview" src="${previewURL}" alt="${item.caption || 'תמונה ללא תיאור'}">`;

              return `
              <div
                class="media-item ${isPending ? 'pending' : ''}"
                data-index="${index}"
                role="article"
                aria-label="פריט מדיה ${index + 1} מתוך ${this.mediaItems.length}">
                <span
                  class="drag-handle"
                  draggable="true"
                  role="button"
                  tabindex="0"
                  aria-label="גרור לשינוי סדר פריט ${index + 1}">⠿</span>
                <button
                  class="delete-button"
                  aria-label="מחק פריט ${index + 1}">×</button>
                ${isPending ? '<span class="pending-badge">ממתין</span>' : ''}
                <span class="item-order" aria-hidden="true">${index + 1}</span>
                ${mediaTag}
                <input
                  type="text"
                  class="caption-input"
                  placeholder="הוסף הסבר לשלב..."
                  value="${item.caption || ''}"
                  aria-label="כיתוב עבור פריט ${index + 1}"
                  dir="rtl"
                >
              </div>
            `;
            }),
          )
        ).join('')}
      </div>
    `;

    container.innerHTML = mediaListHTML;

    // Attach event listeners to new elements
    this.attachMediaItemListeners();
  }

  attachMediaItemListeners() {
    const mediaItems = this.shadowRoot.querySelectorAll('.media-item');

    mediaItems.forEach((item, index) => {
      // Delete button
      const deleteButton = item.querySelector('.delete-button');
      if (deleteButton) {
        deleteButton.addEventListener('click', (e) => {
          e.stopPropagation();
          this.handleDelete(index);
        });
      }

      // Caption input
      const captionInput = item.querySelector('.caption-input');
      if (captionInput) {
        captionInput.addEventListener('input', (e) => {
          this.handleCaptionChange(index, e.target.value);
        });
      }

      // Drag handle
      const dragHandle = item.querySelector('.drag-handle');
      if (dragHandle) {
        dragHandle.addEventListener('dragstart', (e) => this.handleItemDragStart(e, index));
        dragHandle.addEventListener('dragend', (e) => this.handleItemDragEnd(e));
      }

      // Drop zones
      item.addEventListener('dragover', (e) => this.handleItemDragOver(e, index));
      item.addEventListener('drop', (e) => this.handleItemDrop(e, index));
    });
  }

  renderErrors() {
    const errorsContainer = this.shadowRoot.querySelector('.errors-container');

    if (this.errors.length === 0) {
      errorsContainer.style.display = 'none';
      return;
    }

    errorsContainer.style.display = 'block';
    errorsContainer.innerHTML = `
      <button class="error-dismiss-button" aria-label="סגור הודעות שגיאה">×</button>
      <div class="error-title">שגיאות בהעלאה:</div>
      ${this.errors.map((error) => `<div class="error-item">• ${error}</div>`).join('')}
    `;

    // Attach dismiss button event listener
    const dismissButton = errorsContainer.querySelector('.error-dismiss-button');
    if (dismissButton) {
      dismissButton.addEventListener('click', () => this.dismissErrors());
    }
  }

  dismissErrors() {
    this.errors = [];
    this.renderErrors();
  }

  showError(message) {
    this.errors = [message];
    this.renderErrors();
  }

  // --- Communication with Parent ---

  emitChange() {
    this.dispatchEvent(
      new CustomEvent('media-changed', {
        detail: {
          mediaInstructions: this.mediaInstructions,
          hasPendingFiles: this.pendingFiles.length > 0,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // --- Public API ---

  // --- Compatibility Getters (for external code) ---

  /**
   * Gets uploaded media instructions (items without 'file' property)
   */
  get mediaInstructions() {
    return this.mediaItems.filter((item) => !item.file);
  }

  /**
   * Gets pending files (items with 'file' property)
   */
  get pendingFiles() {
    return this.mediaItems.filter((item) => item.file);
  }

  /**
   * Gets all media items in unified order (both existing and pending)
   * Returns items with position index for order preservation
   */
  getAllMediaInOrder() {
    return this.mediaItems.map((item, index) => ({
      ...item,
      position: index, // Track position for order preservation during upload
    }));
  }

  /**
   * Sync editor state with the result of an external upload (RecipeService).
   * Replaces pending entries at the recorded position with their uploaded
   * metadata so a subsequent save won't re-upload them. Failed positions
   * remain pending and their errors are surfaced to the user.
   *
   * @param {{ uploaded: Array<{position:number, metadata:Object}>, failed: Array<{position:number, error:string, originalItem?:Object}> }} uploadResults
   */
  applyUploadResults(uploadResults) {
    if (!uploadResults) return;
    const { uploaded = [], failed = [] } = uploadResults;

    for (const { position, metadata } of uploaded) {
      const item = this.mediaItems[position];
      if (!item) continue;
      if (item.preview && item.file) {
        URL.revokeObjectURL(item.preview);
      }
      this.mediaItems[position] = {
        ...metadata,
        caption: item.caption ?? metadata.caption ?? '',
      };
    }

    this.mediaItems.forEach((item, index) => {
      item.order = index;
    });

    for (const { originalItem, error } of failed) {
      const name = originalItem?.file?.name || 'media';
      this.errors.push(`${name}: ${error}`);
    }

    this.emitChange();
    this.renderMediaList();
    this.renderErrors();
  }

  /**
   * Clears all media instructions and pending files
   * Used when resetting the form
   */
  clear() {
    // Clean up blob URLs before clearing to prevent memory leaks
    this.mediaItems.forEach((item) => {
      if (item.preview && item.file) {
        URL.revokeObjectURL(item.preview);
      }
    });

    this.mediaItems = [];
    this.errors = [];
    this.emitChange();
    this.renderMediaList();
    this.renderErrors();
  }
}

// Register the custom element
customElements.define('media-instructions-editor', MediaInstructionsEditor);

export default MediaInstructionsEditor;
