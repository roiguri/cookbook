import { generateImageId } from '../../../js/utils/recipes/recipe-image-utils.js';
import { FormFieldMixin, deepEqual, deepClone } from '../../forms/form-field-base.js';
import '../upload-zone/upload-zone.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

class ImageHandler extends FormFieldMixin(HTMLElement) {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.images = [];
    this.maxImages = 5;
    this.draggedImage = null;
    this.removedImages = [];
    this._isDisabled = false; // persists across re-renders

    this.handleAccepted = this.handleAccepted.bind(this);
    this.handleRejected = this.handleRejected.bind(this);
  }

  /**
   * Emits the unified contract events. Replaces the five legacy events
   * (file-added, images-changed, images-reordered, primary-image-changed,
   * images-cleared) with a single value-changed (action in detail) plus
   * dirty-changed.
   * @param {string} action
   */
  _emitChange(action) {
    this._emitValueChanged({ action });
    this._emitDirtyChanged();
  }

  static get observedAttributes() {
    return ['hide-upload'];
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();

    this.boundDocumentClickHandler = this.handleDocumentClick.bind(this);
    document.addEventListener('click', this.boundDocumentClickHandler);

    this.updateUploadAreaVisibility();
  }

  disconnectedCallback() {
    if (this.boundDocumentClickHandler) {
      document.removeEventListener('click', this.boundDocumentClickHandler);
    }
  }

  attributeChangedCallback(name) {
    if (name === 'hide-upload') {
      this.updateUploadAreaVisibility();
    }
  }

  get uploadZoneHint() {
    return `(מקסימום ${this.maxImages} תמונות, גודל מקסימלי 5MB לתמונה)`;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .image-handler {
          font-family: var(--font-ui-he, sans-serif);
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        :host([hide-upload]) upload-zone { display: none; }

        .preview-container {
          position: relative;
          display: flex;
          gap: 1rem;
          margin-top: 4px;
          padding: 0.5rem 0;
          overflow-x: auto;
          overflow-y: hidden;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          max-width: 100%;
        }

        .preview-container::-webkit-scrollbar {
          height: 6px;
        }

        .preview-container::-webkit-scrollbar-track {
          background: var(--surface-2, #f0ede6);
          border-radius: var(--r-pill, 999px);
        }

        .preview-container::-webkit-scrollbar-thumb {
          background: var(--primary, #6a994e);
          border-radius: var(--r-pill, 999px);
        }

        .preview-container::-webkit-scrollbar-thumb:hover {
          background: var(--primary-dark, #386641);
        }

        .image-preview {
          position: relative;
          width: 150px;
          height: 150px;
          flex-shrink: 0;
          border-radius: var(--r-sm, 8px);
          overflow: hidden;
          border: 1px solid var(--hairline-strong, rgba(31,29,24,0.2));
          box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
          cursor: move;
          transition: box-shadow var(--dur-1, 160ms), transform var(--dur-1, 160ms);
          user-select: none;
        }

        .image-preview.dragging {
          opacity: 0.5;
          transform: scale(0.95);
          box-shadow: var(--shadow-3, 0 8px 24px rgba(31,29,24,0.16));
        }

        .image-preview.primary {
          box-shadow: inset 0 0 0 3px var(--primary, #6a994e), var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
        }

        .image-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .image-preview.uploading::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.45);
        }

        .image-controls {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(31,29,24,0.55);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          opacity: 0;
          transition: opacity var(--dur-1, 160ms);
          pointer-events: none;
        }

        .image-controls.visible {
          opacity: 1;
          pointer-events: auto;
        }

        @media (hover: hover) and (pointer: fine) {
          .image-preview:hover .image-controls {
            opacity: 1;
            pointer-events: auto;
          }
        }

        .control-button {
          font-family: var(--font-ui-he, sans-serif);
          font-size: 12px;
          font-weight: 500;
          border-radius: var(--r-sm, 8px);
          padding: 5px 12px;
          cursor: pointer;
          width: 80%;
          border: 1px solid transparent;
          transition: background var(--dur-1, 160ms);
        }

        .control-button.remove-button {
          background: var(--secondary, #e05050);
          color: #fff;
        }

        .control-button.remove-button:hover {
          background: var(--secondary-dark, #bc4749);
        }

        .control-button.primary-button {
          background: rgba(255,255,255,0.15);
          color: #fff;
          border-color: rgba(255,255,255,0.5);
        }

        .control-button.primary-button:hover {
          background: rgba(255,255,255,0.25);
        }

        .progress-bar {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 4px;
          background: rgba(255,255,255,0.3);
          display: none;
        }

        .progress-bar__fill {
          height: 100%;
          background: var(--primary, #6a994e);
          width: 0%;
          transition: width 0.3s ease;
        }

        .drop-indicator {
          position: absolute;
          width: calc(100% - 2rem);
          height: 3px;
          background: var(--primary, #6a994e);
          box-shadow: 0 0 6px rgba(106,153,78,0.5);
          transition: transform 0.2s ease;
          pointer-events: none;
          display: none;
          z-index: 1000;
          margin: 0 1rem;
        }

        .image-preview.primary::after {
          content: '✓';
          position: absolute;
          top: 5px;
          right: 5px;
          background: var(--primary, #6a994e);
          color: #fff;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 12px;
          box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
        }

        .primary-label {
          position: absolute;
          top: 30px;
          right: 5px;
          background: var(--primary, #6a994e);
          color: #fff;
          padding: 2px 7px;
          border-radius: var(--r-pill, 999px);
          font-size: 10px;
          font-weight: 500;
        }

        .error-container {
          background: #faeaea;
          color: var(--secondary-dark, #bc4749);
          border: 1px solid #e8b3b3;
          padding: 10px 14px;
          border-radius: var(--r-sm, 8px);
          margin-bottom: 10px;
          font-size: 13.5px;
          font-family: var(--font-ui-he, sans-serif);
          display: none;
        }

        .selected-files {
          margin-top: 10px;
          font-size: 12px;
          color: var(--ink-3, rgba(31,29,24,0.55));
        }
      </style>

      <div class="image-handler">
        <div class="error-container"></div>
        <upload-zone
          accept="${ALLOWED_TYPES.join(',')}"
          multiple
          max-size="${MAX_FILE_SIZE}"
          label="גרור תמונות לכאן או לחץ להעלאה"
          hint="${this.uploadZoneHint}">
        </upload-zone>
        <div class="selected-files"></div>
        <div class="preview-container"></div>
      </div>
    `;
  }

  handleDocumentClick(e) {
    const path = e.composedPath();
    if (!path.includes(this)) {
      const visibleControls = this.shadowRoot.querySelectorAll('.image-controls.visible');
      visibleControls.forEach((ctrl) => ctrl.classList.remove('visible'));
    }
  }

  setupEventListeners() {
    const uploadZone = this.shadowRoot.querySelector('upload-zone');
    uploadZone.addEventListener('upload-files-accepted', this.handleAccepted);
    uploadZone.addEventListener('upload-files-rejected', this.handleRejected);

    // Drag and drop reordering on preview container
    const previewContainer = this.shadowRoot.querySelector('.preview-container');
    const dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
    previewContainer.appendChild(dropIndicator);

    previewContainer.addEventListener('dragstart', (e) => {
      const preview = e.target.closest('.image-preview');
      if (preview) {
        this.draggedImage = preview;
        preview.classList.add('dragging');
        e.dataTransfer.setData('text/plain', preview.getAttribute('data-id'));
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    previewContainer.addEventListener('dragend', (e) => {
      const preview = e.target.closest('.image-preview');
      if (preview) {
        preview.classList.remove('dragging');
        this.draggedImage = null;
        dropIndicator.style.display = 'none';
      }
    });

    previewContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      const target = e.target.closest('.image-preview');

      if (target && this.draggedImage && target !== this.draggedImage) {
        e.dataTransfer.dropEffect = 'move';

        const allPreviews = [...previewContainer.querySelectorAll('.image-preview')];
        const targetIndex = allPreviews.indexOf(target);
        const draggedIndex = allPreviews.indexOf(this.draggedImage);

        dropIndicator.style.display = 'block';
        const targetRect = target.getBoundingClientRect();
        const containerRect = previewContainer.getBoundingClientRect();

        if (targetIndex > draggedIndex) {
          dropIndicator.style.transform = `translateY(${targetRect.bottom - containerRect.top}px)`;
        } else {
          dropIndicator.style.transform = `translateY(${targetRect.top - containerRect.top}px)`;
        }
      }
    });

    previewContainer.addEventListener('dragenter', (e) => {
      e.preventDefault();
    });

    previewContainer.addEventListener('dragleave', (e) => {
      if (!e.target.closest('.image-preview')) {
        dropIndicator.style.display = 'none';
      }
    });

    previewContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      dropIndicator.style.display = 'none';

      const target = e.target.closest('.image-preview');
      if (!target || !this.draggedImage || target === this.draggedImage) return;

      const allPreviews = [...previewContainer.querySelectorAll('.image-preview')];
      const fromIndex = allPreviews.indexOf(this.draggedImage);
      const toIndex = allPreviews.indexOf(target);

      this.reorderImages(fromIndex, toIndex);
    });
  }

  async handleAccepted(event) {
    const files = event.detail.files;
    const remainingSlots = this.maxImages - this.images.length;

    if (remainingSlots <= 0) {
      this.showError(`לא ניתן להעלות יותר מ-${this.maxImages} תמונות`);
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      this.showError(`לא ניתן להעלות יותר מ-${this.maxImages} תמונות`);
    }

    for (const file of filesToProcess) {
      try {
        const preview = await this.createImagePreview(file);
        const imageData = {
          file,
          preview,
          id: generateImageId(),
        };

        this.addImage(imageData);
        this._emitChange('file-added');
      } catch (error) {
        this.showError('שגיאה בטעינת התמונה');
      }
    }

    this.updateUploadAreaState();
  }

  handleRejected(event) {
    const rejected = event.detail.rejected;
    const reasons = new Set(rejected.flatMap((item) => item.reasons));

    if (reasons.has('type')) {
      this.showError('סוג הקובץ לא נתמך. נא להעלות תמונות מסוג JPEG, PNG או WebP בלבד');
    } else if (reasons.has('size')) {
      this.showError('התמונה גדולה מדי. הגודל המקסימלי המותר הוא 5MB');
    }
  }

  updateSelectedFiles() {
    const filesArea = this.shadowRoot.querySelector('.selected-files');
    if (this.images.length === 0) {
      filesArea.textContent = '';
      return;
    }

    const fileNames = this.images
      .map((img) => (img.file ? img.file.name : img.fileName || img.id || 'תמונה קיימת'))
      .filter(Boolean);
    filesArea.textContent = `קבצים נבחרו: ${fileNames.join(', ')}`;
  }

  reorderImages(fromIndex, toIndex) {
    const image = this.images.splice(fromIndex, 1)[0];
    this.images.splice(toIndex, 0, image);
    this.updatePreviewContainer();
    this._emitChange('images-reordered');
  }

  createImagePreview(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  addImage(imageData) {
    this.images.push({
      ...imageData,
      isPrimary: imageData.isPrimary ?? this.images.length === 0,
    });
    this.updatePreviewContainer();
    this.updateUploadAreaState();
    this.updateSelectedFiles();
  }

  removeImage(imageId) {
    const wasOnlyImage = this.images.length === 1;
    const removedImage = this.images.find((img) => img.id === imageId);
    const wasPrimary = removedImage?.isPrimary;

    if (removedImage && (removedImage.id || removedImage.full)) {
      this.removedImages.push({
        id: removedImage.id,
        full: removedImage.full,
      });
    }

    this.images = this.images.filter((img) => img.id !== imageId);

    if (wasPrimary && this.images.length > 0) {
      this.images[0].isPrimary = true;
    }

    this.updatePreviewContainer();
    this.updateUploadAreaState();

    if (wasOnlyImage) {
      this.updateSelectedFiles();
    }

    this._emitChange('images-changed');
  }

  setPrimaryImage(imageId) {
    this.images = this.images.map((img) => ({
      ...img,
      isPrimary: img.id === imageId,
    }));
    this.updatePreviewContainer();
    this._emitChange('primary-image-changed');
  }

  updatePreviewContainer() {
    const container = this.shadowRoot.querySelector('.preview-container');
    container.innerHTML = '';

    this.images.forEach((image) => {
      const preview = document.createElement('div');
      preview.className = `image-preview${image.isPrimary ? ' primary' : ''}`;
      preview.draggable = true;
      preview.setAttribute('data-id', image.id);

      preview.innerHTML = `
        <img src="${image.preview}" alt="Image preview">
        ${image.isPrimary ? '<div class="primary-label">תמונה ראשית</div>' : ''}
        <div class="progress-bar">
          <div class="progress-bar__fill"></div>
        </div>
        <div class="image-controls">
          <button class="control-button remove-button">הסר</button>
          ${!image.isPrimary ? `<button class="control-button primary-button">הגדר כראשית</button>` : ''}
        </div>
      `;

      const controls = preview.querySelector('.image-controls');
      const removeButton = preview.querySelector('.remove-button');
      const primaryButton = preview.querySelector('.primary-button');

      preview.addEventListener('click', (e) => {
        if (e.target.closest('.control-button')) return;

        e.stopPropagation();

        container.querySelectorAll('.image-controls.visible').forEach((ctrl) => {
          if (ctrl !== controls) ctrl.classList.remove('visible');
        });

        controls.classList.toggle('visible');
      });

      removeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeImage(image.id);
      });

      if (primaryButton) {
        primaryButton.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setPrimaryImage(image.id);
        });
      }

      container.appendChild(preview);
    });
    this.updateSelectedFiles();

    // Re-apply the form-level disabled state to freshly-rendered controls.
    if (this._isDisabled) this.setDisabled(true);
  }

  updateUploadAreaState() {
    const uploadZone = this.shadowRoot.querySelector('upload-zone');
    if (!uploadZone) return;
    const atMax = this.images.length >= this.maxImages;
    if (!this.hasAttribute('hide-upload')) {
      uploadZone.toggleAttribute('disabled', atMax);
    }
  }

  updateUploadAreaVisibility() {
    const uploadZone = this.shadowRoot?.querySelector('upload-zone');
    if (!uploadZone) return;

    if (this.hasAttribute('hide-upload')) {
      uploadZone.setAttribute('disabled', '');
    } else {
      uploadZone.toggleAttribute('disabled', this.images.length >= this.maxImages);
    }
  }

  showError(message) {
    const errorContainer = this.shadowRoot.querySelector('.error-container');
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';

    setTimeout(() => {
      errorContainer.style.display = 'none';
    }, 5000);
  }

  // Public API Methods

  /**
   * Set upload progress for a specific image
   */
  setImageProgress(imageId, progress) {
    const imageEl = this.shadowRoot.querySelector(`.image-preview[data-id="${imageId}"]`);
    if (imageEl) {
      const progressBar = imageEl.querySelector('.progress-bar__fill');
      if (progressBar) {
        progressBar.style.width = `${progress}%`;
      }
    }
  }

  /**
   * Mark an image as uploading
   */
  setImageUploading(imageId, isUploading) {
    const imageEl = this.shadowRoot.querySelector(`.image-preview[data-id="${imageId}"]`);
    if (imageEl) {
      imageEl.classList.toggle('uploading', isUploading);
      const progressBar = imageEl.querySelector('.progress-bar');
      if (progressBar) {
        progressBar.style.display = isUploading ? 'block' : 'none';
      }
    }
  }

  /**
   * Mark an image as uploaded successfully
   */
  setImageUploaded(imageId, uploadedUrl) {
    const imageData = this.images.find((img) => img.id === imageId);
    if (imageData) {
      imageData.uploadedUrl = uploadedUrl;
      this.setImageUploading(imageId, false);
    }
  }

  /**
   * Show error for a specific image
   */
  setImageError(imageId, error) {
    const imageEl = this.shadowRoot.querySelector(`.image-preview[data-id="${imageId}"]`);
    if (imageEl) {
      this.setImageUploading(imageId, false);
      imageEl.classList.add('error');
      this.showError(error);
    }
  }

  /**
   * Get all selected images
   */
  getImages() {
    return [...this.images];
  }

  /**
   * Get all removed images (for deletion)
   */
  getRemovedImages() {
    return [...this.removedImages];
  }

  /**
   * Clear all images. Resets both the selected and removed lists and emits the
   * unified change events (previously dispatched a non-bubbling 'images-cleared'
   * that silently skipped dirty detection).
   */
  clearImages() {
    this.images = [];
    this.removedImages = [];
    this.updatePreviewContainer();
    this.updateUploadAreaState();
    this._emitChange('images-cleared');
  }

  // --- Unified form-field contract (see FormFieldMixin) ---

  /**
   * @returns {{ images: Array, removed: Array }} the current selection and the
   * list of images marked for deletion.
   */
  getValue() {
    return { images: this.getImages(), removed: this.getRemovedImages() };
  }

  /**
   * Populates the handler from a { images, removed } value and resets the
   * pristine baseline. Existing images keep their preview/url; a primary is
   * ensured if none is flagged.
   * @param {{ images?: Array, removed?: Array }|null} value
   */
  setValue(value) {
    const v = value || {};
    this.images = (Array.isArray(v.images) ? v.images : []).map((img) => ({ ...img }));
    this.removedImages = Array.isArray(v.removed) ? [...v.removed] : [];
    if (this.images.length && !this.images.some((img) => img.isPrimary)) {
      this.images[0].isPrimary = true;
    }
    this.updatePreviewContainer();
    this.updateUploadAreaState();
    this.updateSelectedFiles();
    this.markPristine();
  }

  /** @returns {{ images: Array, removed: Array }} */
  _getEmptyValue() {
    return { images: [], removed: [] };
  }

  /**
   * Clears all images and resets the pristine baseline (unified contract).
   */
  clear() {
    this.clearImages();
    this.markPristine();
    this._emitDirtyChanged();
  }

  /**
   * Compact signature used for dirty tracking — avoids snapshotting megabytes of
   * base64 preview data. Only identity, primary flag, persisted URL, and the
   * removed set affect dirtiness.
   * @returns {Object}
   */
  _dirtySignature() {
    return {
      images: this.images.map((img) => ({
        id: img.id,
        isPrimary: !!img.isPrimary,
        url: img.full || img.uploadedUrl || null,
      })),
      removed: this.removedImages.map((r) => r.id),
    };
  }

  /** @override - compare the compact signature rather than the full value */
  markPristine() {
    this._pristineValue = deepClone(this._dirtySignature());
  }

  /** @override */
  isDirty() {
    if (this._pristineValue === undefined) return false;
    return !deepEqual(this._pristineValue, this._dirtySignature());
  }

  /**
   * Reflects validation errors on the upload zone.
   * @param {Object} errors
   */
  setValidationState(errors = {}) {
    const uploadZone = this.shadowRoot.querySelector('upload-zone');
    if (!uploadZone) return;
    uploadZone.classList.toggle('recipe-form__input--invalid', !!errors.images);
  }

  /**
   * Set maximum number of images allowed
   */
  setMaxImages(count) {
    this.maxImages = count;
    const uploadZone = this.shadowRoot.querySelector('upload-zone');
    if (uploadZone) {
      uploadZone.setAttribute('hint', this.uploadZoneHint);
    }
    this.updateUploadAreaState();
  }

  setDisabled(isDisabled) {
    this._isDisabled = isDisabled;
    const uploadZone = this.shadowRoot.querySelector('upload-zone');
    if (uploadZone) {
      uploadZone.toggleAttribute('disabled', isDisabled);
    }

    const controlButtons = this.shadowRoot.querySelectorAll('.image-preview .control-button');
    controlButtons.forEach((button) => {
      button.disabled = isDisabled;
    });

    const previews = this.shadowRoot.querySelectorAll('.image-preview');
    previews.forEach((preview) => {
      preview.draggable = !isDisabled;
    });
  }
}

customElements.define('image-handler', ImageHandler);
