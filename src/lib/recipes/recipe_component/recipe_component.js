import { icons } from '../../../js/icons.js';
import authService from '../../../js/services/auth/auth-service.js';
import { AppConfig } from '../../../js/config/app-config.js';
import { RecipeService } from '../../../js/services/recipes/recipe-service.js';
import {
  getRecipeById,
  getLocalizedCategoryName,
  formatCookingTime,
} from '../../../js/utils/recipes/recipe-data-utils.js';
import { getRecipeImages } from '../../../js/utils/recipes/recipe-image-utils.js';
import { RecipeImageService } from '../../../js/services/recipes/recipe-image-service.js';
import {
  formatIngredientAmount,
  scaleIngredients,
} from '../../../js/utils/recipes/recipe-ingredients-utils.js';
import { MediaInstructionService } from '../../../js/services/recipes/media-instruction-service.js';

import '../../media/image-carousel/image-carousel.js';
import '../../media/media-scroller/media-scroller.js';
import '../../media/fullscreen-media-viewer/fullscreen-media-viewer.js';
import './parts/cook-mode-container.js';
import '../recipe_strip/recipe_strip.js';

/**
 * Recipe Component
 *
 * A reusable web component for displaying recipe information.
 *
 * Usage:
 *
 * 1. Include the `recipe-component.js` script in your HTML file.
 * 2. Add the `<recipe-component>` element to your page.
 * 3. Set the `recipe-id` attribute to the ID of the recipe you want to display.
 *
 * Example:
 *
 * <recipe-component recipe-id="recipe123"></recipe-component>
 *
 * Attributes:
 *
 * - `recipe-id`: The ID of the recipe to display.
 */
class RecipeComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this._originalIngredients = null;
    this._imageRequestId = 0;
  }

  static get observedAttributes() {
    return ['recipe-id', 'initial-servings', 'active-step'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    // Only reload if the component is already connected and the recipe-id actually changed
    if (name === 'recipe-id' && oldValue !== newValue && this.isConnected && this.shadowRoot) {
      this.recipeId = newValue;
      this.fetchAndPopulateRecipeData();
    } else if (name === 'active-step' && this.isConnected && this.shadowRoot) {
      this.scrollToStep(parseInt(newValue));
    }
  }

  connectedCallback() {
    this.render();
    this.recipeId = this.getAttribute('recipe-id');
    if (this.recipeId) {
      this.fetchAndPopulateRecipeData();
    }
  }

  disconnectedCallback() {
    // Clean up event listener to prevent memory leaks
    const scroller = this.shadowRoot?.getElementById('Recipe_component__media-scroller');
    if (scroller && this._handleMediaClick) {
      scroller.removeEventListener('itemclick', this._handleMediaClick);
    }

    // Release handler reference for garbage collection
    this._handleMediaClick = null;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${this.styles()}</style>
      <div dir="rtl" class="Recipe_component">

        <header class="recipe_component__header">
          <span id="Recipe_component__category" class="Recipe_component__eyebrow"></span>
          <h1 id="Recipe_component__name" class="Recipe_component__title"></h1>
          <p id="Recipe_component__description" class="Recipe_component__description"></p>
          <button id="Recipe_component__show-more" class="Recipe_component__show-more">הצג עוד</button>
          <div id="Recipe_component__meta-strip" class="Recipe_component__meta-strip">
            <div class="Recipe_component__meta-cell">
              <div class="Recipe_component__meta-k">זמן הכנה</div>
              <div id="Recipe_component__prepTime" class="Recipe_component__meta-v"></div>
            </div>
            <div class="Recipe_component__meta-cell">
              <div class="Recipe_component__meta-k">זמן המתנה</div>
              <div id="Recipe_component__waitTime" class="Recipe_component__meta-v"></div>
            </div>
            <div class="Recipe_component__meta-cell">
              <div class="Recipe_component__meta-k">רמת קושי</div>
              <div id="Recipe_component__difficulty" class="Recipe_component__meta-v"></div>
            </div>
            <div id="Recipe_component__attribution-row" class="Recipe_component__attribution-row" style="display: none;">
              <span class="Recipe_component__attribution-label">מקור:</span>
              <span id="Recipe_component__attribution" class="Recipe_component__attribution-value"></span>
            </div>
          </div>
        </header>

        <div class="Recipe_component__image-container"></div>

        <cook-mode-container></cook-mode-container>

        <div class="Recipe_component__content">

          <div class="Recipe_component__instructions">
            <div id="Recipe_component__instructions-list"></div>
          </div>

          <aside class="Recipe_component__details">
            <input name="disable-pwd-mgr-1" type="password" id="disable-pwd-mgr-1" style="display: none;" value="disable-pwd-mgr-1" />
            <input name="disable-pwd-mgr-2" type="password" id="disable-pwd-mgr-2" style="display: none;" value="disable-pwd-mgr-2" />
            <input name="disable-pwd-mgr-3" type="password" id="disable-pwd-mgr-3" style="display: none;" value="disable-pwd-mgr-3" />
            <div class="Recipe_component__ing-header">
              <h3 class="Recipe_component__ing-title">מצרכים</h3>
              <div class="Recipe_component__serving-adjuster">
                <div class="Recipe_component__yield-num">
                  <button class="Recipe_component__yield-btn" id="Recipe_component__servings-dec" aria-label="פחות" type="button">−</button>
                  <input type="number" id="Recipe_component__servings" name="servings" value="4" min="1" aria-label="מספר מנות" />
                  <button class="Recipe_component__yield-btn" id="Recipe_component__servings-inc" aria-label="יותר" type="button">+</button>
                </div>
              </div>
            </div>
            <ul id="Recipe_component__ingredients-list" class="Recipe_component__ingredients-list"></ul>
          </aside>

        </div>

        <div class="Recipe_component__media-instructions" id="Recipe_component__media-section" style="display: none;">
          <h2>טיפים מצולמים:</h2>
          <media-scroller
            id="Recipe_component__media-scroller"
            item-height="auto"
            item-width="280px">
          </media-scroller>
        </div>
        <fullscreen-media-viewer id="Recipe_component__media-viewer"></fullscreen-media-viewer>
        <div class="Recipe_component__comments" style="display: none;">
          <h2>הערות:</h2>
          <ul id="Recipe_component__comments-list" class="Recipe_component__comments-list"></ul>
        </div>

        <div class="Recipe_component__related" id="Recipe_component__related" style="display: none;">
          <h2 class="Recipe_component__related-title">מתכונים קשורים</h2>
          <recipe-strip id="Recipe_component__related-strip"></recipe-strip>
        </div>

      </div>
    `;
  }

  styles() {
    return `
    :host {
      display: block;
      width: 100%;
    }

    .Recipe_component {
      display: flex;
      flex-direction: column;
      width: 100%;
      font-family: var(--font-ui-he, 'Noto Sans Hebrew', sans-serif);
      direction: rtl;
      color: var(--ink-2, #3a3a3a);
    }

    /* =========================================================
       HEADER
       ========================================================= */
    .Recipe_component__eyebrow {
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--primary-dark, #386641);
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }

    .Recipe_component__eyebrow::before {
      content: '';
      width: 24px;
      height: 1px;
      background: var(--primary-dark, #386641);
    }

    .Recipe_component__title {
      font-family: var(--font-display-he, 'Noto Serif Hebrew', serif);
      font-size: var(--step-5, clamp(2.6rem, 2.1rem + 2.5vw, 4.25rem));
      font-weight: 600;
      color: var(--ink, #1f1d18);
      text-align: right;
      margin: 0 0 16px;
      line-height: 1.1;
      text-wrap: balance;
    }

    .Recipe_component__description {
      font-family: var(--font-ui-he, sans-serif);
      font-size: var(--step-1, clamp(1rem, 0.96rem + 0.2vw, 1.09rem));
      color: var(--text-muted, #6b6a63);
      line-height: 1.6;
      margin: 0 0 4px;
      max-width: 80ch;
      text-wrap: pretty;
      display: none;
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      transition: -webkit-line-clamp 0.3s ease;
    }

    .Recipe_component__description.expanded {
      -webkit-line-clamp: unset;
      margin-bottom: 24px;
    }

    .Recipe_component__show-more {
      background: none;
      border: none;
      color: var(--primary, #6a994e);
      font-family: var(--font-ui-he, sans-serif);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 0;
      margin-bottom: 24px;
      display: none;
      align-items: center;
      gap: 4px;
    }

    .Recipe_component__show-more:hover {
      text-decoration: underline;
    }

    /* Meta strip */
    .Recipe_component__meta-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      background: var(--surface-1, #fff);
      border: 1px solid var(--hairline, rgba(31,29,24,0.1));
      border-radius: var(--r-lg, 20px);
      padding: 4px;
    }

    .Recipe_component__meta-cell {
      padding: 16px 20px;
      border-left: 1px solid var(--hairline, rgba(31,29,24,0.1));
    }

    /* The 3rd cell is the last in the top row, so we remove its left border */
    .Recipe_component__meta-cell:nth-child(3) { border-left: 0; }

    .Recipe_component__meta-k {
      font-family: var(--font-mono, monospace);
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted, #6b6a63);
      margin-bottom: 6px;
    }

    .Recipe_component__meta-v {
      font-family: var(--font-display-he, serif);
      font-size: 22px;
      font-weight: 400;
      color: var(--text-strong, #1f1d18);
      line-height: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .Recipe_component__attribution-row {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      border-top: 1px solid var(--hairline, rgba(31,29,24,0.1));
      font-size: 12px;
      color: var(--ink-3, #6b6a63);
      min-width: 0; /* Allow truncation */
    }

    .Recipe_component__attribution-label {
      font-family: var(--font-mono, monospace);
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ink-4, #a6a49a);
      flex-shrink: 0;
    }

    .Recipe_component__attribution-value {
      font-family: var(--font-ui-he, sans-serif);
      font-style: italic;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      unicode-bidi: plaintext;
      text-align: right;
    }

    .Recipe_component__attribution-link {
      color: inherit;
      text-decoration: underline;
      text-decoration-color: var(--primary, #6a994e);
      text-underline-offset: 3px;
      transition: color var(--dur-1, 160ms);
    }

    .Recipe_component__attribution-link:hover {
      color: var(--primary, #6a994e);
    }

    /* =========================================================
       HERO IMAGE
       ========================================================= */
    .Recipe_component__image-container {
      margin: 16px 0 0;
      border-radius: var(--r-xl, 28px);
      overflow: hidden;
      border: 1px solid var(--hairline, rgba(31,29,24,0.1));
      background: var(--surface-2, #f6eed6);
      position: relative;
      min-height: 200px;
    }

    .Recipe_component__image-container.loading::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(
        90deg,
        var(--surface-2, #f6eed6) 25%,
        #e5dfcb 50%,
        var(--surface-2, #f6eed6) 75%
      );
      background-size: 200% 100%;
      animation: rc-shimmer 1.5s infinite linear;
    }

    @keyframes rc-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    .Recipe_component__image-container.loading .Recipe_component__image {
      opacity: 0;
    }

    .Recipe_component__image {
      width: 100%;
      display: block;
      object-fit: cover;
      opacity: 1;
      transition: opacity 0.3s ease;
    }

    .Recipe_component__image-container.no-image-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 300px;
      background: color-mix(in oklab, var(--surface-2, #f6eed6) 70%, var(--neutral, #f2e8cf));
    }

    .no-image-icon {
      width: 60px;
      height: 60px;
      color: var(--ink-4, #a6a49a);
    }

    /* =========================================================
       TWO-COLUMN CONTENT
       ========================================================= */
    .Recipe_component__content {
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 48px;
      align-items: start;
      margin-top: 32px;
      padding-bottom: 56px;
      border-bottom: 1px solid var(--hairline, rgba(31,29,24,0.1));
    }

    /* =========================================================
       INGREDIENTS PANEL (sticky sidebar)
       ========================================================= */
    .Recipe_component__details {
      position: sticky;
      top: 80px;
      background: var(--surface-1, #fff);
      border: 1px solid var(--hairline, rgba(31,29,24,0.1));
      border-radius: var(--r-lg, 20px);
      padding: 22px 20px 18px;
      align-self: start;
    }

    .Recipe_component__ing-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--hairline, rgba(31,29,24,0.1));
    }

    .Recipe_component__ing-title {
      font-family: var(--font-display-he, serif);
      font-weight: 400;
      font-size: 22px;
      color: var(--text-strong, #1f1d18);
      margin: 0;
    }

    /* Yield controller */
    .Recipe_component__serving-adjuster {
      flex-shrink: 0;
    }

    .Recipe_component__yield-num {
      display: flex;
      align-items: center;
      gap: 1px;
      background: var(--surface-2, #f6eed6);
      border: 1px solid var(--hairline-strong, rgba(31,29,24,0.18));
      border-radius: var(--r-pill, 9999px);
      padding: 2px;
    }

    .Recipe_component__yield-btn {
      width: 22px;
      height: 22px;
      border: 0;
      background: transparent;
      border-radius: 50%;
      cursor: pointer;
      color: var(--text-strong, #1f1d18);
      font-size: 14px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background var(--dur-1, 160ms) var(--ease, ease);
      line-height: 1;
    }

    .Recipe_component__yield-btn:hover { background: var(--surface-1, #fff); }
    .Recipe_component__yield-btn:disabled { opacity: 0.3; cursor: not-allowed; }

    .Recipe_component__yield-num input {
      width: 32px;
      text-align: center;
      font-family: var(--font-mono, monospace);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-strong, #1f1d18);
      background: transparent;
      border: 0;
      padding: 0;
      -moz-appearance: textfield;
    }

    .Recipe_component__yield-num input::-webkit-inner-spin-button,
    .Recipe_component__yield-num input::-webkit-outer-spin-button { -webkit-appearance: none; }

    /* Ingredient list */
    .Recipe_component__ingredients-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .Recipe_component__ingredients-list li {
      display: grid;
      grid-template-columns: auto 1fr 20px;
      gap: 10px;
      align-items: center;
      padding: 9px 0;
      border-bottom: 1px dashed var(--hairline, rgba(31,29,24,0.1));
      font-size: 13.5px;
      cursor: pointer;
      transition: color var(--dur-1, 160ms);
    }

    .Recipe_component__ingredients-list li:last-child { border-bottom: 0; }

    .qty {
      font-family: var(--font-mono, monospace);
      font-size: 13px;
      color: var(--text-muted, #6b6a63);
      white-space: nowrap;
      letter-spacing: 0.02em;
    }
    .qty-amount {
      unicode-bidi: isolate;
      direction: ltr;
    }

    .name { color: var(--text-strong, #1f1d18); }

    .check {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1.5px solid var(--hairline-strong, rgba(31,29,24,0.18));
      background: transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 11px;
      flex-shrink: 0;
      transition: background var(--dur-1, 160ms), border-color var(--dur-1, 160ms);
    }

    .Recipe_component__ingredients-list li.checked .check {
      background: var(--primary, #6a994e);
      border-color: var(--primary, #6a994e);
    }

    .Recipe_component__ingredients-list li.checked .check::after { content: '✓'; }

    .Recipe_component__ingredients-list li.checked .name,
    .Recipe_component__ingredients-list li.checked .qty {
      color: var(--text-muted, #6b6a63);
      text-decoration: line-through;
      text-decoration-thickness: 1px;
    }

    /* Ingredient section titles */
    .Recipe_component__section-title {
      font-family: var(--font-ui, sans-serif);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--primary-dark, #386641);
      margin: 18px 0 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .Recipe_component__section-title::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--primary-bright, #a7c957);
      flex-shrink: 0;
    }

    .Recipe_component__section-ingredients {
      list-style: none;
      padding: 0;
      margin: 0 0 4px;
    }

    .Recipe_component__section-ingredients li {
      display: grid;
      grid-template-columns: auto 1fr 20px;
      gap: 10px;
      align-items: center;
      padding: 9px 0;
      border-bottom: 1px dashed var(--hairline, rgba(31,29,24,0.1));
      font-size: 13.5px;
      cursor: pointer;
      transition: color var(--dur-1, 160ms);
    }

    .Recipe_component__section-ingredients li:last-child { border-bottom: 0; }

    /* =========================================================
       INSTRUCTIONS
       ========================================================= */
    .Recipe_component__instructions {
      min-width: 0;
    }

    .Recipe_component__instructions-heading {
      font-family: var(--font-display-he, serif);
      font-size: var(--step-4, clamp(1.9rem, 1.65rem + 1.25vw, 2.75rem));
      font-weight: 400;
      color: var(--ink, #1f1d18);
      margin: 0 0 28px;
      line-height: 1;
    }

    /* Stage wrapper */
    .Recipe_component__stage {
      margin-bottom: 48px;
      padding-bottom: 48px;
      border-bottom: 1px solid var(--hairline, rgba(31,29,24,0.1));
    }

    .Recipe_component__stage:last-child {
      border-bottom: 0;
      margin-bottom: 0;
      padding-bottom: 0;
    }

    /* Stage header */
    .Recipe_component__stage-head {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: baseline;
      gap: 16px;
      margin-bottom: 20px;
    }

    .Recipe_component__stage-num {
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--primary-dark, #386641);
      white-space: nowrap;
      padding-top: 6px;
    }

    .Recipe_component__stage-title {
      font-family: var(--font-display-he, serif);
      font-weight: 400;
      font-size: var(--step-3, clamp(1.4rem, 1.28rem + 0.6vw, 1.75rem));
      color: var(--text-strong, #1f1d18);
      margin: 0;
      line-height: 1.1;
      cursor: pointer;
      border-radius: var(--r-sm, 10px);
      padding: 4px 10px;
      border-right: 3px solid transparent;
      transition: background var(--dur-1, 160ms) var(--ease, ease);
    }

    .Recipe_component__stage-title:hover { background: var(--surface-2, #f6eed6); }

    .Recipe_component__stage-title.active-step {
      background: color-mix(in oklab, var(--primary, #6a994e) 12%, var(--surface-0, #faf6ec));
    }

    /* Step list */
    .Recipe_component__instruction-list {
      list-style: none;
      counter-reset: step;
      margin: 0;
      padding: 0;
    }

    .Recipe_component__instruction-list > li {
      counter-increment: step;
      display: grid;
      grid-template-columns: 48px 1fr;
      gap: 20px;
      padding: 18px 0;
      align-items: start;
      border-top: 1px solid var(--hairline, rgba(31,29,24,0.1));
      cursor: pointer;
      border-radius: var(--r-sm, 10px);
      transition: background var(--dur-1, 160ms) var(--ease, ease);
      line-height: 1.65;
      font-size: 15px;
      color: var(--text-color, #3a3a3a);
    }

    .Recipe_component__instruction-list > li:first-child {
      border-top: 0;
    }

    .Recipe_component__instruction-list > li::before {
      content: counter(step, decimal-leading-zero);
      font-family: var(--font-display, serif);
      font-style: italic;
      font-size: 28px;
      color: var(--primary, #6a994e);
      line-height: 1;
      letter-spacing: -0.02em;
      text-align: center;
      padding-top: 3px;
    }

    .Recipe_component__instruction-list > li:hover { background: var(--surface-2, #f6eed6); }

    .Recipe_component__instruction-list > li.active-step {
      background: color-mix(in oklab, var(--primary, #6a994e) 12%, var(--surface-0, #faf6ec));
    }

    .Recipe_component__instruction-list > li.active-step::before {
      color: var(--primary-dark, #386641);
    }

    /* =========================================================
       MEDIA INSTRUCTIONS
       ========================================================= */
    .Recipe_component__media-instructions {
      padding: 40px 0;
      border-top: 1px solid var(--hairline, rgba(31,29,24,0.1));
    }

    .Recipe_component__media-instructions h2 {
      font-family: var(--font-display-he, serif);
      font-size: var(--step-3, clamp(1.4rem, 1.28rem + 0.6vw, 1.75rem));
      font-weight: 400;
      color: var(--ink, #1f1d18);
      margin: 0 0 20px;
    }

    /* =========================================================
       COMMENTS
       ========================================================= */
    .Recipe_component__comments {
      padding: 48px 0 16px;
      border-top: 1px solid var(--hairline, rgba(31,29,24,0.1));
    }

    .Recipe_component__comments h2 {
      font-family: var(--font-display-he, serif);
      font-size: var(--step-3, clamp(1.4rem, 1.28rem + 0.6vw, 1.75rem));
      font-weight: 400;
      color: var(--ink, #1f1d18);
      margin: 0 0 20px;
    }

    .Recipe_component__comments-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .Recipe_component__comments-list li {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 12px;
      align-items: start;
      padding: 14px 0;
      border-bottom: 1px dashed var(--hairline, rgba(31,29,24,0.1));
      line-height: 1.6;
      color: var(--ink-2, #3a3a3a);
      font-size: 14.5px;
    }

    .Recipe_component__comments-list li::before {
      content: '';
      justify-self: center;
      margin-top: 0.7em;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--primary, #6a994e);
      box-shadow: 0 0 0 4px color-mix(in oklab, var(--primary, #6a994e) 15%, transparent);
      display: inline-block;
    }

    .Recipe_component__comments-list li:last-child { border-bottom: 0; }

    /* =========================================================
       RELATED RECIPES
       ========================================================= */
    .Recipe_component__related {
      padding: 48px 0 16px;
      border-top: 1px solid var(--hairline, rgba(31,29,24,0.1));
    }

    /* =========================================================
       RESPONSIVE
       ========================================================= */
    @media (max-width: 768px) {
      .Recipe_component__title {
        font-size: var(--step-4, clamp(1.9rem, 1.65rem + 1.25vw, 2.75rem));
      }

      .Recipe_component__meta-strip {
        grid-template-columns: repeat(3, 1fr);
      }

      .Recipe_component__meta-cell {
        padding: 12px 10px;
        border-left: 1px solid var(--hairline, rgba(31,29,24,0.1));
      }

      .Recipe_component__meta-cell:last-child {
        border-left: 0;
      }

      .Recipe_component__attribution-row {
        grid-column: 1 / -1;
        padding: 8px 12px;
        justify-content: center;
      }

      .Recipe_component__meta-v {
        font-size: 17px;
      }

      cook-mode-container {
        margin-top: 16px;
      }

      .Recipe_component__content {
        grid-template-columns: 1fr;
        gap: 28px;
        margin-top: 0;
      }

      .Recipe_component__details {
        position: static;
        order: -1;
      }

      .Recipe_component__instruction-list > li {
        grid-template-columns: 36px 1fr;
        gap: 14px;
      }

      .Recipe_component__instruction-list > li::before {
        font-size: 22px;
      }
    }
    `;
  }

  updatePageTitle(recipeName) {
    if (recipeName && typeof recipeName === 'string') {
      document.title = AppConfig.getPageTitle(recipeName);
    }
  }

  /**
   * Public API: Directly set recipe data to display (e.g., for preview mode)
   * @param {Object} recipe - Formatted recipe data object
   */
  async setData(recipe) {
    if (!recipe) return;

    try {
      this.populateRecipeDetails(recipe);
      await this.setRecipeImage(recipe);
      this.populateIngredientsList(recipe);
      this.populateInstructions(recipe);
      this.populateCommentList(recipe);
      this.populateRelatedRecipes(recipe).catch((err) => {
        console.error('Error loading related recipes:', err);
      });
      this.setupServingsAdjuster(recipe);
      this.displayMediaInstructions(recipe).catch((err) => {
        console.error('Error loading media instructions:', err);
      });
      this._originalIngredients = recipe.ingredientSections || recipe.ingredients;
    } catch (error) {
      console.error('Error setting recipe data:', error);
    } finally {
      this.dispatchEvent(new CustomEvent('recipe-data-loaded', { bubbles: false, composed: true }));
    }
  }

  async fetchAndPopulateRecipeData() {
    if (!this.recipeId) return;

    try {
      const recipe = await getRecipeById(this.recipeId);
      if (recipe) {
        this.updatePageTitle(recipe.name);
        await this.setData(recipe);
      } else {
        console.warn('No such document!');
        // TODO: Handle the case where the recipe doesn't exist
      }
    } catch (error) {
      console.error('Error getting recipe: ', error);
      // TODO: Handle potential errors during data fetching
    } finally {
      this.dispatchEvent(new CustomEvent('recipe-data-loaded', { bubbles: false, composed: true }));
    }
  }

  populateRecipeDetails(recipe) {
    this.shadowRoot.getElementById('Recipe_component__name').textContent = recipe.name;
    this.shadowRoot.getElementById('Recipe_component__prepTime').textContent = formatCookingTime(
      recipe.prepTime,
    );
    this.shadowRoot.getElementById('Recipe_component__waitTime').textContent = formatCookingTime(
      recipe.waitTime,
    );
    this.shadowRoot.getElementById('Recipe_component__difficulty').textContent = recipe.difficulty;
    this.shadowRoot.getElementById('Recipe_component__category').textContent =
      getLocalizedCategoryName(recipe.category);

    // Populate Description
    const descEl = this.shadowRoot.getElementById('Recipe_component__description');
    const showMoreBtn = this.shadowRoot.getElementById('Recipe_component__show-more');

    if (recipe.description && recipe.description.trim()) {
      descEl.textContent = recipe.description;
      descEl.style.display = '-webkit-box';
      descEl.classList.remove('expanded');

      // Check for truncation after render
      setTimeout(() => {
        const isTruncated = descEl.scrollHeight > descEl.offsetHeight;
        if (isTruncated) {
          showMoreBtn.style.display = 'flex';
        } else {
          showMoreBtn.style.display = 'none';
          descEl.classList.add('expanded'); // Show full text and apply margin
        }
      }, 0);

      showMoreBtn.onclick = () => {
        const isExpanded = descEl.classList.toggle('expanded');
        showMoreBtn.textContent = isExpanded ? 'הצג פחות' : 'הצג עוד';
      };
    } else {
      descEl.style.display = 'none';
      showMoreBtn.style.display = 'none';
    }

    // Populate Attribution
    const attrRow = this.shadowRoot.getElementById('Recipe_component__attribution-row');
    const attrEl = this.shadowRoot.getElementById('Recipe_component__attribution');

    if (recipe.attribution && recipe.attribution.trim()) {
      attrEl.innerHTML = this._formatAttribution(recipe.attribution);
      attrRow.style.display = 'flex';
    } else {
      attrRow.style.display = 'none';
    }
  }

  _formatAttribution(attribution) {
    if (!attribution) return '';
    // Escape HTML first to prevent XSS
    const div = document.createElement('div');
    div.textContent = attribution;
    const escaped = div.innerHTML;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return escaped.replace(urlRegex, (url) => {
      return `<a href="${url}" class="Recipe_component__attribution-link" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
  }

  async setRecipeImage(recipe) {
    const requestId = ++this._imageRequestId;
    try {
      const imageContainer = this.shadowRoot.querySelector('.Recipe_component__image-container');

      let userRole = await authService.getCurrentUserRole();
      if (this._imageRequestId !== requestId) return;

      if (userRole === 'user') userRole = 'public';
      const accessibleImages = getRecipeImages(recipe, userRole);

      imageContainer.innerHTML = '';
      imageContainer.classList.remove('loading');
      if (accessibleImages.length === 0) {
        imageContainer.style.display = 'none';
      } else {
        imageContainer.style.display = '';
        if (accessibleImages.length === 1) {
          await this.showSingleImage(imageContainer, accessibleImages[0], requestId);
        } else {
          this.showCarousel(imageContainer, accessibleImages);
        }
      }
      // TODO: add fallback to previous load system
    } catch (error) {
      if (this._imageRequestId !== requestId) return;
      console.error('Error setting recipe images:', error);
      const container = this.shadowRoot.querySelector('.Recipe_component__image-container');
      if (container) {
        container.style.display = 'none';
      }
    }
  }

  showPlaceholder(container, requestId) {
    if (requestId && this._imageRequestId !== requestId) return;

    container.classList.add('no-image-placeholder');
    container.innerHTML = `<span class="no-image-icon">${icons.imagePlaceholder}</span>`;
  }

  async showSingleImage(container, image, requestId) {
    const img = document.createElement('img');
    container.classList.add('loading');

    const handleLoad = () => container.classList.remove('loading');
    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleLoad);

    try {
      // Get optimized download URL from util
      const url = await RecipeImageService.getOptimizedUrl(image, '1080x1080');

      if (this._imageRequestId !== requestId) return;

      if (!url) {
        throw new Error('Failed to get image URL');
      }
      img.src = url;
      img.alt = 'תמונת מתכון';
      img.className = 'Recipe_component__image';
      container.appendChild(img);
    } catch (error) {
      if (this._imageRequestId !== requestId) return;
      container.classList.remove('loading');
      console.error('Error loading image:', error);
      this.showPlaceholder(container, requestId);
    }
  }

  showCarousel(container, images) {
    try {
      // Sort images to ensure primary image is first
      const sortedImages = [...images].sort((a, b) => {
        if (a.isPrimary) return -1;
        if (b.isPrimary) return 1;
        return 0;
      });

      const carousel = document.createElement('image-carousel');
      carousel.setAttribute('images', JSON.stringify(sortedImages));
      container.appendChild(carousel);
    } catch (error) {
      console.error('Error setting up carousel:', error);
      this.showPlaceholder(container);
    }
  }

  // TODO: add bullets and grid layout (align amounts)
  populateIngredientsList(recipe) {
    const ingredientsList = this.shadowRoot.getElementById('Recipe_component__ingredients-list');
    ingredientsList.innerHTML = '';

    // Check if ingredients are sectioned or flat format
    if (recipe.ingredientSections && Array.isArray(recipe.ingredientSections)) {
      // Handle sectioned ingredients format (Firebase uses ingredientSections field)
      recipe.ingredientSections.forEach((section) => {
        // Create section title if section has a title
        if (section.title && section.title.trim()) {
          const sectionTitle = document.createElement('h3');
          sectionTitle.textContent = section.title;
          sectionTitle.classList.add('Recipe_component__section-title');
          ingredientsList.appendChild(sectionTitle);
        }

        // Create ingredient list for this section
        const sectionList = document.createElement('ul');
        sectionList.classList.add('Recipe_component__section-ingredients');
        section.items.forEach((ingredient) => {
          const li = this._createIngredientListItem(ingredient);
          sectionList.appendChild(li);
        });
        ingredientsList.appendChild(sectionList);
      });
    } else if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
      // Fallback to flat ingredients array (original format)
      recipe.ingredients.forEach((ingredient) => {
        const li = this._createIngredientListItem(ingredient);
        ingredientsList.appendChild(li);
      });
    }
  }

  _createIngredientListItem(ingredient) {
    const li = document.createElement('li');
    li.addEventListener('click', () => li.classList.toggle('checked'));

    const qtySpan = document.createElement('span');
    qtySpan.className = 'qty';
    const amount = formatIngredientAmount(ingredient.amount);
    // Amount is LTR (e.g. "1 1/2"); isolate it so it does not bidi-reorder
    // inside the RTL Hebrew list.
    const amountEl = document.createElement('span');
    amountEl.className = 'qty-amount';
    amountEl.setAttribute('dir', 'ltr');
    amountEl.textContent = amount;
    qtySpan.appendChild(amountEl);
    if (ingredient.unit) {
      qtySpan.appendChild(document.createTextNode(` ${ingredient.unit}`));
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = ingredient.item;

    const checkSpan = document.createElement('span');
    checkSpan.className = 'check';

    li.appendChild(qtySpan);
    li.appendChild(nameSpan);
    li.appendChild(checkSpan);

    return li;
  }

  populateInstructions(recipe) {
    const instructionsList = this.shadowRoot.getElementById('Recipe_component__instructions-list');
    instructionsList.innerHTML = '';
    let globalStepIndex = 0;

    const dispatchStepChange = (stepIndex) => {
      this.dispatchEvent(
        new CustomEvent('active-step-changed', {
          detail: { stepIndex },
          bubbles: true,
          composed: true,
        }),
      );
    };

    const createInstructionItem = (instruction) => {
      const li = document.createElement('li');
      li.textContent = instruction;
      li.dataset.stepIndex = globalStepIndex;
      li.addEventListener('click', () => {
        const idx = parseInt(li.dataset.stepIndex);
        if (li.classList.contains('active-step')) {
          this.setActiveStep(null);
          dispatchStepChange(null);
        } else {
          this.setActiveStep(idx);
          dispatchStepChange(idx);
        }
      });
      globalStepIndex++;
      return li;
    };

    if (recipe.stages && recipe.stages.length > 0) {
      recipe.stages.forEach((stage, index) => {
        const section = document.createElement('section');
        section.className = 'Recipe_component__stage';

        // Stage header
        const stageHead = document.createElement('header');
        stageHead.className = 'Recipe_component__stage-head';

        const stageNum = document.createElement('span');
        stageNum.className = 'Recipe_component__stage-num';
        stageNum.textContent = `שלב ${String(index + 1).padStart(2, '0')}`;

        const stageTitle = document.createElement('h2');
        stageTitle.textContent = stage.title;
        stageTitle.className = 'Recipe_component__stage-title';
        stageTitle.dataset.stepIndex = globalStepIndex;
        stageTitle.addEventListener('click', () => {
          const idx = parseInt(stageTitle.dataset.stepIndex);
          if (stageTitle.classList.contains('active-step')) {
            this.setActiveStep(null);
            dispatchStepChange(null);
          } else {
            this.setActiveStep(idx);
            dispatchStepChange(idx);
          }
        });
        globalStepIndex++;

        stageHead.appendChild(stageNum);
        stageHead.appendChild(stageTitle);
        section.appendChild(stageHead);

        const stageList = document.createElement('ol');
        stageList.className = 'Recipe_component__instruction-list';
        stage.instructions.forEach((instruction) => {
          stageList.appendChild(createInstructionItem(instruction));
        });
        section.appendChild(stageList);
        instructionsList.appendChild(section);
      });
    } else {
      const heading = document.createElement('h2');
      heading.className = 'Recipe_component__instructions-heading';
      heading.textContent = 'הוראות הכנה';
      instructionsList.appendChild(heading);

      const singleStageList = document.createElement('ol');
      singleStageList.className = 'Recipe_component__instruction-list';
      recipe.instructions.forEach((instruction) => {
        singleStageList.appendChild(createInstructionItem(instruction));
      });
      instructionsList.appendChild(singleStageList);
    }

    // Set initial active step if provided
    const initialStep = this.getAttribute('active-step');
    if (initialStep !== null) {
      this.scrollToStep(parseInt(initialStep));
    }
  }

  setActiveStep(index) {
    const allSteps = this.shadowRoot.querySelectorAll(
      '.Recipe_component__instruction-list > li, .Recipe_component__stage-title',
    );
    allSteps.forEach((step) => step.classList.remove('active-step'));

    // Search for both list items and headings
    const activeStep = this.shadowRoot.querySelector(`[data-step-index="${index}"]`);
    if (activeStep) {
      activeStep.classList.add('active-step');
    }
  }

  scrollToStep(index) {
    this.setActiveStep(index);
    const activeStep = this.shadowRoot.querySelector(`[data-step-index="${index}"]`);
    if (activeStep) {
      activeStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  populateCommentList(recipe) {
    const commentsList = this.shadowRoot.getElementById('Recipe_component__comments-list');
    const commentsSection = commentsList.parentNode;
    if (Array.isArray(recipe.comments) && recipe.comments.length > 0) {
      commentsList.innerHTML = '';
      recipe.comments.forEach((comment) => {
        const li = document.createElement('li');
        li.textContent = comment;
        commentsList.appendChild(li);
      });
      commentsSection.style.display = '';
    } else {
      commentsSection.style.display = 'none';
    }
  }

  async populateRelatedRecipes(recipe) {
    const section = this.shadowRoot.getElementById('Recipe_component__related');
    const strip = this.shadowRoot.getElementById('Recipe_component__related-strip');
    if (!section || !strip) return;

    const ids = Array.isArray(recipe.relatedRecipes) ? recipe.relatedRecipes : [];
    if (!ids.length) {
      section.style.display = 'none';
      return;
    }

    const fetched = await Promise.all(ids.map((id) => getRecipeById(id)));
    const valid = fetched.filter((r) => r && r.approved);

    // Self-heal: prune stale IDs from the recipe doc (fire-and-forget).
    // RecipeService.update has PATCH semantics — only `changes` are written,
    // so images / mediaInstructions / approved are left alone.
    const validIds = valid.map((r) => r.id);
    if (validIds.length !== ids.length && this.recipeId) {
      RecipeService.update(this.recipeId, {
        changes: { relatedRecipes: validIds },
      }).catch(() => {});
    }

    if (!valid.length) {
      section.style.display = 'none';
      return;
    }

    strip.setRecipes(valid);
    section.style.display = '';
  }

  async displayMediaInstructions(recipe) {
    const section = this.shadowRoot.getElementById('Recipe_component__media-section');
    const scroller = this.shadowRoot.getElementById('Recipe_component__media-scroller');
    const viewer = this.shadowRoot.getElementById('Recipe_component__media-viewer');

    // Only display if recipe has media instructions
    if (
      !recipe.mediaInstructions ||
      !Array.isArray(recipe.mediaInstructions) ||
      recipe.mediaInstructions.length === 0
    ) {
      section.style.display = 'none';
      return;
    }

    try {
      // Sort by order field
      const sortedMedia = [...recipe.mediaInstructions].sort((a, b) => a.order - b.order);

      // Get Firebase Storage URLs for all media
      const mediaWithUrls = await Promise.all(
        sortedMedia.map(async (media) => {
          try {
            const url = await MediaInstructionService.getUrl(media.path);
            return {
              ...media,
              path: url,
            };
          } catch (error) {
            console.error(`[MediaInstructions] Error loading media ${media.path}:`, error);
            return null;
          }
        }),
      );

      // Filter out any failed media loads
      const validMedia = mediaWithUrls.filter((media) => media !== null);

      if (validMedia.length > 0) {
        scroller.setAttribute('media-data', JSON.stringify(validMedia));
        section.style.display = 'block';

        // Set up fullscreen viewer
        viewer.setAttribute('media-data', JSON.stringify(validMedia));

        // Listen for itemclick events to open fullscreen viewer
        // Store handler as instance property to prevent memory leaks
        this._handleMediaClick = (event) => {
          const { index } = event.detail;
          viewer.open(index);
        };

        // Remove any existing listener before adding new one
        scroller.removeEventListener('itemclick', this._handleMediaClick);
        scroller.addEventListener('itemclick', this._handleMediaClick);
      } else {
        section.style.display = 'none';
      }
    } catch (error) {
      console.error('[MediaInstructions] Error displaying media instructions:', error);
      section.style.display = 'none';
    }
  }

  setupServingsAdjuster(recipe) {
    const servingsInput = this.shadowRoot.getElementById('Recipe_component__servings');
    const decBtn = this.shadowRoot.getElementById('Recipe_component__servings-dec');
    const incBtn = this.shadowRoot.getElementById('Recipe_component__servings-inc');

    const initialServings = this.getAttribute('initial-servings');
    const currentServings = initialServings ? parseInt(initialServings) : recipe.servings;

    servingsInput.setAttribute('value', currentServings);
    servingsInput.value = currentServings;

    const originalIngredients = recipe.ingredientSections || recipe.ingredients;
    const originalRecipeFormat = recipe.ingredientSections ? 'sectioned' : 'flat';
    const originalServings = recipe.servings;

    const updateButtons = () => {
      if (decBtn) decBtn.disabled = parseInt(servingsInput.value) <= 1;
    };

    const applyServings = (newServings) => {
      const scaledIngredients = scaleIngredients(
        originalIngredients,
        originalServings,
        newServings,
      );
      const scaledRecipe =
        originalRecipeFormat === 'sectioned'
          ? { ingredientSections: scaledIngredients }
          : { ingredients: scaledIngredients };
      this.populateIngredientsList(scaledRecipe);
      this.dispatchEvent(
        new CustomEvent('servings-changed', {
          detail: { servings: newServings },
          bubbles: true,
          composed: true,
        }),
      );
      updateButtons();
    };

    // Perform initial scaling if needed
    if (currentServings !== originalServings) {
      applyServings(currentServings);
    }
    updateButtons();

    servingsInput.addEventListener('change', () => applyServings(parseInt(servingsInput.value)));

    if (decBtn) {
      decBtn.addEventListener('click', () => {
        const val = parseInt(servingsInput.value);
        if (val > 1) {
          servingsInput.value = val - 1;
          applyServings(val - 1);
        }
      });
    }

    if (incBtn) {
      incBtn.addEventListener('click', () => {
        const val = parseInt(servingsInput.value);
        servingsInput.value = val + 1;
        applyServings(val + 1);
      });
    }
  }

  /**
   * Check if recipe has any accessible images
   * @param {Object} recipe - Recipe object with images array
   * @param {string} userRole - User role for access control
   * @returns {boolean} True if recipe has at least one accessible image
   */
  _hasImages(recipe, userRole) {
    const accessibleImages = getRecipeImages(recipe, userRole);
    return accessibleImages && accessibleImages.length > 0;
  }
}

customElements.define('recipe-component', RecipeComponent);
