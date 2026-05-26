import { getFunctions, httpsCallable } from 'firebase/functions';
import { icons } from '../../../js/icons.js';
import Cropper from 'cropperjs';
import '../../modals/confirmation_modal/confirmation_modal.js';
import styles from './recipe_import_modal.css?inline';
import cropperStyles from 'cropperjs/dist/cropper.css?inline';
import memoryGameStyles from '../../games/memory_game.css?inline';
import burgerStackerStyles from '../../games/burger_stacker.css?inline';
import gameWrapperStyles from '../../games/game_wrapper.css?inline';
import { CookingMemoryGame } from '../../games/memory_game.js';
import { BurgerStackerGame } from '../../games/burger_stacker.js';
import { GameWrapper } from '../../games/game_wrapper.js';

class RecipeImportModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.cropper = null;
    this.images = []; // Array of { id, file, imageUrl, processedBase64 }
    this.activeImageId = null;
    this.isLoading = false;
    this.gameWrapper = null;
    this.game = null;
    this.extractedData = null;
    this.importMode = 'image'; // 'image' or 'url'
    this.importUrl = null; // URL used for extraction, included in recipe-extracted event
    this.requestId = 0; // Incremented on reset to invalidate in-flight responses
    this.abortController = null; // Aborts client-side wait when modal is reset mid-flight
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    if (this.cropper) {
      this.cropper.destroy();
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${cropperStyles}
        ${styles}
        ${memoryGameStyles}
        ${burgerStackerStyles}
        ${gameWrapperStyles}
      </style>
      <custom-modal id="import-modal" width="600px">
          <div class="modal-body-content">
            <h2 class="modal-title">ייבא מתכון</h2>

            <!-- Tab Switcher -->
            <div class="import-tabs">
              <button class="tab-btn active" id="tab-image">מתמונה</button>
              <button class="tab-btn" id="tab-url">מכתובת URL</button>
            </div>

            <!-- Initial State: Upload -->
            <div id="upload-view" class="upload-area">
              <div class="upload-icon">${icons.camera}</div>
              <p class="upload-text">לחץ להעלאת תמונות או גרור לכאן</p>
              <input type="file" id="file-input" accept="image/*" multiple style="display: none;">
            </div>

            <!-- URL Input View -->
            <div id="url-view" style="display: none;" class="url-input-container">
              <label for="url-input" class="url-label">הכנס כתובת URL של מתכון:</label>
              <input type="url" id="url-input" class="url-input" placeholder="https://example.com/recipe" dir="ltr">
              <p class="url-help-text">הדבק קישור למתכון מאתר בישול כלשהו</p>
            </div>

            <!-- Preview State: List & Reorder -->
            <div id="preview-view" style="display: none; width: 100%;">
              <div class="images-list" id="images-list"></div>
              <div class="add-more-area" id="add-more-btn">
                <span>+ הוסף תמונה נוספת</span>
              </div>
            </div>

            <!-- Editor State: Crop & Rotate -->
            <div id="editor-view" style="display: none; width: 100%;">
              <div class="editor-container">
                 <img id="image-preview" style="max-width: 100%; display: block;">
              </div>
              <div class="toolbar">
                <button class="tool-btn" id="rotate-left" title="סובב שמאלה">${icons.undoAlt}</button>
                <button class="tool-btn" id="rotate-right" title="סובב ימינה">${icons.redoAlt}</button>
                <button class="tool-btn" id="cancel-crop" title="ביטול">${icons.times}</button>
                <button class="tool-btn" id="save-crop" title="שמור חיתוך">${icons.check}</button>
              </div>
            </div>

            <!-- Loading State -->
            <div id="loading-view" class="loading-container" style="display: none;">
              <div class="loading-status-row" id="loading-status">
                 <div class="loading-dots">
                    <div class="loading-dot"></div>
                    <div class="loading-dot"></div>
                    <div class="loading-dot"></div>
                 </div>
                 <p id="loading-text" style="margin: 0;">מנתח את המתכון... זה עשוי לקחת מספר שניות</p>
              </div>
              
              <div id="success-overlay" class="success-overlay" style="display: none;">
                  <div class="success-badge">המתכון מוכן!</div>
                  <button class="btn btn-primary" id="view-recipe-btn">צפה במתכון</button>
              </div>

              <!-- Inline Error (Non-blocking) -->
              <div id="inline-error-container" class="inline-error" style="display: none;">
                  <span id="inline-error-text">שגיאה</span>
                  <button id="inline-try-again-btn" class="btn-text">נסה שוב</button>
              </div>

              <div id="game-container" style="width: 100%; max-width: 100%; margin-top: 10px; box-sizing: border-box;"></div>
            </div>

            <!-- Error State -->
            <div id="error-view" class="error-container" style="display: none;">
              <p class="error-message" id="error-message">שגיאה בניתוח התמונה</p>
              <button class="btn btn-secondary" id="try-again-btn">נסה שוב</button>
            </div>

            <div class="modal-footer">
                <button class="btn btn-secondary" id="cancel-btn">ביטול</button>
                <button class="btn btn-primary" id="extract-btn" disabled><span id="extract-btn-text">חלץ מתכון</span></button>
            </div>
          </div>
      </custom-modal>
      <confirmation-modal id="close-confirm-modal"></confirmation-modal>
    `;
  }

  setupEventListeners() {
    const modal = this.shadowRoot.getElementById('import-modal');
    const cancelBtn = this.shadowRoot.getElementById('cancel-btn');
    const uploadArea = this.shadowRoot.getElementById('upload-view');
    const fileInput = this.shadowRoot.getElementById('file-input');
    const extractBtn = this.shadowRoot.getElementById('extract-btn');
    const addMoreBtn = this.shadowRoot.getElementById('add-more-btn');

    // Tab switching
    const tabImage = this.shadowRoot.getElementById('tab-image');
    const tabUrl = this.shadowRoot.getElementById('tab-url');
    const urlView = this.shadowRoot.getElementById('url-view');
    const urlInput = this.shadowRoot.getElementById('url-input');

    // Tools
    const rotateLeftBtn = this.shadowRoot.getElementById('rotate-left');
    const rotateRightBtn = this.shadowRoot.getElementById('rotate-right');
    const saveCropBtn = this.shadowRoot.getElementById('save-crop');
    const cancelCropBtn = this.shadowRoot.getElementById('cancel-crop');

    // Error handling
    const tryAgainBtn = this.shadowRoot.getElementById('try-again-btn');

    // Tab switching
    tabImage.addEventListener('click', () => this.switchToTab('image'));
    tabUrl.addEventListener('click', () => this.switchToTab('url'));

    // URL input validation
    urlInput.addEventListener('input', () => this.validateUrlInput());

    // Close Actions
    const close = () => modal.close({ byUser: true });
    cancelBtn.addEventListener('click', close);

    // Listen to modal close event to reset state
    modal.addEventListener('modal-closed', () => {
      // If we have extracted data when closing (e.g. user closed without clicking 'View Recipe'),
      // still emit the event so the parent form can use the data.
      if (this.extractedData) {
        this.dispatchEvent(
          new CustomEvent('recipe-extracted', {
            detail: { data: this.extractedData, sourceUrl: this.importUrl },
            bubbles: true,
            composed: true,
          }),
        );
      }
      this.reset();
    });

    // Upload Actions
    uploadArea.addEventListener('click', () => fileInput.click());
    addMoreBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.addImages(e.target.files);
      }
      fileInput.value = ''; // Reset input
    });

    // Drag & Drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = 'var(--primary, #6a994e)';
    });
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.style.borderColor = '';
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '';
      if (e.dataTransfer.files.length > 0) {
        this.addImages(e.dataTransfer.files);
      }
    });

    // Editor Actions
    rotateLeftBtn.addEventListener('click', () => this.cropper?.rotate(-90));
    rotateRightBtn.addEventListener('click', () => this.cropper?.rotate(90));
    saveCropBtn.addEventListener('click', () => this.saveCrop());
    cancelCropBtn.addEventListener('click', () => this.closeEditor());

    // Extract
    extractBtn.addEventListener('click', () => {
      if (this.importMode === 'image') {
        this.extractRecipe();
      } else {
        this.extractRecipeFromUrl();
      }
    });

    // View Recipe (Success State)
    const viewRecipeBtn = this.shadowRoot.getElementById('view-recipe-btn');
    viewRecipeBtn.addEventListener('click', () => this.finishImport());

    // Try Again
    tryAgainBtn.addEventListener('click', () => this.reset());

    // Inline Try Again
    const inlineTryAgainBtn = this.shadowRoot.getElementById('inline-try-again-btn');
    if (inlineTryAgainBtn) {
      inlineTryAgainBtn.addEventListener('click', () => this.reset());
    }
  }

  addImages(files) {
    const currentCount = this.images.length;
    const newCount = files.length;

    if (currentCount + newCount > 5) {
      alert('ניתן להעלות עד 5 תמונות בלבד');
      return;
    }

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        this.images.push({
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          file: file,
          imageUrl: e.target.result,
          processedBase64: null, // Will be populated on demand or on save
        });
        this.updatePreviewList();
      };
      reader.readAsDataURL(file);
    });
  }

  updatePreviewList() {
    const uploadView = this.shadowRoot.getElementById('upload-view');
    const previewView = this.shadowRoot.getElementById('preview-view');
    const extractBtn = this.shadowRoot.getElementById('extract-btn');
    const imagesList = this.shadowRoot.getElementById('images-list');

    if (this.images.length === 0) {
      uploadView.style.display = 'block';
      previewView.style.display = 'none';
      extractBtn.disabled = true;
      return;
    }

    uploadView.style.display = 'none';
    previewView.style.display = 'block';
    extractBtn.disabled = false;

    imagesList.innerHTML = '';
    this.images.forEach((img, index) => {
      const item = document.createElement('div');
      item.className = 'image-item';
      item.innerHTML = `
        <div class="image-thumb-container">
          <img src="${img.imageUrl}" class="image-thumb">
        </div>
        <div class="image-controls">
          <button class="control-btn move-down" ${index === this.images.length - 1 ? 'disabled' : ''}>${icons.arrowDown}</button>
          <button class="control-btn move-up" ${index === 0 ? 'disabled' : ''}>${icons.arrowUp}</button>
          <button class="control-btn edit-btn">${icons.pencilAlt}</button>
          <button class="control-btn delete-btn">${icons.trashAlt}</button>
        </div>
        <div class="image-number">${index + 1}</div>
      `;

      item.querySelector('.move-up').onclick = () => this.moveImage(index, -1);
      item.querySelector('.move-down').onclick = () => this.moveImage(index, 1);
      item.querySelector('.edit-btn').onclick = () => this.openEditor(img.id);
      item.querySelector('.delete-btn').onclick = () => this.deleteImage(index);

      imagesList.appendChild(item);
    });
  }

  moveImage(index, direction) {
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < this.images.length) {
      const temp = this.images[index];
      this.images[index] = this.images[newIndex];
      this.images[newIndex] = temp;
      this.updatePreviewList();
    }
  }

  deleteImage(index) {
    this.images.splice(index, 1);
    this.updatePreviewList();
  }

  openEditor(imageId) {
    const img = this.images.find((i) => i.id === imageId);
    if (!img) return;

    this.activeImageId = imageId;
    const previewView = this.shadowRoot.getElementById('preview-view');
    const editorView = this.shadowRoot.getElementById('editor-view');
    const imagePreview = this.shadowRoot.getElementById('image-preview');

    previewView.style.display = 'none';
    editorView.style.display = 'block';

    // Use processed image if exists, otherwise original
    const src = img.processedBase64
      ? `data:image/jpeg;base64,${img.processedBase64}`
      : img.imageUrl;
    imagePreview.src = src;

    // Hide footer (submit/cancel) when editing
    this.shadowRoot.querySelector('.modal-footer').style.display = 'none';

    if (this.cropper) {
      this.cropper.destroy();
    }

    this.cropper = new Cropper(imagePreview, {
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      restore: false,
      guides: true,
      center: true,
      highlight: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
    });
  }

  saveCrop() {
    if (!this.cropper || !this.activeImageId) return;

    const img = this.images.find((i) => i.id === this.activeImageId);
    if (img) {
      const canvas = this.cropper.getCroppedCanvas({
        maxWidth: 1024,
        maxHeight: 1024,
      });
      // Store pure base64
      img.processedBase64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      // Update thumbnail (optional, might be heavy if full res, but let's try)
      // Actually finding the thumb by index might be better, but let's just refresh list
    }
    this.closeEditor();
    this.updatePreviewList();
  }

  closeEditor() {
    this.activeImageId = null;
    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }
    this.shadowRoot.getElementById('editor-view').style.display = 'none';
    this.shadowRoot.querySelector('.modal-footer').style.display = 'flex';
    this.updatePreviewList();
  }

  reset() {
    // Reset State Variables
    this.requestId++; // Invalidate any in-flight extraction request
    this.abortController?.abort();
    this.abortController = null;
    this.images = [];
    this.activeImageId = null;
    this.extractedData = null;
    this.importUrl = null;
    this.isLoading = false;
    this.importMode = 'image';

    // Clear close guard in case reset is called while loading
    const importModal = this.shadowRoot.getElementById('import-modal');
    if (importModal) importModal.clearCloseGuard();

    // Cleanup Instances
    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }
    if (this.gameWrapper) {
      this.gameWrapper.destroy();
      this.gameWrapper = null;
    }

    // Reset Elements
    const uploadView = this.shadowRoot.getElementById('upload-view');
    const importTabs = this.shadowRoot.querySelector('.import-tabs');
    const footer = this.shadowRoot.querySelector('.modal-footer');

    if (uploadView) {
      // Visibility Reset
      uploadView.style.display = 'block';
      this.shadowRoot.getElementById('preview-view').style.display = 'none';
      this.shadowRoot.getElementById('editor-view').style.display = 'none';
      this.shadowRoot.getElementById('loading-view').style.display = 'none';
      this.shadowRoot.getElementById('error-view').style.display = 'none';
      this.shadowRoot.getElementById('url-view').style.display = 'none';
      this.shadowRoot.getElementById('success-overlay').style.display = 'none';
      // Reset Inline Error
      this.shadowRoot.getElementById('inline-error-container').style.display = 'none';

      // Restore visibility of persistent elements
      if (importTabs) importTabs.style.display = 'flex';
      if (footer) footer.style.display = 'flex';

      // Input Reset
      this.shadowRoot.getElementById('extract-btn').disabled = true;
      this.shadowRoot.getElementById('file-input').value = '';
      this.shadowRoot.getElementById('url-input').value = '';

      // Reset tab to image mode
      this.importMode = 'image';
      const tabImage = this.shadowRoot.getElementById('tab-image');
      const tabUrl = this.shadowRoot.getElementById('tab-url');
      if (tabImage && tabUrl) {
        tabImage.classList.add('active');
        tabUrl.classList.remove('active');
      }

      // Reset loading state internals
      const loadingStatus = this.shadowRoot.getElementById('loading-status');
      if (loadingStatus) loadingStatus.style.display = 'flex';

      this.shadowRoot.getElementById('loading-text').textContent =
        'זה עשוי לקחת מספר שניות... הנה משחק קטן בינתיים!';
    }
  }

  async extractRecipe() {
    if (this.images.length === 0) return;

    this.setLoading(true);
    const myRequestId = this.requestId;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const imagesToSend = await Promise.all(
        this.images.map(async (img) => {
          let base64 = img.processedBase64;

          if (!base64) {
            // If not processed (cropped), use original.
            // Since imageUrl is dataURL, split it.
            // Note: imageUrl came from FileReader so it's a data URL.
            base64 = img.imageUrl.split(',')[1];
          }

          return {
            base64: base64,
            mimeType: 'image/jpeg', // Assuming jpeg for simplicity or extracting from header
          };
        }),
      );

      if (this.requestId !== myRequestId) return;

      const functions = getFunctions();
      const extractRecipeFromImage = httpsCallable(functions, 'extractRecipeFromImage');

      const abortPromise = new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });

      const result = await Promise.race([
        extractRecipeFromImage({ images: imagesToSend }),
        abortPromise,
      ]);

      if (this.requestId !== myRequestId) return;

      this.showSuccessState(result.data);
    } catch (error) {
      if (error.name === 'AbortError' || this.requestId !== myRequestId) return;
      console.error('Extraction failed:', error);
      this.isLoading = false;
      this.setError(error);
    }
  }

  setLoading(isLoading) {
    this.isLoading = isLoading;
    const importModal = this.shadowRoot.getElementById('import-modal');
    const loadingView = this.shadowRoot.getElementById('loading-view');
    const editorView = this.shadowRoot.getElementById('editor-view');
    const footer = this.shadowRoot.querySelector('.modal-footer');
    const gameContainer = this.shadowRoot.getElementById('game-container');
    const importTabs = this.shadowRoot.querySelector('.import-tabs');

    if (isLoading) {
      importModal.setCloseGuard(async () => {
        return new Promise((resolve) => {
          const confirmModal = this.shadowRoot.getElementById('close-confirm-modal');
          confirmModal.confirm('עיבוד המתכון בתהליך. האם לבטל ולסגור?', '', 'בטל עיבוד', 'המשך');
          confirmModal.addEventListener('confirm-approved', () => resolve(true), { once: true });
          confirmModal.addEventListener('confirm-rejected', () => resolve(false), { once: true });
        });
      });

      loadingView.style.display = 'flex';
      // editorView.style.display = 'none'; // Editor is already closed or irrelevant
      this.shadowRoot.getElementById('preview-view').style.display = 'none'; // Hide preview
      this.shadowRoot.getElementById('url-view').style.display = 'none'; // Hide URL input
      if (importTabs) importTabs.style.display = 'none'; // Hide tabs
      footer.style.display = 'none';

      // Ensure inline error is hidden when starting new loading
      this.shadowRoot.getElementById('inline-error-container').style.display = 'none';
      this.shadowRoot.getElementById('loading-status').style.display = 'flex';

      // Start Game Wrapper
      if (!this.gameWrapper && gameContainer) {
        // Random game selection
        const useBurgerGame = Math.random() > 0.5;

        if (useBurgerGame) {
          this.gameWrapper = new GameWrapper(gameContainer, BurgerStackerGame, {
            successMessage: 'כל הכבוד! הבורגר מוכן!',
            targetHeight: 5,
          });
          this.shadowRoot.getElementById('loading-text').textContent =
            'מכין את המטבח... תפוס את המרכיבים!';
        } else {
          this.gameWrapper = new GameWrapper(gameContainer, CookingMemoryGame, {
            rows: 3,
            successMessage: 'כל הכבוד! הזיכרון שלך חד!',
          });
          this.shadowRoot.getElementById('loading-text').textContent =
            'זה עשוי לקחת מספר שניות... הנה משחק קטן בינתיים!';
        }

        this.gameWrapper.init();
      }
    } else {
      importModal.clearCloseGuard();

      loadingView.style.display = 'none';
      if (importTabs) importTabs.style.display = 'flex'; // Show tabs
      footer.style.display = 'flex';

      // Stop/Destroy Game
      if (this.gameWrapper) {
        this.gameWrapper.destroy();
        this.gameWrapper = null;
      }
    }
  }

  setError(error) {
    // Non-blocking Inline Error Handling
    const inlineErrorContainer = this.shadowRoot.getElementById('inline-error-container');
    const inlineErrorText = this.shadowRoot.getElementById('inline-error-text');
    const loadingStatus = this.shadowRoot.getElementById('loading-status');
    const loadingView = this.shadowRoot.getElementById('loading-view');

    // Determine if we're in URL or image mode
    const isUrlMode = this.importMode === 'url';

    // Error mapping - mode aware
    let displayMessage = isUrlMode
      ? 'אירעה שגיאה בייבוא המתכון מהכתובת. אנא נסה שוב.'
      : 'אירעה שגיאה בעיבוד התמונה. אנא נסה שוב.';
    const rawMessage = error.message || '';

    if (rawMessage.includes('permission-denied') || rawMessage.includes('unauthenticated')) {
      displayMessage = 'אין לך הרשאה לבצע פעולה זו.';
    } else if (rawMessage.includes('invalid-argument')) {
      displayMessage = isUrlMode ? 'כתובת ה-URL אינה תקינה.' : 'התמונה שנשלחה אינה תקינה.';
    } else if (rawMessage.includes('Could not extract')) {
      displayMessage = isUrlMode ? 'לא ניתן לחלץ מתכון מכתובת זו.' : 'לא ניתן לחלץ מתכון מהתמונה.';
    } else if (rawMessage.includes('internal')) {
      displayMessage = 'שגיאה בשרת העיבוד.';
    } else if (rawMessage.includes('quota-exceeded')) {
      displayMessage = 'הגענו למכסת השימוש היומית.';
    } else if (rawMessage.includes('deadline-exceeded') || rawMessage.includes('timeout')) {
      displayMessage = 'הפעולה לקחה זמן רב מדי.';
    } else if (rawMessage.includes('not-found')) {
      displayMessage = 'השירות אינו זמין כעת (404).';
    }

    // Hide status, Show Error, KEEP GAME RUNNING
    if (loadingStatus) loadingStatus.style.display = 'none';

    if (inlineErrorContainer) {
      inlineErrorContainer.style.display = 'flex';
      inlineErrorText.textContent = displayMessage;
    }

    // Ensure loading view stays visible (game continues)
    if (loadingView) loadingView.style.display = 'flex';

    // We do NOT destroy the game here.
    // The user can keep playing until they click "Try Again".
  }

  open() {
    this.reset();
    this.shadowRoot.getElementById('import-modal').open();
  }

  showSuccessState(data) {
    this.extractedData = data;

    // Hide loading dots row
    const loadingStatus = this.shadowRoot.getElementById('loading-status');
    const loadingText = this.shadowRoot.getElementById('loading-text');
    const successOverlay = this.shadowRoot.getElementById('success-overlay');

    if (loadingStatus) loadingStatus.style.display = 'none';

    // Optional: could reuse loadingText for success message, but we used overlay instead.
    // We already have "Recipe Ready" in the badge.
    // If we want to show text:
    // loadingText.textContent = 'הניתוח הושלם! אתה יכול להמשיך לשחק או לצפות במתכון.';

    successOverlay.style.display = 'flex';
  }

  finishImport() {
    if (!this.extractedData) return;

    this.setLoading(false); // This will destroy the game
    this.close(); // This triggers 'modal-closed' which will emit the event
  }

  close() {
    this.shadowRoot.getElementById('import-modal').close();
  }

  switchToTab(mode) {
    this.importMode = mode;

    const tabImage = this.shadowRoot.getElementById('tab-image');
    const tabUrl = this.shadowRoot.getElementById('tab-url');
    const uploadView = this.shadowRoot.getElementById('upload-view');
    const urlView = this.shadowRoot.getElementById('url-view');
    const previewView = this.shadowRoot.getElementById('preview-view');
    const extractBtn = this.shadowRoot.getElementById('extract-btn');
    const extractBtnText = this.shadowRoot.getElementById('extract-btn-text');

    if (mode === 'image') {
      tabImage.classList.add('active');
      tabUrl.classList.remove('active');
      urlView.style.display = 'none';
      extractBtnText.textContent = 'חלץ מתכון';

      if (this.images.length === 0) {
        uploadView.style.display = 'block';
        previewView.style.display = 'none';
        extractBtn.disabled = true;
      } else {
        uploadView.style.display = 'none';
        previewView.style.display = 'block';
        extractBtn.disabled = false;
      }
    } else {
      tabImage.classList.remove('active');
      tabUrl.classList.add('active');
      uploadView.style.display = 'none';
      previewView.style.display = 'none';
      urlView.style.display = 'block';
      extractBtnText.textContent = 'ייבא מכתובת';

      this.validateUrlInput();
    }
  }

  validateUrlInput() {
    const urlInput = this.shadowRoot.getElementById('url-input');
    const extractBtn = this.shadowRoot.getElementById('extract-btn');
    const url = urlInput.value.trim();

    if (url === '') {
      extractBtn.disabled = true;
      return false;
    }

    try {
      new URL(url);
      extractBtn.disabled = false;
      return true;
    } catch (e) {
      extractBtn.disabled = true;
      return false;
    }
  }

  async extractRecipeFromUrl() {
    const urlInput = this.shadowRoot.getElementById('url-input');
    const url = urlInput.value.trim();

    if (!this.validateUrlInput()) {
      return;
    }

    this.importUrl = url;
    this.setLoading(true);
    const myRequestId = this.requestId;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const functions = getFunctions();
      const extractRecipeFromUrlFn = httpsCallable(functions, 'extractRecipeFromUrl');

      const abortPromise = new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });

      const result = await Promise.race([extractRecipeFromUrlFn({ url }), abortPromise]);

      if (this.requestId !== myRequestId) return;

      this.showSuccessState(result.data);
    } catch (error) {
      if (error.name === 'AbortError' || this.requestId !== myRequestId) return;
      console.error('URL extraction failed:', error);
      this.isLoading = false;
      this.setError(error);
    }
  }
}

customElements.define('recipe-import-modal', RecipeImportModal);
