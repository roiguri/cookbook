/**
 * <ai-image-enhancer>
 *
 * Manages recipe selection and image picking for AI enhancement.
 * Shows a scrollable recipe list and, once a recipe is selected, a horizontal
 * image strip. Clicking an image opens <ai-image-enhance-modal> (lazily
 * imported and appended to document.body so it is fully decoupled from any
 * page).
 *
 * Listens for `image-enhanced-saved` from the modal to refresh the affected
 * recipe's image list without a full reload.
 */

import { FirestoreService } from '../../../js/services/_firebase/firestore-service.js';
import { getOptimizedImageUrl } from '../../../js/utils/recipes/recipe-image-utils.js';

class AiImageEnhancer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._recipes = [];
    this._filteredRecipes = [];
    this._selectedRecipe = null;
    this._modal = null;
  }

  connectedCallback() {
    this._render();
    this._loadRecipes();
  }

  disconnectedCallback() {
    if (this._modal) {
      this._modal.remove();
      this._modal = null;
    }
  }

  /**
   * Public refresh API — reloads the recipe list from Firestore and preserves
   * the current selection if the recipe still exists.
   */
  async refresh() {
    await this._loadRecipes();
  }

  // ---------------------------------------------------------------------------
  // Modal (lazy, singleton per enhancer instance)
  // ---------------------------------------------------------------------------

  async _getModal() {
    if (!this._modal) {
      await import('./ai-image-enhance-modal.js');
      this._modal = document.createElement('ai-image-enhance-modal');
      document.body.appendChild(this._modal);
      this._modal.addEventListener('image-enhanced-saved', (e) => {
        this._refreshRecipe(e.detail.recipeId);
      });
    }
    return this._modal;
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  async _loadRecipes() {
    try {
      const all = await FirestoreService.queryDocuments('recipes', {
        where: [['approved', '==', true]],
      });
      this._recipes = all
        .filter((r) => Array.isArray(r.images) && r.images.length > 0)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));

      // Re-sync the selected recipe to its fresh document (or clear it if gone).
      if (this._selectedRecipe) {
        const fresh = this._recipes.find((r) => r.id === this._selectedRecipe.id);
        this._selectedRecipe = fresh || null;
        this._renderImageStrip();
      }

      // Preserve any active search filter; falls back to full list when empty.
      const term = this.shadowRoot.getElementById('search-input')?.value || '';
      this._filterRecipes(term);
    } catch (err) {
      console.error('Failed to load recipes:', err);
      this._setStatus('שגיאה בטעינת מתכונים');
    }
  }

  async _refreshRecipe(recipeId) {
    try {
      const fresh = await FirestoreService.getDocument('recipes', recipeId);
      if (!fresh) return;
      const idx = this._recipes.findIndex((r) => r.id === recipeId);
      if (idx !== -1) this._recipes[idx] = fresh;
      if (this._selectedRecipe?.id === recipeId) {
        this._selectedRecipe = fresh;
        this._renderImageStrip();
      }
      this._filterRecipes(this.shadowRoot.getElementById('search-input')?.value || '');
    } catch (err) {
      console.warn('Failed to refresh recipe:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Recipe list
  // ---------------------------------------------------------------------------

  _filterRecipes(term) {
    const t = (term || '').trim().toLowerCase();
    this._filteredRecipes = t
      ? this._recipes.filter((r) => (r.name || '').toLowerCase().includes(t))
      : this._recipes;
    this._renderRecipeList();
  }

  _renderRecipeList() {
    const list = this.shadowRoot.getElementById('recipe-list');
    if (!list) return;
    list.innerHTML = '';

    if (this._filteredRecipes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'אין מתכונים להצגה';
      list.appendChild(empty);
      return;
    }

    for (const recipe of this._filteredRecipes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'recipe-item';
      if (this._selectedRecipe?.id === recipe.id) item.classList.add('selected');

      const name = document.createElement('span');
      name.className = 'recipe-name';
      name.textContent = recipe.name;

      const count = document.createElement('span');
      count.className = 'recipe-count';
      count.textContent = `${recipe.images.length} תמונות`;

      item.appendChild(name);
      item.appendChild(count);
      item.addEventListener('click', () => this._selectRecipe(recipe));
      list.appendChild(item);
    }
  }

  _selectRecipe(recipe) {
    this._selectedRecipe = recipe;
    this._renderRecipeList();
    this._renderImageStrip();
  }

  // ---------------------------------------------------------------------------
  // Image strip
  // ---------------------------------------------------------------------------

  _renderImageStrip() {
    const strip = this.shadowRoot.getElementById('image-strip');
    const wrap = this.shadowRoot.getElementById('strip-wrap');
    const title = this.shadowRoot.getElementById('strip-title');
    if (!strip || !wrap) return;

    strip.innerHTML = '';

    if (!this._selectedRecipe) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    if (title) title.textContent = this._selectedRecipe.name;

    for (const image of this._selectedRecipe.images) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'image-tile';

      const shimmer = document.createElement('div');
      shimmer.className = 'tile-shimmer';
      tile.appendChild(shimmer);

      const img = document.createElement('img');
      img.alt = image.fileName || image.id;
      img.style.display = 'none';
      tile.appendChild(img);

      if (image.isPrimary) {
        const badge = document.createElement('span');
        badge.className = 'primary-badge';
        badge.textContent = 'ראשית';
        tile.appendChild(badge);
      }

      tile.addEventListener('click', () => this._openModal(image));
      strip.appendChild(tile);

      getOptimizedImageUrl(image, '400x400')
        .then((url) => {
          if (!url) {
            shimmer.style.display = 'none';
            return;
          }
          img.onload = () => {
            img.style.display = 'block';
            shimmer.style.display = 'none';
          };
          img.onerror = () => {
            shimmer.style.display = 'none';
          };
          img.src = url;
        })
        .catch(() => {
          shimmer.style.display = 'none';
        });
    }
  }

  async _openModal(image) {
    const modal = await this._getModal();
    modal.open(this._selectedRecipe, image);
  }

  // ---------------------------------------------------------------------------
  // Status line
  // ---------------------------------------------------------------------------

  _setStatus(msg) {
    const el = this.shadowRoot.getElementById('status');
    if (el) el.textContent = msg;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--font-ui-he, sans-serif);
          color: var(--ink, #1f1d18);
          direction: rtl;
        }

        /* ── Search ── */
        .search-input {
          width: 100%;
          padding: 8px 12px;
          border: 1.5px solid var(--hairline-strong, rgba(31, 29, 24, 0.15));
          border-radius: var(--r-sm, 10px);
          font-family: var(--font-ui-he, sans-serif);
          font-size: 13px;
          background: var(--surface-0, #fff);
          color: var(--ink, #1f1d18);
          outline: none;
          box-sizing: border-box;
          margin-bottom: 8px;
        }

        .search-input:focus {
          border-color: var(--primary, #6a994e);
          box-shadow: var(--ring, 0 0 0 3px rgba(106,153,78,0.18));
        }

        /* ── Recipe list — mirrors scrolling-list card style ── */
        .recipe-list {
          height: 200px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 2px 2px 6px;
          scrollbar-width: thin;
          scrollbar-color: var(--hairline-strong, rgba(31,29,24,0.15)) transparent;
        }

        .recipe-list::-webkit-scrollbar { width: 4px; }
        .recipe-list::-webkit-scrollbar-track { background: transparent; }
        .recipe-list::-webkit-scrollbar-thumb {
          background: var(--hairline-strong, rgba(31,29,24,0.15));
          border-radius: 2px;
        }

        .recipe-item {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          padding: 10px 14px;
          background: var(--surface-1, #fff);
          border: 1px solid var(--hairline, rgba(31, 29, 24, 0.08));
          border-radius: var(--r-sm, 8px);
          cursor: pointer;
          text-align: start;
          font-family: var(--font-ui-he, sans-serif);
          font-size: 14px;
          color: var(--ink, #1f1d18);
          line-height: 1.4;
          box-sizing: border-box;
          transition: border-color var(--dur-1, 160ms), box-shadow var(--dur-1, 160ms);
        }

        .recipe-item:hover {
          border-color: var(--hairline-strong, rgba(31,29,24,0.15));
          box-shadow: var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
        }

        .recipe-item.selected {
          border-color: var(--primary, #6a994e);
          box-shadow: 0 0 0 1px var(--primary, #6a994e),
                      var(--shadow-1, 0 1px 4px rgba(31,29,24,0.08));
          background: rgba(106, 153, 78, 0.04);
        }

        .recipe-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .recipe-count {
          flex-shrink: 0;
          font-size: 11px;
          color: var(--ink-3, rgba(31, 29, 24, 0.55));
          background: var(--surface-2, #f0ede6);
          padding: 2px 8px;
          border-radius: var(--r-pill, 999px);
        }

        .empty {
          padding: 16px;
          text-align: center;
          color: var(--ink-3, rgba(31, 29, 24, 0.55));
          font-size: 13px;
        }

        /* ── Image strip ── */
        .strip-wrap {
          margin-top: 14px;
        }

        .strip-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-3, rgba(31, 29, 24, 0.55));
          margin-bottom: 8px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .image-strip {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          padding-bottom: 6px;
          scrollbar-width: thin;
          scrollbar-color: var(--hairline-strong, rgba(31,29,24,0.15)) transparent;
        }

        .image-strip::-webkit-scrollbar { height: 4px; }
        .image-strip::-webkit-scrollbar-track { background: transparent; }
        .image-strip::-webkit-scrollbar-thumb {
          background: var(--hairline-strong, rgba(31,29,24,0.15));
          border-radius: 2px;
        }

        .image-tile {
          flex-shrink: 0;
          scroll-snap-align: start;
          position: relative;
          width: 88px;
          height: 88px;
          border: 2px solid var(--hairline, rgba(31,29,24,0.08));
          border-radius: var(--r-sm, 10px);
          padding: 0;
          background: var(--surface-2, #f0ede6);
          cursor: pointer;
          overflow: hidden;
          transition: border-color var(--dur-1, 160ms), box-shadow var(--dur-1, 160ms);
        }

        .image-tile:hover {
          border-color: var(--primary, #6a994e);
          box-shadow: 0 0 0 2px rgba(106, 153, 78, 0.2);
        }

        .image-tile img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .tile-shimmer {
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

        .primary-badge {
          position: absolute;
          top: 4px;
          inset-inline-start: 4px;
          background: var(--primary, #6a994e);
          color: #fff;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: var(--r-pill, 999px);
          pointer-events: none;
        }

        /* ── Status ── */
        .status {
          margin-top: 8px;
          font-size: 12px;
          color: var(--ink-3, rgba(31, 29, 24, 0.55));
          min-height: 16px;
        }
      </style>

      <input
        id="search-input"
        class="search-input"
        type="text"
        placeholder="חיפוש מתכון..."
        dir="rtl"
      />
      <div id="recipe-list" class="recipe-list"></div>

      <div id="strip-wrap" class="strip-wrap" hidden>
        <div id="strip-title" class="strip-label"></div>
        <div id="image-strip" class="image-strip"></div>
      </div>

      <div id="status" class="status"></div>
    `;

    this.shadowRoot.getElementById('search-input').addEventListener('input', (e) => {
      this._filterRecipes(e.target.value);
    });
  }
}

if (!customElements.get('ai-image-enhancer')) {
  customElements.define('ai-image-enhancer', AiImageEnhancer);
}

export default AiImageEnhancer;
