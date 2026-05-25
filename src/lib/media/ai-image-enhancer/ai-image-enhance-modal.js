/**
 * <ai-image-enhance-modal>
 *
 * Standalone modal for AI-enhancing a single recipe image. Receives a recipe
 * and image via open(recipe, image). Handles the full enhancement lifecycle:
 * fetch → enhance via Cloud Function → before/after compare → save or discard.
 *
 * Decoupled from any page — mount once (e.g. appended to document.body by the
 * caller) and reuse across invocations. Fires `image-enhanced-saved` (composed)
 * on a successful save.
 */

import { enhanceFoodImage } from '../../../js/services/recipes/ai-enhancement-service.js';
import { RecipeService } from '../../../js/services/recipes/recipe-service.js';
import { RecipeImageService } from '../../../js/services/recipes/recipe-image-service.js';
import { icons } from '../../../js/icons.js';
import '../../utilities/modal/modal.js';

const MAX_INPUT_DIMENSION = 1536;
const JPEG_QUALITY = 0.92;
const FREE_TEXT_MAX_LENGTH = 500;

// Parameter UI mapping. The KEY values (moody, flat-lay, etc.) must match the
// server-side PARAMETER_TAXONOMY exactly — they cross the wire as-is. The
// labels are Hebrew strings rendered in the <select> options.
const PARAMETER_UI = {
  lighting: {
    label: 'תאורה',
    options: {
      natural: 'טבעית',
      commercial: 'סטודיו',
      moody: 'דרמטית',
      'golden-hour': 'אור זהוב',
      backlit: 'אור מאחור',
    },
  },
  angle: {
    label: 'זווית צילום',
    options: {
      'flat-lay': 'מבט עליון',
      hero: 'זווית 45°',
      portrait: 'זווית נמוכה',
      macro: 'תקריב',
      'side-profile': 'מבט מהצד',
    },
  },
  surface: {
    label: 'משטח',
    options: {
      marble: 'שיש',
      wood: 'עץ כפרי',
      concrete: 'בטון',
      linen: 'בד פשתן',
      slate: 'אבן כהה',
    },
  },
  styling: {
    label: 'סגנון עיצוב',
    options: {
      clean: 'נקי',
      editorial: 'עריכותי',
      'ingredient-led': 'מבוסס מרכיבים',
      'rustic-spread': 'מטבח כפרי',
      'gourmet-plated': 'גורמה',
    },
  },
};

const PARAMETER_AXES = Object.keys(PARAMETER_UI);

class AiImageEnhanceModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._recipe = null;
    this._image = null;
    this._enhancedResult = null;
    this._isLoading = false;
    this._beforeUrl = null;
    this._viewer = null;
  }

  connectedCallback() {
    this._render();
    this._bindEvents();
  }

  disconnectedCallback() {
    if (this._viewer) {
      this._viewer.remove();
      this._viewer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  open(recipe, image) {
    this._recipe = recipe;
    this._image = image;
    this._enhancedResult = null;
    this._isLoading = false;
    this._beforeUrl = null;

    this._updateTitle();
    this._setStatus('');
    this._clearAfterImage();
    this._setSavingOverlay(false);
    this._resetParameterControls();
    this._updateActions();
    this._loadBeforeImage();

    const modal = this.shadowRoot.getElementById('custom-modal');
    modal?.clearCloseGuard();
    modal?.open();
  }

  // ---------------------------------------------------------------------------
  // Fullscreen viewer (lazy, singleton per modal instance)
  // ---------------------------------------------------------------------------

  async _getViewer() {
    if (!this._viewer) {
      await import('../fullscreen-media-viewer/fullscreen-media-viewer.js');
      this._viewer = document.createElement('fullscreen-media-viewer');
      this._viewer.setAttribute('dir', 'rtl');
      document.body.appendChild(this._viewer);
    }
    return this._viewer;
  }

  async _openViewer(startPane) {
    const items = [];
    if (this._beforeUrl) items.push({ path: this._beforeUrl, caption: 'לפני', type: 'image' });
    if (this._enhancedResult)
      items.push({ path: this._enhancedResult.dataUrl, caption: 'אחרי', type: 'image' });
    if (items.length === 0) return;

    const index =
      startPane === 'after' && this._enhancedResult
        ? items.findIndex((i) => i.caption === 'אחרי')
        : 0;

    const viewer = await this._getViewer();
    viewer.setAttribute('media-data', JSON.stringify(items));
    viewer.open(Math.max(0, index));
  }

  // ---------------------------------------------------------------------------
  // Internal: open / close
  // ---------------------------------------------------------------------------

  _close() {
    this._setSavingOverlay(false);
    const modal = this.shadowRoot.getElementById('custom-modal');
    modal?.close();
  }

  // ---------------------------------------------------------------------------
  // Internal: UI helpers
  // ---------------------------------------------------------------------------

  _updateTitle() {
    const el = this.shadowRoot.getElementById('modal-title');
    if (el && this._recipe) el.textContent = `שיפור תמונה — ${this._recipe.name}`;
  }

  async _loadBeforeImage() {
    const img = this.shadowRoot.getElementById('before-img');
    const spinner = this.shadowRoot.getElementById('before-loading');
    if (!img || !this._image) return;

    img.style.display = 'none';
    img.removeAttribute('src');
    if (spinner) spinner.style.display = 'flex';

    try {
      const url = await RecipeImageService.getOptimizedUrl(this._image, '1080x1080');
      if (url) {
        img.onload = () => {
          img.style.display = 'block';
          if (spinner) spinner.style.display = 'none';
          this._beforeUrl = url;
          this._updatePaneHints();
        };
        img.onerror = () => {
          if (spinner) spinner.style.display = 'none';
        };
        img.src = url;
      } else {
        if (spinner) spinner.style.display = 'none';
      }
    } catch {
      if (spinner) spinner.style.display = 'none';
    }
  }

  _clearAfterImage() {
    const img = this.shadowRoot.getElementById('after-img');
    const placeholder = this.shadowRoot.getElementById('after-placeholder');
    const loading = this.shadowRoot.getElementById('after-loading');
    if (img) img.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  }

  _setAfterPaneLoading(isLoading) {
    const img = this.shadowRoot.getElementById('after-img');
    const placeholder = this.shadowRoot.getElementById('after-placeholder');
    const loading = this.shadowRoot.getElementById('after-loading');
    if (isLoading) {
      if (img) img.style.display = 'none';
      if (placeholder) placeholder.style.display = 'none';
      if (loading) loading.style.display = 'block';
    } else if (loading) {
      loading.style.display = 'none';
    }
  }

  _setSavingOverlay(isSaving) {
    const overlay = this.shadowRoot.getElementById('saving-overlay');
    if (overlay) overlay.hidden = !isSaving;
    // Also block the modal's user-initiated close paths (ESC, click-outside,
    // close button) while saving. The visual overlay covers the close button
    // pointer-events; the guard handles the keyboard / backdrop click paths.
    const modal = this.shadowRoot.getElementById('custom-modal');
    if (!modal) return;
    if (isSaving) {
      modal.setCloseGuard(() => false);
    } else {
      modal.clearCloseGuard();
    }
  }

  _updatePaneHints() {
    const beforePane = this.shadowRoot.getElementById('before-pane');
    const afterPane = this.shadowRoot.getElementById('after-pane');
    if (beforePane) beforePane.classList.toggle('pane-clickable', !!this._beforeUrl);
    if (afterPane) afterPane.classList.toggle('pane-clickable', !!this._enhancedResult);
  }

  /**
   * Reads the current parameter dropdowns. Empty-string selections (the
   * "אוטומטי" option's value) collapse to `undefined` so the server treats
   * them as unset and lets the model choose.
   * @returns {Object} Object with one key per axis; only set keys included.
   */
  _readParameters() {
    const sr = this.shadowRoot;
    const out = {};
    for (const axis of PARAMETER_AXES) {
      const sel = sr.getElementById(`param-${axis}`);
      const value = sel?.value || '';
      if (value) out[axis] = value;
    }
    return out;
  }

  _readFreeText() {
    const ta = this.shadowRoot.getElementById('free-text');
    return (ta?.value || '').trim();
  }

  /**
   * Writes a parameters object back into the dropdowns. `null` values leave
   * the dropdown on "אוטומטי". Used after a successful enhance to surface
   * the model's picks.
   */
  _writeParameters(parameters) {
    if (!parameters) return;
    const sr = this.shadowRoot;
    for (const axis of PARAMETER_AXES) {
      const sel = sr.getElementById(`param-${axis}`);
      if (!sel) continue;
      const value = parameters[axis];
      sel.value = value && PARAMETER_UI[axis].options[value] ? value : '';
    }
  }

  _resetParameterControls() {
    const sr = this.shadowRoot;
    for (const axis of PARAMETER_AXES) {
      const sel = sr.getElementById(`param-${axis}`);
      if (sel) sel.value = '';
    }
    const ta = sr.getElementById('free-text');
    if (ta) ta.value = '';
  }

  _setStatus(message) {
    const el = this.shadowRoot.getElementById('status');
    if (el) el.textContent = message;
  }

  _updateActions() {
    const sr = this.shadowRoot;
    const enhanceBtn = sr.getElementById('enhance-btn');
    const saveBtn = sr.getElementById('save-btn');
    const discardBtn = sr.getElementById('discard-btn');
    if (!enhanceBtn) return;

    const hasResult = !!this._enhancedResult;
    enhanceBtn.style.display = hasResult ? 'none' : '';
    enhanceBtn.disabled = this._isLoading;
    enhanceBtn.textContent = this._isLoading ? 'מעבד...' : 'שפר תמונה';

    saveBtn.style.display = hasResult ? '' : 'none';
    discardBtn.style.display = hasResult ? '' : 'none';
    saveBtn.disabled = this._isLoading;
    discardBtn.disabled = this._isLoading;

    // Lock the parameter dropdowns + free-text once a result is showing — they
    // belong to the next enhance call, not the current one. Discard frees them
    // again (it clears _enhancedResult and triggers _updateActions).
    const formDisabled = this._isLoading || hasResult;
    for (const axis of PARAMETER_AXES) {
      const sel = sr.getElementById(`param-${axis}`);
      if (sel) sel.disabled = formDisabled;
    }
    const ta = sr.getElementById('free-text');
    if (ta) ta.disabled = formDisabled;
  }

  // ---------------------------------------------------------------------------
  // Internal: enhancement + save
  // ---------------------------------------------------------------------------

  async _enhance() {
    if (!this._image || this._isLoading) return;

    this._isLoading = true;
    this._enhancedResult = null;
    this._updateActions();
    this._setAfterPaneLoading(true);
    this._setStatus('שולח לשיפור בעזרת AI...');

    try {
      const downloadUrl = await RecipeImageService.getFullUrl(this._image);
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
      const sourceBlob = await response.blob();

      const { base64, mimeType } = await this._preparePayload(sourceBlob);

      const parameters = this._readParameters();
      const instruction = this._readFreeText();

      const data = await enhanceFoodImage({
        image: { base64, mimeType },
        parameters: Object.keys(parameters).length ? parameters : undefined,
        instruction: instruction || undefined,
      });

      const outMime = data.mimeType || 'image/png';
      const enhancedBlob = await this._base64ToBlob(data.base64, outMime);
      const dataUrl = `data:${outMime};base64,${data.base64}`;

      this._enhancedResult = { blob: enhancedBlob, dataUrl, mimeType: outMime };

      // Surface the model's picks in the dropdowns so the user sees what was
      // applied. User overrides win when set (the server echoes them back, but
      // we fall back to the user value if the PARAMS line was malformed for
      // an axis).
      const selected = data.selectedParameters || {};
      const surfaced = {};
      for (const axis of PARAMETER_AXES) {
        surfaced[axis] = parameters[axis] || selected[axis] || null;
      }
      this._writeParameters(surfaced);

      const afterImg = this.shadowRoot.getElementById('after-img');
      const afterPlaceholder = this.shadowRoot.getElementById('after-placeholder');
      this._setAfterPaneLoading(false);
      if (afterImg) {
        afterImg.src = dataUrl;
        afterImg.style.display = 'block';
      }
      if (afterPlaceholder) afterPlaceholder.style.display = 'none';
      this._updatePaneHints();
      this._setStatus('התמונה שופרה. ניתן לשמור או לבטל.');
    } catch (error) {
      console.error('Image enhancement failed:', error);
      // Restore the placeholder so the after pane stops looking like it's loading.
      this._clearAfterImage();
      this._setStatus(this._formatError(error));
    } finally {
      this._isLoading = false;
      this._updateActions();
    }
  }

  async _save() {
    if (!this._enhancedResult || !this._recipe || !this._image) return;

    this._isLoading = true;
    this._updateActions();
    this._setSavingOverlay(true);
    this._setStatus('שומר את התמונה החדשה...');

    try {
      const { backupPath, backupCreated } = await RecipeService.replaceImage(
        this._recipe.id,
        this._image.id,
        this._enhancedResult.blob,
        { fieldUpdates: { aiEnhanced: true } },
      );

      this._setStatus('התמונה הוחלפה. התמונה המקורית נשמרה כגיבוי.');

      this.dispatchEvent(
        new CustomEvent('image-enhanced-saved', {
          bubbles: true,
          composed: true,
          detail: {
            recipeId: this._recipe.id,
            imageId: this._image.id,
            backupPath,
            backupCreated,
          },
        }),
      );

      setTimeout(() => this._close(), 1200);
    } catch (error) {
      console.error('Save failed:', error);
      this._setSavingOverlay(false);
      this._setStatus(this._formatError(error));
    } finally {
      this._isLoading = false;
      this._updateActions();
    }
  }

  _discard() {
    this._enhancedResult = null;
    this._clearAfterImage();
    this._updatePaneHints();
    this._resetParameterControls();
    this._setStatus('');
    this._updateActions();
  }

  _formatError(error) {
    const code = error?.code || '';
    if (code === 'functions/unauthenticated') return 'יש להתחבר כדי להשתמש בתכונה זו.';
    if (code === 'functions/permission-denied') return 'אין הרשאה — תכונה זו זמינה למנהלים בלבד.';
    return error?.message ? `שגיאה: ${error.message}` : 'שגיאה בשיפור התמונה';
  }

  // ---------------------------------------------------------------------------
  // Internal: image utilities
  // ---------------------------------------------------------------------------

  async _preparePayload(blob) {
    const bitmap = await this._blobToBitmap(blob);
    const { width, height } = this._fitWithin(
      bitmap.width,
      bitmap.height,
      MAX_INPUT_DIMENSION,
      MAX_INPUT_DIMENSION,
    );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
  }

  _fitWithin(srcW, srcH, maxW, maxH) {
    const ratio = Math.min(1, maxW / srcW, maxH / srcH);
    return { width: Math.round(srcW * ratio), height: Math.round(srcH * ratio) };
  }

  async _blobToBitmap(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  async _base64ToBlob(base64, mimeType) {
    return (await fetch(`data:${mimeType};base64,${base64}`)).blob();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _bindEvents() {
    const sr = this.shadowRoot;
    sr.getElementById('enhance-btn').addEventListener('click', () => this._enhance());
    sr.getElementById('save-btn').addEventListener('click', () => this._save());
    sr.getElementById('discard-btn').addEventListener('click', () => this._discard());
    sr.getElementById('before-pane').addEventListener('click', () => {
      if (this._beforeUrl) this._openViewer('before');
    });
    sr.getElementById('after-pane').addEventListener('click', () => {
      if (this._enhancedResult) this._openViewer('after');
    });
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          font-family: var(--font-ui-he, sans-serif);
        }

        /* Width-sized for the AI-enhance content. The shared <custom-modal>
           handles backdrop, scrollbar compensation, ESC, focus trap, etc. */
        custom-modal {
          --modal-width: 640px;
        }

        .title {
          margin: 0 0 16px;
          font-family: var(--font-ui-he, sans-serif);
          font-size: 16px;
          font-weight: 600;
          color: var(--ink, #1f1d18);
          /* Clear the close button (top-left in RTL) on the title's row. */
          padding-inline-end: 40px;
        }

        @media (max-width: 540px) {
          .title {
            font-size: 15px;
            padding-inline-end: 36px;
            margin-bottom: 10px;
          }
        }

        .compare {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        @media (max-width: 540px) {
          .compare { gap: 8px; }
        }

        .compare-pane {
          position: relative;
          background: var(--surface-2, #f0ede6);
          border-radius: var(--r-md, 14px);
          overflow: hidden;
          aspect-ratio: 1 / 1;
        }

        .compare-pane img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
          background: var(--surface-2, #f0ede6);
        }

        .pane-shimmer {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            var(--surface-2, #f0ede6) 0%,
            rgba(255, 255, 255, 0.65) 50%,
            var(--surface-2, #f0ede6) 100%
          );
          background-size: 200% 100%;
          animation: shimmer 1.4s ease-in-out infinite;
        }

        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .after-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: var(--ink-4, rgba(31, 29, 24, 0.35));
          font-size: 12px;
          text-align: center;
          padding: 12px;
          box-sizing: border-box;
          user-select: none;
        }

        .placeholder-icon {
          font-size: 32px;
          opacity: 0.4;
          line-height: 1;
        }

        .compare-label {
          position: absolute;
          top: 6px;
          inset-inline-start: 6px;
          z-index: 1;
          background: rgba(31, 29, 24, 0.7);
          color: #fff;
          font-size: 11px;
          padding: 2px 8px;
          border-radius: var(--r-pill, 999px);
          pointer-events: none;
        }

        .compare-pane.pane-clickable {
          cursor: zoom-in;
        }

        .compare-pane.pane-clickable:hover img {
          filter: brightness(1.06);
        }

        .advanced {
          margin-top: 14px;
          border: 1px solid var(--hairline, rgba(31, 29, 24, 0.12));
          border-radius: var(--r-md, 12px);
          background: var(--surface-0, #fafaf8);
        }

        .advanced-title {
          padding: 10px 14px 6px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-3, rgba(31, 29, 24, 0.55));
          user-select: none;
        }

        .advanced-body {
          padding: 0 14px 14px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 14px;
        }

        @media (max-width: 540px) {
          .advanced-body {
            padding: 0 12px 12px;
            gap: 8px 10px;
          }
          .advanced-title { padding: 8px 12px 4px; }
        }

        .param-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .param-field label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: var(--ink-3, rgba(31, 29, 24, 0.55));
        }

        .param-field select,
        .free-text-field textarea {
          padding: 7px 10px;
          border: 1.5px solid var(--hairline-strong, rgba(31, 29, 24, 0.15));
          border-radius: var(--r-sm, 8px);
          font-family: var(--font-ui-he, sans-serif);
          font-size: 13px;
          background: var(--surface-0, #fff);
          color: var(--ink, #1f1d18);
          outline: none;
          box-sizing: border-box;
        }

        .param-field select:focus,
        .free-text-field textarea:focus {
          border-color: var(--primary, #6a994e);
          box-shadow: var(--ring, 0 0 0 3px rgba(106, 153, 78, 0.18));
        }

        .param-field select:disabled,
        .free-text-field textarea:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          background: var(--surface-2, #f0ede6);
        }

        .free-text-field {
          grid-column: 1 / -1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .free-text-field textarea {
          resize: vertical;
          min-height: 44px;
          max-height: 120px;
          font-family: var(--font-ui-he, sans-serif);
          line-height: 1.4;
        }

        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }

        button.action {
          font-family: var(--font-ui-he, sans-serif);
          font-size: 13px;
          font-weight: 500;
          padding: 8px 18px;
          border-radius: var(--r-pill, 999px);
          cursor: pointer;
          border: 1.5px solid transparent;
          transition: background-color var(--dur-1, 160ms) var(--ease, ease),
                      color var(--dur-1, 160ms) var(--ease, ease);
        }

        button.action:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        button.primary {
          background: var(--primary, #6a994e);
          color: #fff;
        }

        button.primary:hover:not(:disabled) {
          background: var(--primary-dark, #557a3e);
        }

        button.ghost {
          background: transparent;
          color: var(--primary-dark, #557a3e);
          border-color: var(--primary-dark, #557a3e);
        }

        button.ghost:hover:not(:disabled) {
          background: rgba(106, 153, 78, 0.08);
        }

        button.danger {
          background: transparent;
          color: var(--secondary, #bc4749);
          border-color: var(--secondary, #bc4749);
        }

        button.danger:hover:not(:disabled) {
          background: rgba(188, 71, 73, 0.08);
        }

        .status {
          margin-top: 10px;
          font-size: 12px;
          color: var(--ink-3, rgba(31, 29, 24, 0.55));
          min-height: 16px;
        }

        .saving-overlay {
          position: fixed;
          inset: 0;
          background: rgba(255, 255, 255, 0.88);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          z-index: calc(var(--z-modal, 2000) + 1);
        }

        .saving-overlay[hidden] {
          display: none;
        }

        .spinner {
          width: 38px;
          height: 38px;
          border: 3px solid var(--hairline, rgba(31, 29, 24, 0.12));
          border-top-color: var(--primary, #6a994e);
          border-radius: 50%;
          animation: spin 0.9s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .saving-text {
          font-family: var(--font-ui-he, sans-serif);
          font-size: 13px;
          font-weight: 500;
          color: var(--ink, #1f1d18);
        }
      </style>

      <custom-modal id="custom-modal" width="640px">
        <h2 id="modal-title" class="title"></h2>

        <div class="compare">
          <div id="before-pane" class="compare-pane">
            <span class="compare-label">לפני</span>
            <img id="before-img" alt="לפני" style="display: none;" />
            <div id="before-loading" class="pane-shimmer"></div>
          </div>
          <div id="after-pane" class="compare-pane">
            <span class="compare-label">אחרי</span>
            <img id="after-img" alt="אחרי" style="display: none;" />
            <div id="after-loading" class="pane-shimmer" style="display: none;"></div>
            <div id="after-placeholder" class="after-placeholder">
              <span class="placeholder-icon">${icons.magic}</span>
              <span>התמונה המשופרת<br/>תופיע כאן</span>
            </div>
          </div>
        </div>

        <section class="advanced" aria-labelledby="advanced-title">
          <div id="advanced-title" class="advanced-title">אפשרויות מתקדמות</div>
          <div class="advanced-body">
            ${PARAMETER_AXES.map(
              (axis) => `
            <div class="param-field">
              <label for="param-${axis}">${PARAMETER_UI[axis].label}</label>
              <select id="param-${axis}">
                <option value="">אוטומטי</option>
                ${Object.entries(PARAMETER_UI[axis].options)
                  .map(([value, label]) => `<option value="${value}">${label}</option>`)
                  .join('')}
              </select>
            </div>`,
            ).join('')}
            <div class="free-text-field">
              <label for="free-text">הוראות נוספות (אופציונלי)</label>
              <textarea
                id="free-text"
                maxlength="${FREE_TEXT_MAX_LENGTH}"
                rows="2"
                placeholder="לדוגמה: סגנון איטלקי כפרי, פחות גרניש..."
              ></textarea>
            </div>
          </div>
        </section>

        <div class="actions">
          <button id="enhance-btn" class="action primary">שפר תמונה</button>
          <button id="save-btn" class="action ghost" style="display: none;">שמור והחלף</button>
          <button id="discard-btn" class="action danger" style="display: none;">בטל</button>
        </div>

        <div id="status" class="status"></div>
      </custom-modal>

      <div id="saving-overlay" class="saving-overlay" hidden>
        <div class="spinner" role="status" aria-label="שומר"></div>
        <div class="saving-text">שומר את התמונה...</div>
      </div>
    `;
  }
}

if (!customElements.get('ai-image-enhance-modal')) {
  customElements.define('ai-image-enhance-modal', AiImageEnhanceModal);
}

export default AiImageEnhanceModal;
