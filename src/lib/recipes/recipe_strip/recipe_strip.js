import '../recipe-card/recipe-card.js';

class RecipeStrip extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._pendingRecipes = null;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }
        @media (max-width: 768px) {
          .grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 14px;
          }
          /* mobile-single-row: one row of two on a phone */
          :host([mobile-single-row]) .grid > :nth-child(n + 3) {
            display: none;
          }
        }
      </style>
      <div class="grid"></div>
    `;

    if (this._pendingRecipes) {
      this._renderRecipes(this._pendingRecipes);
      this._pendingRecipes = null;
    }
  }

  /**
   * Populate the strip with recipes. A `hide-statuses` attribute on the strip is
   * passed to its cards. Content the page puts in the strip's
   * `after` slot (e.g. an "add a recipe" tile) follows the cards as the last
   * grid item.
   *
   * @param {Array<string|Object>} items - Recipe IDs (strings) or recipe objects with an `.id` field.
   *   Passing objects skips the per-card Firestore fetch.
   */
  setRecipes(items) {
    if (!this.shadowRoot.querySelector('.grid')) {
      this._pendingRecipes = items;
      return;
    }
    this._renderRecipes(items);
  }

  _renderRecipes(items) {
    const grid = this.shadowRoot.querySelector('.grid');
    grid.innerHTML = '';

    (items || []).forEach((item) => {
      const card = document.createElement('recipe-card');
      // Statuses the strip's context already says (e.g. "to try" in a to-try row)
      if (this.hasAttribute('hide-statuses')) {
        card.setAttribute('hide-statuses', this.getAttribute('hide-statuses'));
      }
      if (typeof item === 'string') {
        card.setAttribute('recipe-id', item);
      } else {
        card.setAttribute('recipe-id', item.id);
        card.recipeData = item;
      }
      grid.appendChild(card);
    });

    const after = document.createElement('slot');
    after.name = 'after';
    grid.appendChild(after);
  }
}

customElements.define('recipe-strip', RecipeStrip);
